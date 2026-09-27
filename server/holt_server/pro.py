"""Client for the optional internal service that runs paid features.

That service is a separate program on the server's private network. It is
switched on by `HOLT_PRO_URL` and `HOLT_PRO_KEY` (server/README.md); with no
URL, `Services.pro` is None and paid features answer "not available yet".

Every call sends the key in `X-Holt-Pro-Key`. The service answers failures
with the same `{"error": {"code", "message"}}` envelope this API uses; the
client turns them, and connection errors and timeouts, into a `ProError`
whose message is written for the person using Holt. The service's own message
is for logs only. The key is never logged.

    python -m holt_server.pro          # ping it with this process's settings
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from holt_server.errors import ApiError
from holt_server.settings import Settings

log = logging.getLogger("holt_server.pro")

CONNECT_TIMEOUT_S = 2.0
READ_TIMEOUT_S = 10.0
RETRY_DELAY_S = 0.5

UNAVAILABLE = "This feature is unavailable right now. Please try again later."
NOT_YET = "This feature isn't available yet."


class ProError(ApiError):
    """A paid-feature call that failed. `pro_code` is what the service said
    (or `unavailable` when it could not be reached); `code` and `message`
    are what this API returns to the web app."""

    def __init__(self, pro_code: str, code: str, message: str,
                 status: int | None = None) -> None:
        super().__init__(code, message, status=status)
        self.pro_code = pro_code


def not_available() -> ApiError:
    """What a paid route answers when this server runs without the service."""
    return ApiError("not_implemented", NOT_YET, status=501)


@dataclass(frozen=True)
class Ping:
    ok: bool
    service: str
    version: str
    engine: str
    user_id: str | None


@dataclass(frozen=True)
class Readiness:
    """The service's `/health`: `reachable` is False when it did not answer."""
    reachable: bool
    ok: bool
    db: bool | None = None


class ProClient:
    def __init__(self, base_url: str, key: str,
                 transport: httpx.AsyncBaseTransport | None = None,
                 retry_delay: float = RETRY_DELAY_S) -> None:
        self.base_url = base_url.rstrip("/")
        self.retry_delay = retry_delay
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-Holt-Pro-Key": key},
            timeout=httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            transport=transport,
            follow_redirects=False,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def ping(self, user_id: str | None = None,
                   request_id: str | None = None) -> Ping:
        body = await self._call("POST", "/v1/ping", user_id=user_id,
                                request_id=request_id)
        return Ping(ok=bool(body.get("ok")), service=str(body.get("service", "")),
                    version=str(body.get("version", "")), engine=str(body.get("engine", "")),
                    user_id=body.get("user_id"))

    async def ready(self) -> Readiness:
        """The service's own health check. Never raises."""
        try:
            resp = await self._http.get("/health")
            body = resp.json()
        except (httpx.HTTPError, ValueError):
            return Readiness(reachable=False, ok=False)
        if not isinstance(body, dict):
            return Readiness(reachable=True, ok=False)
        db = body.get("db")
        return Readiness(reachable=True, ok=resp.status_code == 200 and body.get("ok") is True,
                         db=db if isinstance(db, bool) else None)

    async def _call(self, method: str, path: str, *, json: Any = None,
                    user_id: str | None = None, request_id: str | None = None,
                    timeout: float | None = None, retry: bool = True) -> dict[str, Any]:
        """One request, retried once on a connection error or a 503 when
        `retry` (every current endpoint is safe to repeat). Never 4xx."""
        headers: dict[str, str] = {}
        if user_id:
            headers["X-Holt-User"] = user_id
        if request_id:
            headers["X-Request-Id"] = request_id
        kw: dict[str, Any] = {"headers": headers}
        if json is not None:
            kw["json"] = json
        if timeout is not None:
            kw["timeout"] = httpx.Timeout(timeout, connect=CONNECT_TIMEOUT_S)

        attempts = 2 if retry else 1
        for attempt in range(1, attempts + 1):
            last = attempt == attempts
            try:
                resp = await self._http.request(method, path, **kw)
            except httpx.TransportError as exc:
                # Timeouts count as unavailable, but only a failed connection is
                # retried: a read timeout may mean the work is still running.
                if not last and isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
                    await asyncio.sleep(self.retry_delay)
                    continue
                log.warning("holt-pro %s %s: %s", method, path, type(exc).__name__)
                raise ProError("unavailable", "upstream", UNAVAILABLE) from None
            if resp.status_code == 503 and not last:
                await asyncio.sleep(self.retry_delay)
                continue
            if resp.is_success:
                try:
                    body = resp.json()
                except ValueError:
                    body = None
                if not isinstance(body, dict):
                    log.error("holt-pro %s %s: %d with a body that is not a JSON object",
                              method, path, resp.status_code)
                    raise ProError("internal", "upstream", UNAVAILABLE)
                return body
            raise self._error(method, path, resp)
        raise AssertionError("unreachable")  # pragma: no cover

    @staticmethod
    def _error(method: str, path: str, resp: httpx.Response) -> ProError:
        code, message = "internal", ""
        try:
            err = resp.json().get("error") or {}
            code = str(err.get("code") or code)
            message = str(err.get("message") or "")
        except (ValueError, AttributeError):
            pass
        status = resp.status_code
        where = f"holt-pro {method} {path}: {status} {code}"
        if status == 401:
            log.error("%s (HOLT_PRO_KEY does not match the service's key) %s", where, message)
            return ProError(code, "upstream", UNAVAILABLE)
        if status in (400, 405):
            log.error("%s (a bug in the client) %s", where, message)
            return ProError(code, "internal",
                            "Something went wrong on our side. Please try again in a minute.")
        if status == 404:
            log.warning("%s %s", where, message)
            return ProError(code, "not_found", "There is nothing here.")
        log.warning("%s %s", where, message)
        return ProError(code, "upstream", UNAVAILABLE)


def build(settings: Settings) -> ProClient | None:
    """The client, or None when `HOLT_PRO_URL` is not set (paid features off)."""
    url = settings.pro_url.strip()
    if not url:
        return None
    if not settings.pro_key:
        log.warning("HOLT_PRO_URL is set but HOLT_PRO_KEY is empty; every paid-feature "
                    "call will be refused")
    return ProClient(url, settings.pro_key)


async def check(client: ProClient | None) -> tuple[bool, str]:
    """Whether the service answers a ping, and one line saying so (the
    startup log line). Never raises."""
    if client is None:
        return False, "holt-pro: off (HOLT_PRO_URL is not set)"
    try:
        p = await client.ping()
    except ProError as exc:
        return False, f"holt-pro: not working at {client.base_url} ({exc.pro_code})"
    return True, f"holt-pro: ok at {client.base_url} (version {p.version}, engine {p.engine})"


def main() -> int:
    from holt_server.settings import get_settings

    logging.basicConfig(level=logging.WARNING)

    async def go() -> tuple[bool, str]:
        client = build(get_settings())
        try:
            return await check(client)
        finally:
            if client is not None:
                await client.aclose()

    ok, line = asyncio.run(go())
    print(line)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
