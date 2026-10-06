"""FastAPI auth dependencies and request-scoped current user."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth_service import decode_access_token
from app.config import get_settings
from app.database import get_db
from app.models import User, UserSession

_current_user_name: ContextVar[str | None] = ContextVar("current_user_name", default=None)
_bearer = HTTPBearer(auto_error=False)

ADMIN_ROLES = {"Admin", "Administrator", "admin"}


def set_request_user_name(name: str | None) -> None:
    _current_user_name.set(name)


def get_request_user_name() -> str | None:
    return _current_user_name.get()


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def resolve_user_from_token(db: Session, token: str) -> User:
    payload = decode_access_token(token)
    username = payload.get("sub")
    jti = payload.get("jti")
    if not username:
        raise _unauthorized("Could not validate credentials")
    user = db.query(User).filter(User.username == username).one_or_none()
    if not user or user.status != "Active":
        raise _unauthorized("Could not validate credentials")
    if jti:
        session = (
            db.query(UserSession)
            .filter(UserSession.token_jti == jti, UserSession.status == "Active")
            .one_or_none()
        )
        if not session:
            raise _unauthorized("Session has ended. Please sign in again.")
    set_request_user_name(user.name)
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    settings = get_settings()
    token = credentials.credentials if credentials else None
    if not token:
        # Also accept cookie for browser navigations / middleware parity.
        token = request.cookies.get("ailms_token")
    if not token:
        if not settings.auth_required:
            fallback = db.query(User).filter(User.status == "Active").order_by(User.id).first()
            if fallback:
                set_request_user_name(fallback.name)
                return fallback
        raise _unauthorized()
    return resolve_user_from_token(db, token)


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User | None:
    token = credentials.credentials if credentials else request.cookies.get("ailms_token")
    if not token:
        return None
    try:
        return resolve_user_from_token(db, token)
    except HTTPException:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    allowed = {role.lower() for role in roles}

    def _dep(user: CurrentUser) -> User:
        if user.role.lower() not in allowed and user.role not in ADMIN_ROLES:
            # Administrators always pass role gates that include Administrator.
            if "administrator" in allowed and user.role.lower() == "administrator":
                return user
            if user.role.lower() == "administrator":
                return user
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _dep


def require_admin(user: CurrentUser) -> User:
    if user.role.lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
