"""The usage rows behind deploy/prod/stats.sh: one per request, no raw identity."""

from __future__ import annotations

from holt_server.db import Usage
from holt_server.usage import who_hash
from sqlalchemy import select


def rows(h):
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(Usage).order_by(Usage.id))).scalars().all()
    return h.client.portal.call(q)


def test_every_analysis_request_is_counted_cached_or_not(h):
    job = h.post("/v1/analyses", {"repo": "pallets/flask"}, ip="10.0.0.7").json()["job_id"]
    h.wait(job)
    assert h.post("/v1/analyses", {"repo": "pallets/flask"}, ip="10.0.0.7").json()["status"] == "done"
    h.post("/v1/analyses", {"repo": "pallets/flask"}, user="u1")
    got = rows(h)
    assert [(r.kind, r.repo_key, r.mode, r.signed_in) for r in got] == [
        ("analysis", "pallets/flask", "rules", False),
        ("analysis", "pallets/flask", "rules", False),
        ("analysis", "pallets/flask", "rules", True),
    ]
    # Same person, same day: same hash. Another person: another hash.
    assert got[0].who == got[1].who != got[2].who


def test_find_is_counted(h):
    h.post("/v1/find", {"languages": ["python"]}, user="u1")
    assert [(r.kind, r.signed_in, r.repo_key) for r in rows(h)] == [("find", True, None)]


def test_no_raw_ip_or_user_id_is_stored(h):
    h.post("/v1/analyses", {"repo": "pallets/flask"}, user="someone@example.com", ip="10.9.8.7")
    [r] = rows(h)
    stored = " ".join(str(v) for v in vars(r).values())
    assert "10.9.8.7" not in stored and "someone" not in stored
    assert len(r.who) == 32


def test_the_hash_changes_every_day():
    assert who_hash("k", "2026-10-01", "ip:1.2.3.4") != who_hash("k", "2026-10-02", "ip:1.2.3.4")
    assert who_hash("k", "2026-10-01", "ip:1.2.3.4") == who_hash("k", "2026-10-01", "ip:1.2.3.4")
    assert who_hash("k", "2026-10-01", "ip:1.2.3.4") != who_hash("other", "2026-10-01", "ip:1.2.3.4")
