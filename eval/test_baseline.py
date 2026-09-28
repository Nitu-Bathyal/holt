"""The baseline solution must work without a network or a key.

A stub model lets the whole path -- provider, prompt assembly, verdict parsing,
report rendering -- be verified in the suite, so the only thing a live run adds
is the model's judgement.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

import pytest

from eval import baseline
from holt.evidence.fixtures import FixtureProvider, write_fixture
from holt.model import Usage, call_key
from holt.report import Verdict
from holt.types import T_CUTOFF, EvidenceRecord, Window

BEFORE = T_CUTOFF - timedelta(days=1)


@dataclass
class StubModel:
    reply: dict
    replayed: bool = False
    usage: Usage = field(default_factory=Usage)
    seen: list[dict] = field(default_factory=list)

    def complete(self, *, label, system, prompt, schema):
        self.seen.append({"label": label, "system": system, "prompt": prompt})
        return self.reply


@pytest.fixture
def provider(tmp_path):
    write_fixture(
        "a/b",
        Window.PRE_T,
        [
            EvidenceRecord(
                "repo:a/b:meta", "github", "https://x", BEFORE,
                {"description": "a thing", "primary_language": "Python", "stargazer_count": 12},
            ),
            EvidenceRecord(
                "repo:a/b:readme", "github", "https://x", BEFORE,
                {"kind": "readme", "text": "# a/b\nContributions welcome."},
            ),
        ],
        root=tmp_path,
    )
    return FixtureProvider(Window.PRE_T, root=tmp_path)


def test_baseline_produces_an_assessment(provider):
    model = StubModel({"verdict": "viable", "summary": "Looks approachable.", "reasons": ["Says contributions welcome."]})
    result = baseline.assess("a/b", provider, model)
    assert result.verdict is Verdict.VIABLE
    assert result.repo == "a/b"
    assert "baseline" in result.method


def test_the_prompt_carries_the_readme_and_metadata(provider):
    model = StubModel({"verdict": "viable", "summary": "s", "reasons": []})
    baseline.assess("a/b", provider, model)
    prompt = model.seen[0]["prompt"]
    assert "Contributions welcome." in prompt
    assert "'Python'" in prompt


def test_baseline_claims_carry_no_evidence_ids(provider):
    """It never read a pull request, so its reasons must not be dressed as evidence."""
    model = StubModel({"verdict": "viable", "summary": "s", "reasons": ["Active looking."]})
    result = baseline.assess("a/b", provider, model)
    assert result.claims and all(c.evidence_id is None for c in result.claims)
    assert "`" not in result.render().split("## Evidence")[-1]


def test_insufficient_evidence_is_a_verdict_the_baseline_can_reach(provider):
    model = StubModel({"verdict": "insufficient_evidence", "summary": "Cannot tell.", "reasons": []})
    assert baseline.assess("a/b", provider, model).verdict is Verdict.INSUFFICIENT_EVIDENCE


def test_replay_is_declared_in_the_rendered_report(provider):
    model = StubModel({"verdict": "viable", "summary": "s", "reasons": []}, replayed=True)
    assert "Replaying recorded model output" in baseline.assess("a/b", provider, model).render()


def test_replay_key_changes_when_the_prompt_changes():
    """A stale recording must not be served for a question that has changed."""
    assert call_key("baseline", "sys", "p1") != call_key("baseline", "sys", "p2")


def documented_baseline_repos() -> list[str]:
    """Every `python -m eval.baseline <repo>` the reproduction guide prints."""
    text = Path("docs/research/REPRODUCTION.md").read_text(encoding="utf-8")
    return re.findall(r"python -m eval\.baseline (\S+/\S+)", text)


def test_the_guide_documents_the_baseline():
    assert documented_baseline_repos(), "REPRODUCTION.md no longer shows the baseline"


@pytest.mark.parametrize("repo", documented_baseline_repos())
def test_every_documented_baseline_command_replays(repo, capsys):
    """The documented baseline answers from the committed recordings, no key."""
    assert baseline.main([repo]) == 0
    out = capsys.readouterr().out
    assert repo in out and "Replaying recorded model output" in out
