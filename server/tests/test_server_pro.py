"""The paid-features client (holt_server/pro.py) against a fake service.

Every test uses httpx.MockTransport: nothing touches the network.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading

import httpx
import pytest
from fastapi.testclient import TestClient
from holt_server import pro
from holt_server.errors import ApiError
from holt_server.main import create_app
from holt_server.services import Services

from conftest import make_settings

KEY = "pro-secret-key-value"
URL = "http://pro:8000"
PING = {"ok": True, "service": "holt-pro", "version": "0.1.0", "engine": "0.2.0",
        "user_id": None}


def envelope(status: int, code: str, message: str = "for developers") -> httpx.Response:
    return httpx.Response(status, json={"error": {"code": code, "message": message}})


class FakePro:
    """Answers with the queued responses in order (the last one repeats)
    and records every request."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def client(self) -> pro.ProClient:
        return pro.ProClient(URL, KEY, transport=httpx.MockTransport(self), retry_delay=0)


def run(fake: FakePro, method: str, *args, **kw):
    async def go():
        client = fake.client()
        try:
            return await getattr(client, method)(*args, **kw)
        finally:
            await client.aclose()

    return asyncio.run(go())


def test_ping_sends_the_key_and_the_user():
    fake = FakePro(httpx.Response(200, json=dict(PING, user_id="u_1")))
    p = run(fake, "ping", user_id="u_1", request_id="req-9")
    assert p == pro.Ping(ok=True, service="holt-pro", version="0.1.0", engine="0.2.0",
                         user_id="u_1")
    (req,) = fake.requests
    assert req.method == "POST" and str(req.url) == f"{URL}/v1/ping"
    assert req.headers["X-Holt-Pro-Key"] == KEY
    assert req.headers["X-Holt-User"] == "u_1"
    assert req.headers["X-Request-Id"] == "req-9"


def test_ping_without_a_user_sends_no_user_header():
    fake = FakePro(httpx.Response(200, json=PING))
    assert run(fake, "ping").user_id is None
    assert "X-Holt-User" not in fake.requests[0].headers
    assert "X-Request-Id" not in fake.requests[0].headers


def test_wrong_key_is_unavailable_and_the_key_is_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    fake = FakePro(envelope(401, "unauthorized"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    e = err.value
    assert (e.pro_code, e.code, e.status) == ("unauthorized", "upstream", 502)
    assert e.message == pro.UNAVAILABLE
    assert len(fake.requests) == 1                        # 4xx is never retried
    assert "HOLT_PRO_KEY" in caplog.text
    assert KEY not in caplog.text


@pytest.mark.parametrize("status", [400, 405])
def test_bad_request_is_our_bug_and_not_retried(status):
    fake = FakePro(envelope(status, "invalid_request"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert (err.value.pro_code, err.value.code, err.value.status) == (
        "invalid_request", "internal", 500)
    assert "for developers" not in err.value.message      # their words stay in the log
    assert len(fake.requests) == 1


def test_not_found_maps_to_not_found():
    fake = FakePro(envelope(404, "not_found"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert (err.value.code, err.value.status) == ("not_found", 404)


def test_503_is_retried_once_then_succeeds():
    fake = FakePro(envelope(503, "unavailable"), httpx.Response(200, json=PING))
    assert run(fake, "ping").ok
    assert len(fake.requests) == 2


def test_503_twice_is_unavailable():
    fake = FakePro(envelope(503, "unavailable"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert (err.value.pro_code, err.value.code) == ("unavailable", "upstream")
    assert len(fake.requests) == 2


def test_500_is_not_retried():
    fake = FakePro(envelope(500, "internal"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert (err.value.pro_code, err.value.code, err.value.message) == (
        "internal", "upstream", pro.UNAVAILABLE)
    assert len(fake.requests) == 1


def test_connection_error_is_retried_once():
    fake = FakePro(httpx.ConnectError("refused"), httpx.Response(200, json=PING))
    assert run(fake, "ping").ok
    assert len(fake.requests) == 2


def test_connection_error_twice_is_unavailable():
    fake = FakePro(httpx.ConnectError("refused"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert (err.value.pro_code, err.value.code) == ("unavailable", "upstream")
    assert len(fake.requests) == 2


def test_read_timeout_is_unavailable_and_not_retried():
    fake = FakePro(httpx.ReadTimeout("slow"))
    with pytest.raises(pro.ProError) as err:
        run(fake, "ping")
    assert err.value.pro_code == "unavailable"
    assert len(fake.requests) == 1


@pytest.mark.parametrize("resp", [
    httpx.Response(200, text="<html>proxy</html>"),
    httpx.Response(200, json=[1, 2]),
    httpx.Response(502, text="bad gateway"),
])
def test_bodies_that_are_not_the_envelope_are_unavailable(resp):
    with pytest.raises(pro.ProError) as err:
        run(FakePro(resp), "ping")
    assert err.value.code == "upstream"


def test_timeouts_follow_the_contract():
    client = pro.ProClient(URL, KEY)
    try:
        t = client._http.timeout
        assert (t.connect, t.read) == (2.0, 10.0)
    finally:
        asyncio.run(client.aclose())


@pytest.mark.parametrize("resp,expected", [
    (httpx.Response(200, json={"ok": True, "db": True}), pro.Readiness(True, True, True)),
    (httpx.Response(503, json={"ok": False, "db": False}), pro.Readiness(True, False, False)),
    (httpx.Response(200, text="nope"), pro.Readiness(False, False)),
    (httpx.ConnectError("refused"), pro.Readiness(False, False)),
])
def test_ready_never_raises(resp, expected):
    fake = FakePro(resp)
    assert run(fake, "ready") == expected
    assert str(fake.requests[0].url) == f"{URL}/health"


def test_check_says_one_line():
    ok, line = asyncio.run(_check(FakePro(httpx.Response(200, json=PING))))
    assert ok and line == f"holt-pro: ok at {URL} (version 0.1.0, engine 0.2.0)"
    ok, line = asyncio.run(_check(FakePro(httpx.ConnectError("refused"))))
    assert not ok and line == f"holt-pro: not working at {URL} (unavailable)"
    assert asyncio.run(pro.check(None)) == (False, "holt-pro: off (HOLT_PRO_URL is not set)")


async def _check(fake: FakePro):
    client = fake.client()
    try:
        return await pro.check(client)
    finally:
        await client.aclose()


# --- settings and services ----------------------------------------------------


def test_off_without_a_url(tmp_path):
    svc = Services(make_settings(tmp_path))
    assert svc.pro is None
    with pytest.raises(ApiError) as err:
        svc.require_pro()
    assert (err.value.code, err.value.status) == ("not_implemented", 501)
    assert err.value.message == "This feature isn't available yet."


def test_on_with_a_url(tmp_path):
    svc = Services(make_settings(tmp_path, HOLT_PRO_URL="http://pro:8000/",
                                 HOLT_PRO_KEY=KEY))
    try:
        assert svc.require_pro() is svc.pro
        assert svc.pro.base_url == URL
    finally:
        asyncio.run(svc.pro.aclose())


def test_startup_pings_and_logs_one_line(tmp_path, caplog, drop_everything):
    caplog.set_level(logging.INFO, logger="holt_server.pro")
    pinged = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        pinged.set()
        return httpx.Response(200, json=PING)

    svc = Services(make_settings(tmp_path, HOLT_PRO_URL=URL, HOLT_PRO_KEY=KEY))
    if os.environ.get("HOLT_TEST_DATABASE_URL"):
        # A shared Postgres starts from empty, as in the make_harness fixture.
        async def reset():
            await drop_everything(svc.db.engine)
            await svc.db.engine.dispose()

        asyncio.run(reset())
    asyncio.run(svc.pro.aclose())
    svc.pro = pro.ProClient(URL, KEY, transport=httpx.MockTransport(handler))
    with TestClient(create_app(services=svc, run_jobs=False)) as client:
        assert pinged.wait(5)
        assert client.get("/health").status_code == 200
        for _ in range(100):
            if "holt-pro: ok" in caplog.text:
                break
            threading.Event().wait(0.02)
    assert "holt-pro: ok at http://pro:8000" in caplog.text
    assert svc.pro._http.is_closed
