""""Was this verdict right?": POST /v1/feedback and the export."""

from __future__ import annotations

import csv
import io
import json

from holt_server import feedback
from holt_server.db import Feedback
from sqlalchemy import select

GEN = "2026-09-25T00:00:00Z"


def rows(h) -> list[Feedback]:
    async def q():
        async with h.svc.db.session() as s:
            return (await s.execute(select(Feedback).order_by(Feedback.id))).scalars().all()
    return h.client.portal.call(q)


def analyse(h, repo="pallets/flask", verdict="viable") -> dict:
    h.engine.verdict = verdict
    r = h.post("/v1/analyses", {"repo": repo, "refresh": True})
    return h.wait(r.json()["job_id"])["report"]


def answer(h, vote="up", reason=None, generated_at=GEN, repo="pallets/flask", **kw):
    body = {"repo": repo, "mode": "rules", "days": 7, "generated_at": generated_at,
            "vote": vote}
    if reason is not None:
        body["reason"] = reason
    return h.post("/v1/feedback", body, **kw)


def test_anonymous_answer_is_stored_with_a_hashed_ip(h):
    analyse(h)
    r = answer(h, "down", reason="  They   never\nmerge outside work. ", ip="203.0.113.7")
    assert r.status_code == 200
    assert r.json() == {"repo": "pallets/flask", "generated_at": GEN, "verdict": "viable",
                        "vote": "down", "reason": "They never merge outside work."}
    [row] = rows(h)
    assert row.vote == "down" and row.verdict == "viable" and row.user_id is None
    assert row.report_id and row.generated_at == GEN
    assert row.ip_hash and "203.0.113.7" not in row.ip_hash + row.voter
    assert row.voter == f"ip:{row.ip_hash}"


def test_one_answer_per_person_per_version(h):
    analyse(h)
    assert answer(h, "up", ip="203.0.113.7").status_code == 200
    assert answer(h, "down", reason="changed my mind", ip="203.0.113.7").status_code == 200
    [row] = rows(h)
    assert (row.vote, row.reason) == ("down", "changed my mind")
    # Someone else, and a signed-in user on the same IP, are other people.
    answer(h, "up", ip="198.51.100.2")
    answer(h, "up", user="u1", ip="203.0.113.7")
    answer(h, "down", user="u1", ip="198.51.100.9")
    got = rows(h)
    assert len(got) == 3
    assert [r.user_id for r in got] == [None, None, "u1"]
    assert got[2].vote == "down" and got[2].ip_hash is None and got[2].voter == "user:u1"


def test_a_new_report_version_takes_a_new_answer(h):
    first = analyse(h)
    answer(h, "up")
    # The next check of the same repo is a new version, even with the same
    # generated_at (the fake engine's is fixed): it is its own report row.
    analyse(h, verdict="not_viable")
    answer(h, "down")
    got = rows(h)
    assert len(got) == 2
    assert got[0].report_id != got[1].report_id
    assert [r.verdict for r in got] == ["viable", "not_viable"]
    assert first["generated_at"] == GEN


def test_unknown_report_is_not_found(h):
    r = answer(h)  # nothing analysed yet
    assert r.status_code == 404
    analyse(h)
    assert answer(h, generated_at="2020-01-01T00:00:00Z").status_code == 404
    assert rows(h) == []


def test_bad_bodies(h):
    analyse(h)
    assert answer(h, vote="meh").status_code == 400
    assert answer(h, repo="not a repo").json()["error"]["code"] == "invalid_repo"
    assert answer(h, ip=None).json()["error"]["code"] == "invalid_request"
    assert h.client.post("/v1/feedback", json={}).status_code == 401  # no internal key


def test_reason_is_trimmed_and_capped(h):
    analyse(h)
    assert answer(h, reason="   ").json()["reason"] is None
    long = answer(h, reason="x" * 1500).json()["reason"]
    assert len(long) == feedback.REASON_MAX


def test_anonymous_answers_are_rate_limited_per_ip(h, monkeypatch):
    monkeypatch.setattr(feedback, "ANON_PER_HOUR", 2)
    analyse(h)
    assert answer(h, ip="203.0.113.7").status_code == 200
    assert answer(h, ip="203.0.113.7").status_code == 200
    r = answer(h, ip="203.0.113.7")
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"
    assert "answers" in r.json()["error"]["message"]
    assert int(r.headers["Retry-After"]) > 0
    # Other visitors, and analyses, are unaffected.
    assert answer(h, ip="198.51.100.2").status_code == 200
    assert h.post("/v1/analyses", {"repo": "octo/one"}, ip="203.0.113.7").status_code == 202


def test_export_csv_and_json(h, tmp_path, capsys):
    analyse(h)
    answer(h, "down", reason='says "no", then merges', ip="203.0.113.7")
    answer(h, "up", user="u1")
    got = h.client.portal.call(feedback.export_rows, h.svc)
    assert [r["vote"] for r in got] == ["down", "up"]
    assert got[0]["signed_in"] is False and got[1]["signed_in"] is True
    assert got[0]["verdict"] == "viable" and got[0]["repo"] == "pallets/flask"
    text = json.dumps(got)
    assert "u1" not in text and "203.0.113.7" not in text and "ip:" not in text

    buf = io.StringIO()
    feedback.write(got, "csv", buf)
    parsed = list(csv.DictReader(io.StringIO(buf.getvalue())))
    assert list(parsed[0]) == feedback.FIELDS
    assert parsed[0]["reason"] == 'says "no", then merges'

    buf = io.StringIO()
    feedback.write(got, "json", buf)
    assert json.loads(buf.getvalue()) == got

    later = h.client.portal.call(
        feedback.export_rows, h.svc, feedback.parse_since("2999-01-01"))
    assert later == []


def test_export_cli_writes_a_file(h, tmp_path, monkeypatch):
    analyse(h)
    answer(h, "up")
    out = tmp_path / "golden.json"
    monkeypatch.setattr("holt_server.settings.get_settings", lambda: h.svc.settings)
    assert feedback.main(["export", "--format", "json", "--out", str(out)]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert [(d["repo"], d["vote"]) for d in data] == [("pallets/flask", "up")]
