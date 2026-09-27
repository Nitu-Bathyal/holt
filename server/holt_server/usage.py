"""Counting requests for the product numbers, without keeping who made them.

`who` is HMAC-SHA256(HOLT_SECRET_KEY, day + user id or IP), cut to 32 hex
characters. The day is part of the input, so the same person gets a new value
every UTC day: enough to count distinct people per day, not enough to follow
anyone over time. The IP itself is never stored.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from holt_server.db import Usage, now
from holt_server.services import Services

log = logging.getLogger("holt_server.usage")


def who_hash(secret: str, day: str, rate_key: str) -> str:
    return hmac.new(f"usage|{secret}".encode(), f"{day}|{rate_key}".encode(),
                    hashlib.sha256).hexdigest()[:32]


async def record(svc: Services, kind: str, *, user_id: str | None, ip: str | None,
                 repo_key: str | None = None, mode: str | None = None) -> None:
    """Best effort: a failed write is logged and never fails the request."""
    if not user_id and not ip:
        return
    day = now().strftime("%Y-%m-%d")
    rate_key = f"user:{user_id}" if user_id else f"ip:{ip}"
    try:
        async with svc.db.session() as s:
            s.add(Usage(day=day, kind=kind, who=who_hash(svc.settings.secret_key, day, rate_key),
                        signed_in=bool(user_id), repo_key=repo_key, mode=mode))
            await s.commit()
    except Exception:
        log.warning("could not record usage", exc_info=True)
