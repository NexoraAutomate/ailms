"""Password hashing, JWT tokens, and login/session helpers."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.administration_service import get_security_settings
from app.config import get_settings
from app.models import AppSetting, User, UserSession
from app.services import add_audit

PBKDF2_ITERATIONS = 210_000
DEFAULT_SIGNUP_ROLE = "Actionist"



def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash or password_hash.count("$") != 3:
        return False
    algo, iterations_s, salt, digest = password_hash.split("$", 3)
    if algo != "pbkdf2_sha256":
        return False
    try:
        iterations = int(iterations_s)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(candidate, digest)


def validate_password_policy(password: str, db: Session | None = None) -> None:
    policy = get_security_settings(db) if db is not None else {
        "minLength": 8,
        "requireUpper": True,
        "requireLower": True,
        "requireNumbers": True,
        "requireSpecial": False,
    }
    min_length = int(policy.get("minLength") or 8)
    if len(password) < min_length:
        raise HTTPException(status_code=400, detail=f"Password must be at least {min_length} characters")
    if policy.get("requireUpper") and not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must include an uppercase letter")
    if policy.get("requireLower") and not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must include a lowercase letter")
    if policy.get("requireNumbers") and not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must include a number")
    if policy.get("requireSpecial") and not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include a special character")


def user_initials(name: str) -> str:
    parts = name.replace(".", "").split()
    return "".join(part[0] for part in parts[:2]).upper() or "U"


def serialize_auth_user(user: User) -> dict[str, Any]:
    from app.services import avatar_public_url

    return {
        "id": user.id,
        "name": user.name,
        "username": user.username,
        "role": user.role,
        "department": user.department,
        "email": user.email,
        "status": user.status,
        "initials": user_initials(user.name),
        "avatarUrl": avatar_public_url(user),
    }


def create_access_token(*, user: User, jti: str) -> tuple[str, datetime]:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": user.username,
        "uid": user.id,
        "role": user.role,
        "name": user.name,
        "jti": jti,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expire


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _is_locked(user: User) -> bool:
    if not user.locked_until:
        return False
    return user.locked_until > datetime.now()


def authenticate_user(db: Session, username: str, password: str) -> User:
    user = db.query(User).filter(User.username == username.strip().lower()).one_or_none()
    if not user:
        # Allow legacy mixed-case usernames from seed data.
        user = db.query(User).filter(User.username == username.strip()).one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    if user.status != "Active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")
    if _is_locked(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account temporarily locked due to failed login attempts",
        )
    if not verify_password(password, user.password_hash or ""):
        policy = get_security_settings(db)
        max_attempts = int(policy.get("maxAttempts") or 5)
        lockout_minutes = int(policy.get("lockoutMinutes") or 30)
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= max_attempts:
            user.locked_until = datetime.now() + timedelta(minutes=lockout_minutes)
            user.failed_login_attempts = 0
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_activity = datetime.now()
    return user


def create_session(
    db: Session,
    *,
    user: User,
    jti: str,
    ip: str = "127.0.0.1",
    user_agent: str = "",
) -> UserSession:
    browser = "Browser"
    os_name = "Unknown"
    ua = (user_agent or "").lower()
    if "edg" in ua:
        browser = "Edge"
    elif "chrome" in ua:
        browser = "Chrome"
    elif "firefox" in ua:
        browser = "Firefox"
    elif "safari" in ua:
        browser = "Safari"
    if "windows" in ua:
        os_name = "Windows"
    elif "mac" in ua:
        os_name = "macOS"
    elif "linux" in ua:
        os_name = "Linux"
    elif "android" in ua:
        os_name = "Android"
    elif "iphone" in ua or "ipad" in ua:
        os_name = "iOS"

    now = datetime.now()
    row = UserSession(
        username=user.username,
        user_display=user.name,
        device="Desktop",
        browser=browser,
        os_name=os_name,
        ip_address=ip or "127.0.0.1",
        token_jti=jti,
        login_time=now,
        last_activity=now,
        status="Active",
    )
    db.add(row)
    return row


def revoke_session(db: Session, *, jti: str | None = None, username: str | None = None) -> int:
    query = db.query(UserSession).filter(UserSession.status == "Active")
    if jti:
        query = query.filter(UserSession.token_jti == jti)
    elif username:
        query = query.filter(UserSession.username == username)
    else:
        return 0
    count = 0
    for row in query.all():
        row.status = "Terminated"
        count += 1
    return count


def set_current_user_setting(db: Session, display_name: str) -> None:
    row = db.get(AppSetting, "currentUser")
    if row:
        row.value = display_name
    else:
        db.add(AppSetting(key="currentUser", value=display_name))


def register_user(
    db: Session,
    *,
    name: str,
    username: str,
    password: str,
    email: str = "",
    department: str = "",
    role: str | None = None,
) -> User:
    username = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,80}", username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–80 characters (letters, numbers, . _ -)",
        )
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    if email and db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")
    validate_password_policy(password, db)
    user = User(
        name=name.strip(),
        username=username,
        password_hash=hash_password(password),
        email=(email or "").strip(),
        department=(department or "").strip(),
        role=role or DEFAULT_SIGNUP_ROLE,
        status="Active",
        last_activity=datetime.now(),
    )
    db.add(user)
    db.flush()
    add_audit(
        db,
        user=user.name,
        module="Users",
        action="User Registered",
        record=user.username,
        description=f"Self-registered as {user.role}",
    )
    return user


def ensure_auth_bootstrap(db: Session) -> None:
    """Ensure seeded users have passwords and a primary admin account exists."""
    settings = get_settings()
    default_password = settings.default_user_password
    default_hash = hash_password(default_password)

    admin = db.query(User).filter(User.username == "admin").one_or_none()
    if not admin:
        admin = User(
            name="Administrator",
            username="admin",
            password_hash=default_hash,
            department="Coordination",
            role="Admin",
            email="admin@office.gov",
            status="Active",
            last_activity=datetime.now(),
        )
        db.add(admin)
        db.flush()
    elif not admin.password_hash:
        admin.password_hash = default_hash

    for user in db.query(User).filter((User.password_hash == "") | (User.password_hash.is_(None))).all():
        user.password_hash = default_hash
