"""Command-line admin utilities.

Run from `webapp/backend` with the venv active:

    python -m app.cli reset-password <email> [--password NEW]
    python -m app.cli list-admins
    python -m app.cli activate <email>
    python -m app.cli deactivate <email>
    python -m app.cli promote <email>          # make global_admin

If --password is omitted, a strong random password is generated and printed.
"""
from __future__ import annotations

import argparse
import secrets
import string
import sys

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Role, User


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

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
