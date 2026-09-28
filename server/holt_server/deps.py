"""Request dependencies shared by the routers: the internal key and the caller."""

from __future__ import annotations

import hmac
from typing import TYPE_CHECKING

from fastapi import Depends, Header, Request

from holt_server.errors import ApiError

if TYPE_CHECKING:
    from holt_server.services import Services


def services(request: Request) -> Services:
    return request.app.state.services


async def internal(
    request: Request,
    x_holt_internal_key: str | None = Header(default=None),
) -> None:
    expected = services(request).settings.internal_key
    if not expected or not x_holt_internal_key or not hmac.compare_digest(
        x_holt_internal_key.encode(), expected.encode()
    ):
        raise ApiError("unauthorized", "This API is only for the Holt website.")


class Caller:
    def __init__(self, user_id: str | None, ip: str | None) -> None:
        self.user_id = user_id
        self.ip = ip

    @property
    def rate_key(self) -> str:
        return f"user:{self.user_id}" if self.user_id else f"ip:{self.ip}"

    def limit(self, svc: Services) -> int:
        s = svc.settings
        return s.user_rate_per_hour if self.user_id else s.anon_rate_per_hour


async def caller(
    request: Request,
    _: None = Depends(internal),
    x_holt_user: str | None = Header(default=None),
    x_holt_client_ip: str | None = Header(default=None),
) -> Caller:
    user_id = (x_holt_user or "").strip()[:200] or None
    # No fallback to the socket address: that is the BFF's, and every anonymous
    # visitor would share one bucket.
    ip = (x_holt_client_ip or "").strip()[:64] or None
    return Caller(user_id, ip)


def signed_in(who: Caller) -> str:
    if not who.user_id:
        raise ApiError("unauthorized", "Please sign in first.")
    return who.user_id
