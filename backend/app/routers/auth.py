"""Authentication and authorization API routes."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth_deps import CurrentUser
from app.auth_service import (
    authenticate_user,
    create_access_token,
    create_session,
    hash_password,
    register_user,
    revoke_session,
    serialize_auth_user,
    set_current_user_setting,
    validate_password_policy,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.schemas import (
    AuthTokenOut,
    ChangePasswordIn,
    LoginIn,
    MessageOut,
    SignupIn,
)
from app.services import add_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "127.0.0.1"


def _set_auth_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key="ailms_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie("ailms_token", path="/")


@router.post("/login", response_model=AuthTokenOut)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthTokenOut:
    user = authenticate_user(db, payload.username, payload.password)
    jti = secrets.token_hex(16)
    token, expires = create_access_token(user=user, jti=jti)
    create_session(
        db,
        user=user,
        jti=jti,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    set_current_user_setting(db, user.name)
    add_audit(
        db,
        user=user.name,
        module="Auth",
        action="Login",
        record=user.username,
        description="User signed in",
        source=f"Web · {_client_ip(request)}",
    )
    db.commit()
    _set_auth_cookie(response, token)
    return AuthTokenOut(
        accessToken=token,
        tokenType="bearer",
        expiresAt=expires.isoformat(),
        user=serialize_auth_user(user),
    )


@router.post("/signup", response_model=AuthTokenOut, status_code=201)
def signup(payload: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthTokenOut:
    user = register_user(
        db,
        name=payload.name,
        username=payload.username,
        password=payload.password,
        email=payload.email or "",
        department=payload.department or "",
    )
    jti = secrets.token_hex(16)
    token, expires = create_access_token(user=user, jti=jti)
    create_session(
        db,
        user=user,
        jti=jti,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    set_current_user_setting(db, user.name)
    db.commit()
    db.refresh(user)
    _set_auth_cookie(response, token)
    return AuthTokenOut(
        accessToken=token,
        tokenType="bearer",
        expiresAt=expires.isoformat(),
        user=serialize_auth_user(user),
    )


@router.post("/logout", response_model=MessageOut)
def logout(
    request: Request,
    response: Response,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> MessageOut:
    credentials = request.headers.get("authorization", "")
    token = ""
    if credentials.lower().startswith("bearer "):
        token = credentials.split(" ", 1)[1].strip()
    token = token or request.cookies.get("ailms_token", "")
    jti = None
    if token:
        from app.auth_service import decode_access_token

        try:
            jti = decode_access_token(token).get("jti")
        except HTTPException:
            jti = None
    revoke_session(db, jti=jti, username=None if jti else user.username)
    add_audit(
        db,
        user=user.name,
        module="Auth",
        action="Logout",
        record=user.username,
        description="User signed out",
        source=f"Web · {_client_ip(request)}",
    )
    db.commit()
    _clear_auth_cookie(response)
    return MessageOut(message="Signed out")


@router.get("/me")
def me(user: CurrentUser) -> dict:
    return serialize_auth_user(user)


@router.post("/change-password", response_model=MessageOut)
def change_password(payload: ChangePasswordIn, user: CurrentUser, db: Session = Depends(get_db)) -> MessageOut:
    if not verify_password(payload.currentPassword, user.password_hash or ""):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    validate_password_policy(payload.newPassword, db)
    user.password_hash = hash_password(payload.newPassword)
    revoke_session(db, username=user.username)
    add_audit(
        db,
        user=user.name,
        module="Auth",
        action="Password Changed",
        record=user.username,
        description="Password updated",
    )
    db.commit()
    return MessageOut(message="Password updated. Please sign in again.")
