#!/usr/bin/env python3
"""Create (or refresh) one demo login per CMS role for end-to-end workflow checks.

Accounts follow letter lifecycle order: entry → routing → work → close → read-only.

Usage (from backend/):
  python scripts/create_demo_accounts.py
  python scripts/create_demo_accounts.py --password 'Password1'
  python scripts/create_demo_accounts.py --dry-run

Shared password defaults to DEFAULT_USER_PASSWORD from settings (Password1).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.auth_service import hash_password  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402

# Ordered like a letter moving through the system (Onboarding Roles chapter).
DEMO_ACCOUNTS: list[dict[str, str]] = [
    {
        "username": "demo.coordinator",
        "name": "Demo Coordinator",
        "role": "Coordinator",
        "department": "Coordination",
        "email": "demo.coordinator@office.gov",
        "step": "1. Register, validate, classify, route FYI",
    },
    {
        "username": "demo.management",
        "name": "Demo Management",
        "role": "Management",
        "department": "Coordination",
        "email": "demo.management@office.gov",
        "step": "2. Approve routing; oversee dispatch",
    },
    {
        "username": "demo.manager",
        "name": "Demo Manager",
        "role": "Manager",
        "department": "Technical",
        "email": "demo.manager@office.gov",
        "step": "3. Delegate, approve response steps, close",
    },
    {
        "username": "demo.actionist",
        "name": "Demo Actionist",
        "role": "Actionist",
        "department": "Operations",
        "email": "demo.actionist@office.gov",
        "step": "4. Accept work, draft reply, submit for approval",
    },
    {
        "username": "demo.admin",
        "name": "Demo Admin",
        "role": "Admin",
        "department": "Coordination",
        "email": "demo.admin@office.gov",
        "step": "5. Override any step; dispatch; system settings",
    },
    {
        "username": "demo.viewer",
        "name": "Demo Viewer",
        "role": "Viewer",
        "department": "Coordination",
        "email": "demo.viewer@office.gov",
        "step": "6. Read-only catalog and status visibility",
    },
]


def upsert_demo_user(
    db,
    *,
    account: dict[str, str],
    password_hash: str,
    dry_run: bool,
) -> str:
    username = account["username"]
    existing = db.query(User).filter(User.username == username).one_or_none()
    if existing:
        if dry_run:
            return "would-update"
        existing.name = account["name"]
        existing.password_hash = password_hash
        existing.department = account["department"]
        existing.role = account["role"]
        existing.email = account["email"]
        existing.status = "Active"
        existing.failed_login_attempts = 0
        existing.locked_until = None
        existing.last_activity = datetime.now()
        return "updated"

    if dry_run:
        return "would-create"

    db.add(
        User(
            name=account["name"],
            username=username,
            password_hash=password_hash,
            department=account["department"],
            role=account["role"],
            email=account["email"],
            status="Active",
            last_activity=datetime.now(),
        )
    )
    return "created"


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Create demo accounts for each CMS role")
    parser.add_argument(
        "--password",
        default=settings.default_user_password,
        help=f"Shared password for all demo accounts (default: {settings.default_user_password})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without writing to the database",
    )
    args = parser.parse_args()

    password_hash = hash_password(args.password)
    db = SessionLocal()
    results: list[tuple[dict[str, str], str]] = []
    try:
        for account in DEMO_ACCOUNTS:
            action = upsert_demo_user(
                db,
                account=account,
                password_hash=password_hash,
                dry_run=args.dry_run,
            )
            results.append((account, action))
        if not args.dry_run:
            db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    mode = "DRY RUN" if args.dry_run else "OK"
    print(f"[{mode}] Demo accounts ({len(results)}) — password: {args.password}")
    print()
    print(f"{'Username':<18} {'Role':<12} {'Department':<16} {'Action':<12} Workflow step")
    print("-" * 100)
    for account, action in results:
        print(
            f"{account['username']:<18} {account['role']:<12} "
            f"{account['department']:<16} {action:<12} {account['step']}"
        )
    print()
    print("Sign in as each user in turn to walk a letter from Registered → Closed / Archived.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
