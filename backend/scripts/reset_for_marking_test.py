#!/usr/bin/env python3
"""Wipe the CMS database and create Admin + six accounts for marking workflow tests.

Clears every cms_* table (letters, markings, users, sessions, etc.), then restores
departments / organizations / master data / roles and creates:

  - admin (Administrator)
  - six named officers across departments (mark / forward / respond targets)

Usage (from backend/):
  ./venv/Scripts/python.exe scripts/reset_for_marking_test.py
  ./venv/Scripts/python.exe scripts/reset_for_marking_test.py --password 'Password1'
  ./venv/Scripts/python.exe scripts/reset_for_marking_test.py --dry-run

Shared password defaults to DEFAULT_USER_PASSWORD (Password1).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, text

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.administration_service import ensure_administration_seed  # noqa: E402
from app.auth_service import hash_password  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.models import AppSetting, Department, DepartmentLink, MasterValue, Organization, User  # noqa: E402
from app.seed import (  # noqa: E402
    DEPARTMENT_COORDINATION,
    DEPARTMENT_LAYOUT,
    DEPARTMENT_PARENTS,
    DEPARTMENTS,
    MASTER_DATA,
    ORGANIZATIONS,
    ensure_seed_avatars,
)

# Six distinct officers (in addition to admin) for mark / respond / forward tests.
MARKING_TEST_USERS: list[dict[str, str]] = [
    {
        "username": "arahman",
        "name": "A. Rahman",
        "role": "Coordinator",
        "department": "Coordination",
        "email": "a.rahman@office.gov",
    },
    {
        "username": "skhan",
        "name": "S. Khan",
        "role": "Manager",
        "department": "Technical",
        "email": "s.khan@office.gov",
    },
    {
        "username": "nahmed",
        "name": "N. Ahmed",
        "role": "Coordinator",
        "department": "Finance",
        "email": "n.ahmed@office.gov",
    },
    {
        "username": "miqbal",
        "name": "M. Iqbal",
        "role": "Actionist",
        "department": "Operations",
        "email": "m.iqbal@office.gov",
    },
    {
        "username": "hmasood",
        "name": "H. Masood",
        "role": "Actionist",
        "department": "External Relations",
        "email": "h.masood@office.gov",
    },
    {
        "username": "zraza",
        "name": "Z. Raza",
        "role": "Coordinator",
        "department": "Policy",
        "email": "z.raza@office.gov",
    },
]

ADMIN_ACCOUNT = {
    "username": "admin",
    "name": "Administrator",
    "role": "Admin",
    "department": "Coordination",
    "email": "admin@office.gov",
}


def truncate_all_cms_tables(db, *, dry_run: bool) -> list[str]:
    insp = inspect(engine)
    tables = [t for t in insp.get_table_names() if t.startswith("cms_")]
    if dry_run:
        return tables
    if not tables:
        return []
    # RESTART IDENTITY so IDs start clean for a fresh marking test.
    qualified = ", ".join(f'"{t}"' for t in tables)
    db.execute(text(f"TRUNCATE TABLE {qualified} RESTART IDENTITY CASCADE"))
    db.commit()
    return tables


def seed_infrastructure(db) -> None:
    for category, values in MASTER_DATA.items():
        for value in values:
            db.add(MasterValue(category=category, value=value))

    for code, name, head in DEPARTMENTS:
        pos = DEPARTMENT_LAYOUT.get(name, (0, 0))
        db.add(Department(code=code, name=name, head=head, pos_x=pos[0], pos_y=pos[1]))

    db.flush()
    by_name = {row.name: row for row in db.query(Department).all()}
    for child_name, parent_name in DEPARTMENT_PARENTS.items():
        child = by_name.get(child_name)
        parent = by_name.get(parent_name)
        if child and parent:
            child.parent_id = parent.id
    for source_name, target_name in DEPARTMENT_COORDINATION:
        source = by_name.get(source_name)
        target = by_name.get(target_name)
        if source and target:
            db.add(DepartmentLink(source_id=source.id, target_id=target.id, kind="coordinates"))

    for name, short, org_type, contact, email, phone, status in ORGANIZATIONS:
        db.add(
            Organization(
                name=name,
                short_name=short,
                type=org_type,
                contact=contact,
                email=email,
                phone=phone,
                status=status,
            )
        )

    db.add_all(
        [
            AppSetting(key="organizationName", value="Office of the Secretary"),
            AppSetting(key="systemName", value="Correspondence Management System"),
            AppSetting(key="defaultDueDays", value="7"),
            AppSetting(key="currentUser", value="Administrator"),
            AppSetting(key="bootstrapMode", value="marking-test"),
        ]
    )


def create_user(db, *, account: dict[str, str], password_hash: str) -> User:
    user = User(
        name=account["name"],
        username=account["username"],
        password_hash=password_hash,
        department=account["department"],
        role=account["role"],
        email=account["email"],
        status="Active",
        last_activity=datetime.now(),
        failed_login_attempts=0,
        locked_until=None,
    )
    db.add(user)
    return user


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        description="Reset DB and create Admin + 6 users for marking workflow tests"
    )
    parser.add_argument(
        "--password",
        default=settings.default_user_password,
        help=f"Shared password for all accounts (default: {settings.default_user_password})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned actions without writing",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        truncated = truncate_all_cms_tables(db, dry_run=args.dry_run)
        if args.dry_run:
            print(f"[DRY RUN] Would TRUNCATE {len(truncated)} cms_* tables")
            print(f"[DRY RUN] Would recreate departments/orgs/master data/roles")
            print(f"[DRY RUN] Would create admin + {len(MARKING_TEST_USERS)} users")
            print(f"[DRY RUN] Shared password: {args.password}")
            return 0

        print(f"Truncated {len(truncated)} cms_* tables.")
        seed_infrastructure(db)
        db.flush()
        ensure_administration_seed(db)

        password_hash = hash_password(args.password)
        create_user(db, account=ADMIN_ACCOUNT, password_hash=password_hash)
        for account in MARKING_TEST_USERS:
            create_user(db, account=account, password_hash=password_hash)

        db.flush()
        ensure_seed_avatars(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    # Verify
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.id).all()
        letter_count = db.execute(text("SELECT COUNT(*) FROM cms_letters")).scalar()
        marking_count = db.execute(text("SELECT COUNT(*) FROM cms_markings")).scalar()
    finally:
        db.close()

    print()
    print(f"[OK] Letters: {letter_count}  Markings: {marking_count}  Users: {len(users)}")
    print(f"Shared password: {args.password}")
    print()
    print(f"{'Username':<12} {'Name':<16} {'Role':<12} {'Department':<20} Email")
    print("-" * 88)
    for u in users:
        print(f"{u.username:<12} {u.name:<16} {u.role:<12} {u.department:<20} {u.email}")
    print()
    print("Register a letter as one user, then Mark to any of the other officers to test the channel.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
