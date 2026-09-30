"""GitHub's own pull request switches (engine 6): off, or collaborators only.
Either is the answer on its own, before any count."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import pytest

from holt.agent import pipeline
from holt.evidence import github_graphql as gql
from holt.evidence.provider import EvidenceProvider
from holt.report import Verdict
from holt.types import EvidenceRecord, Window

NOW = datetime(2026, 9, 29, tzinfo=UTC)


class Live(EvidenceProvider):
    def __init__(self, records: list[EvidenceRecord]) -> None:
        super().__init__(Window.PRE_T, NOW)
        self._records = records

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        return self._records

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return next((r for r in self._records if r.evidence_id == evidence_id), None)


def records(**settings) -> list[EvidenceRecord]:
    """A busy repository that merges outsiders, with these pull request settings."""
    out = [EvidenceRecord("repo:o/r:meta", "github", "https://github.com/o/r",
                          NOW - timedelta(days=900),
                          {"pushed_at": NOW.isoformat(), "stargazer_count": 900, **settings})]
    for n in range(1, 21):
        opened = NOW - timedelta(days=30 + n)
        out += [EvidenceRecord(f"pr:o/r#{n}:opened", "github", f"https://github.com/o/r/pull/{n}",
                               opened, {"author": f"user{n}", "author_association": "NONE"}),
                EvidenceRecord(f"pr:o/r#{n}:review:0", "github", f"https://github.com/o/r/pull/{n}",
                               opened + timedelta(hours=2),
                               {"author": "lead", "author_association": "OWNER", "body": "ok"}),
                EvidenceRecord(f"pr:o/r#{n}:merged", "github", f"https://github.com/o/r/pull/{n}",
                               opened + timedelta(hours=3), {"author": f"user{n}", "merged": True})]
    return out


def answer(**settings):
    assessment, trace = pipeline.analyze_without_model(
        "o/r", Live(records(**settings)), as_of=NOW)
    return assessment.verdict, [getattr(r, "code", "") for r in trace.rules], trace.rules


@pytest.mark.parametrize(("settings", "line"), [
    ({"pull_requests_enabled": False}, "Pull requests are switched off on this repository."),
    ({"pull_requests_enabled": True, "pull_request_policy": "COLLABORATORS_ONLY"},
     "Only the project's collaborators can open pull requests on this repository."),
])
def test_closed_to_outsiders_is_the_answer(settings, line):
    verdict, codes, rules = answer(**settings)
    assert verdict is Verdict.NOT_VIABLE
    # After the dates every live report starts with, and nothing else.
    assert codes == ["sample_period", "prs_closed"] and str(rules[-1]) == line


@pytest.mark.parametrize("settings", [
    {}, {"pull_requests_enabled": True, "pull_request_policy": "ALL"},
])
def test_open_settings_or_none_recorded_leave_the_counts_to_decide(settings):
    verdict, codes, _ = answer(**settings)
    assert verdict is Verdict.VIABLE and "prs_closed" not in codes


def test_the_settings_are_read_with_the_repository():
    assert "hasPullRequestsEnabled pullRequestCreationPolicy" in gql.REPO_META
    raw = {"pushedAt": "2026-09-01T00:00:00Z", "isArchived": False, "isMirror": False,
           "isFork": False, "description": None, "homepageUrl": None, "primaryLanguage": None,
           "stargazerCount": 1, "createdAt": "2020-01-01T00:00:00Z",
           "hasPullRequestsEnabled": True, "pullRequestCreationPolicy": "COLLABORATORS_ONLY"}
    payload = gql.project_repo_meta("o/r", raw).payload
    assert payload["pull_requests_enabled"] is True
    assert payload["pull_request_policy"] == "COLLABORATORS_ONLY"
    del raw["hasPullRequestsEnabled"], raw["pullRequestCreationPolicy"]
    assert "pull_request_policy" not in gql.project_repo_meta("o/r", raw).payload
