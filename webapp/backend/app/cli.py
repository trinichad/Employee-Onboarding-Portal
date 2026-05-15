"""Command-line admin utilities.

Run from `webapp/backend` with the venv active:

    python -m app.cli create-admin <email> [--password NEW] [--name "Full Name"]
    python -m app.cli reset-password <email> [--password NEW]
    python -m app.cli list-admins
    python -m app.cli activate <email>
    python -m app.cli deactivate <email>
    python -m app.cli promote <email>          # make global_admin
    python -m app.cli rebuild-employee-payloads [--dry-run]

If --password is omitted, a strong random password is generated and printed.
"""
from __future__ import annotations

import argparse
import getpass
import secrets
import string
import sys

from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import Employee, EmployeeRequest, Role, User
import app.models  # noqa: F401
from app.api.v1.employees import _effective_payload


def _gen_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _get_user(db, email: str) -> User:
    user = db.query(User).filter(User.email == email.lower()).one_or_none()
    if not user:
        print(f"error: no user with email {email}", file=sys.stderr)
        sys.exit(1)
    return user


def cmd_reset_password(args: argparse.Namespace) -> None:
    new_password = args.password or _gen_password()
    db = SessionLocal()
    try:
        user = _get_user(db, args.email)
        user.password_hash = hash_password(new_password)
        user.is_active = True
        db.commit()
        print(f"Password reset for {user.email}")
        print(f"  new password: {new_password}")
        print("  user should change it after logging in.")
    finally:
        db.close()


def cmd_list_admins(_: argparse.Namespace) -> None:
    db = SessionLocal()
    try:
        admins = db.query(User).filter(User.role == Role.GLOBAL_ADMIN).all()
        if not admins:
            print("(no global admins)")
            return
        for u in admins:
            print(f"  {u.id:>4}  {u.email:<40}  active={u.is_active}")
    finally:
        db.close()


def cmd_set_active(args: argparse.Namespace, active: bool) -> None:
    db = SessionLocal()
    try:
        user = _get_user(db, args.email)
        user.is_active = active
        db.commit()
        print(f"{user.email}: is_active={active}")
    finally:
        db.close()


def cmd_promote(args: argparse.Namespace) -> None:
    db = SessionLocal()
    try:
        user = _get_user(db, args.email)
        user.role = Role.GLOBAL_ADMIN
        user.organization_id = None
        user.is_active = True
        db.commit()
        print(f"{user.email} is now global_admin")
    finally:
        db.close()


def cmd_create_admin(args: argparse.Namespace) -> None:
    """Create a new Global Admin. Interactive if --password omitted and a TTY
    is attached; otherwise auto-generates a password.
    """
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        email = args.email.lower()
        if db.query(User).filter(User.email == email).one_or_none():
            print(f"error: a user already exists with email {email}", file=sys.stderr)
            sys.exit(1)

        password = args.password
        if not password:
            if sys.stdin.isatty():
                while True:
                    p1 = getpass.getpass("New password (min 8 chars): ")
                    if len(p1) < 8:
                        print("  too short, try again")
                        continue
                    p2 = getpass.getpass("Confirm password: ")
                    if p1 != p2:
                        print("  passwords didn't match, try again")
                        continue
                    password = p1
                    break
            else:
                password = _gen_password()
                print(f"  generated password: {password}")

        user = User(
            email=email,
            full_name=args.name or "Platform Admin",
            password_hash=hash_password(password),
            role=Role.GLOBAL_ADMIN,
            organization_id=None,
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created global admin {email}")
    finally:
        db.close()


def cmd_rebuild_employee_payloads(args: argparse.Namespace) -> None:
    """One-shot: recompute Employee.last_payload by re-pruning the most
    recent request's payload through `_effective_payload`. Use this after
    deploying the prior-access pruning fix so existing employee records stop
    surfacing already-removed items as 'previously granted'.

    Pass --dry-run to only print what would change.
    """
    db = SessionLocal()
    try:
        rows = db.query(Employee).all()
        changed = 0
        skipped = 0
        for emp in rows:
            if not emp.last_request_id:
                skipped += 1
                continue
            req = db.query(EmployeeRequest).filter(EmployeeRequest.id == emp.last_request_id).one_or_none()
            if req is None or not isinstance(req.payload, dict):
                skipped += 1
                continue
            new_payload = _effective_payload(req.payload)
            if new_payload == (emp.last_payload or {}):
                continue
            label = f"#{emp.id} {emp.full_name or emp.email or '?'}"
            print(f"  rebuild {label}: from request #{req.id}")
            if not args.dry_run:
                emp.last_payload = new_payload
            changed += 1
        if args.dry_run:
            print(f"DRY RUN: would update {changed} employee record(s); skipped {skipped} with no request.")
        else:
            db.commit()
            print(f"Updated {changed} employee record(s); skipped {skipped} with no request.")
    finally:
        db.close()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)

    rp = sub.add_parser("reset-password", help="Reset a user's password")
    rp.add_argument("email")
    rp.add_argument("--password", help="Specific password (otherwise auto-generated)")
    rp.set_defaults(func=cmd_reset_password)

    la = sub.add_parser("list-admins", help="List global admins")
    la.set_defaults(func=cmd_list_admins)

    ac = sub.add_parser("activate", help="Mark a user active")
    ac.add_argument("email")
    ac.set_defaults(func=lambda a: cmd_set_active(a, True))

    da = sub.add_parser("deactivate", help="Mark a user inactive")
    da.add_argument("email")
    da.set_defaults(func=lambda a: cmd_set_active(a, False))

    pr = sub.add_parser("promote", help="Promote a user to global_admin")
    pr.add_argument("email")
    pr.set_defaults(func=cmd_promote)

    ca = sub.add_parser("create-admin", help="Create a new Global Admin")
    ca.add_argument("email")
    ca.add_argument("--password", help="Specific password (otherwise prompted or auto-generated)")
    ca.add_argument("--name", help="Full name (default: 'Platform Admin')")
    ca.set_defaults(func=cmd_create_admin)

    rb = sub.add_parser(
        "rebuild-employee-payloads",
        help="Rebuild Employee.last_payload from each employee's most recent request, applying prior-access REMOVE pruning.",
    )
    rb.add_argument("--dry-run", action="store_true", help="Show what would change without writing.")
    rb.set_defaults(func=cmd_rebuild_employee_payloads)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
