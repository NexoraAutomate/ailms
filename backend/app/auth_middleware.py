"""ASGI middleware that enforces JWT auth on API routes."""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Receive, Scope, Send

from app.auth_deps import resolve_user_from_token, set_request_user_name
from app.config import get_settings
from app.database import SessionLocal

PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/signup",
}


class AuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET")
        set_request_user_name(None)

        if method == "OPTIONS" or not path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        if path in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return

        settings = get_settings()
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        token = ""
        auth_header = headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        if not token:
            cookie_header = headers.get("cookie", "")
            for part in cookie_header.split(";"):
                name, _, value = part.strip().partition("=")
                if name == "ailms_token":
                    token = value
                    break

        if not token:
            if not settings.auth_required:
                await self.app(scope, receive, send)
                return
            await self._send_json(send, 401, {"detail": "Not authenticated"})
            return

        db = SessionLocal()
        try:
            resolve_user_from_token(db, token)
        except Exception as exc:
            detail = getattr(exc, "detail", "Could not validate credentials")
            status_code = getattr(exc, "status_code", 401)
            await self._send_json(send, status_code, {"detail": detail})
            return
        finally:
            db.close()

        try:
            await self.app(scope, receive, send)
        finally:
            set_request_user_name(None)

    async def _send_json(self, send: Send, status_code: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b"Bearer"),
                    (b"content-length", str(len(payload)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})
