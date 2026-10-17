"""Extract client IP for audit stamps (spec 06)."""

from __future__ import annotations

from fastapi import Request

from app.config import get_settings


def client_ip_from_request(request: Request | None) -> str:
    if request is None:
        return ""
    settings = get_settings()
    if settings.trust_proxy:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded[:80]
    if request.client and request.client.host:
        return request.client.host[:80]
    return ""
