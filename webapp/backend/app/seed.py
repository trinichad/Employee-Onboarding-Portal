"""Bootstrap the database with an initial Global Admin user.

Run from `webapp/backend`:
    python -m app.seed
"""
from __future__ import annotations

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import Role, User
import app.models  # noqa: F401


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        email = settings.BOOTSTRAP_ADMIN_EMAIL.lower()
        existing = db.query(User).filter(User.email == email, User.role == Role.GLOBAL_ADMIN).one_or_none()
        if existing:
            print(f"[seed] Global admin already exists: {email}")
            return
        admin = User(
            email=email,
            full_name=settings.BOOTSTRAP_ADMIN_NAME,
            password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
            role=Role.GLOBAL_ADMIN,
            organization_id=None,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print("[seed] Created bootstrap Global Admin")
        print(f"  email:    {email}")
        print(f"  password: {settings.BOOTSTRAP_ADMIN_PASSWORD}")
        print("  Change this password immediately after first login!")
    finally:
        db.close()


if __name__ == "__main__":
    main()
