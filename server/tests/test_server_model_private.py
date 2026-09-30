"""Which model wrote a report, playbook or summary is internal: the server
keeps it in `ai_runs`, and no response body or event carries it."""

from __future__ import annotations

import copy

from holt_server import playbook, preflight
from holt_server.jobs import done_payload

from test_server_ai_budget import ai, budgeted, gift, runs
from test_server_playbook import PRO_PLAYBOOK
from test_server_preflight import PRO_PREFLIGHT


def test_an_ai_report_never_names_its_model(make_harness):
    h = budgeted(make_harness)
    gift(h, "u1")
    job = ai(h, "octo/one", "u1").json()["job_id"]
    polled = h.wait(job)
    assert polled["status"] == "done"
    assert polled["report"]["cost"] is not None and "model" not in polled["report"]["cost"]
    stored = h.get("/v1/reports/octo/one?mode=ai").json()
    assert "model" not in stored["cost"]
    # The database still knows.
    assert runs(h)[0].model == "openai/gpt-5-mini"


def test_finished_job_events_never_name_the_model():
    report = {"verdict": "viable", "cost": {"model": "m", "input_tokens": 1}}
    assert done_payload("analysis", report) == {
        "report": {"verdict": "viable", "cost": {"input_tokens": 1}}}
    assert "model" not in done_payload("playbook", {"repo": "o/r", "model": "m"})["playbook"]
    assert "model" not in done_payload(
        "preflight", {"summary": {"model": "m", "sentences": []}})["preflight"]["summary"]
    assert done_payload("analysis", None) == {"report": None}
    assert done_payload("preflight", {"summary": None}) == {"preflight": {"summary": None}}


def test_playbooks_and_summaries_leave_the_model_behind():
    assert "model" not in playbook.from_pro("pallets/flask", PRO_PLAYBOOK)
    body = copy.deepcopy(PRO_PREFLIGHT)
    body["summary"] = {"model": "openai/gpt-5-mini",
                       "sentences": [{"text": "Link the issue.", "checks": ["issue"]}]}
    summary = preflight.from_pro("pallets/flask", body)["summary"]
    assert summary == {"sentences": [{"text": "Link the issue.", "checks": ["issue"]}]}
