"""The degraded mode: a verdict with no model, and an honest account of the cost.

`--no-model` exists because the project measured its own model stages at +0.01
MCC on the verdict. If the rules decide, the verdict must be obtainable without
a model. What must not happen is the mode quietly presenting itself as a full
report, so the tests here are as much about what it *says* as what it decides.
"""

from __future__ import annotations

import pytest

from holt.agent import repo_kind_rules
from holt.agent.findings import Findings
from holt.agent.pipeline import NO_MODEL_METHOD, analyze
from holt.agent.signals import build_threads, compute
from holt.agent.verdict import classify
from holt.evidence.fixtures import FixtureProvider
from holt.types import Window

REPOS = ["NixOS/nixpkgs", "is-a-dev/register", "space-wizards/space-station-14"]


@pytest.fixture
def provider() -> FixtureProvider:
    return FixtureProvider(Window.PRE_T)


@pytest.mark.parametrize("repo", REPOS)
def test_no_model_calls_no_model(repo: str, provider: FixtureProvider) -> None:
    # Passing None is the only route into this mode, and it is the whole
    # guarantee: there is no client to call.
    assessment, _ = analyze(repo, provider, None)
    assert assessment.models == []
    assert assessment.method == NO_MODEL_METHOD
    assert assessment.replayed is False


@pytest.mark.parametrize("repo", REPOS)
def test_the_verdict_is_the_same_function_the_full_pipeline_uses(
    repo: str, provider: FixtureProvider
) -> None:
    """Not a second implementation. Same `classify`, same `Signals`."""
    assessment, trace = analyze(repo, provider, None)
    records = list(provider.fetch(repo))
    threads = build_threads(records)

    # Rebuild the exact call the mode makes: the only seeded findings are the
    # archived flag, taken from metadata, and a catalogue measured from the
    # diffs -- neither asked of a model.
    seed = Findings()
    meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
    if meta is not None and meta.payload.get("is_archived"):
        seed.add("is_archived", True, (meta.evidence_id,), "")
    kind = repo_kind_rules.read(records)
    if kind.catalogue is not None:
        repo_kind_rules.add_finding(seed, kind.catalogue)
    expected, rules = classify(seed, compute(threads), 7)
    assert assessment.verdict == expected
    assert assessment.rules == repo_kind_rules.explain(list(rules), kind, expected)
    assert trace.signals == compute(threads)


@pytest.mark.parametrize("repo", REPOS)
def test_every_claim_still_resolves(repo: str, provider: FixtureProvider) -> None:
    """The evidence rule does not relax because the model is gone."""
    assessment, _ = analyze(repo, provider, None)
    for claim in assessment.claims:
        assert claim.evidence_id is not None
        assert provider.resolve(claim.evidence_id) is not None


@pytest.mark.parametrize("repo", REPOS)
def test_it_says_what_was_lost_and_what_that_cost(
    repo: str, provider: FixtureProvider
) -> None:
    """A degraded report that does not disclose the degradation is worse than none."""
    assessment, _ = analyze(repo, provider, None)
    limits = assessment.limits
    assert "No model ran" in limits
    # What it can't tell you, in words a beginner reads. The benchmark score
    # it used to quote ("0.55 against 0.63") is research detail, and lives in
    # docs/research/EVALUATION.md, not in product output.
    assert "what specific threads said" in limits
    assert "0.55" not in limits and "MCC" not in limits and "stages" not in limits


@pytest.mark.parametrize("repo", REPOS)
def test_the_time_budget_still_reaches_the_verdict(
    repo: str, provider: FixtureProvider
) -> None:
    """`--days` is arithmetic, so it must work in the mode with only arithmetic."""
    threads = build_threads(provider.fetch(repo))
    signals = compute(threads)
    if signals.median_first_response_hours is None:
        pytest.skip("no response times recorded for this repository")
    patient, _ = analyze(repo, provider, None, contributor_days=3650)
    hurried, _ = analyze(repo, provider, None, contributor_days=1)
    assert patient.contributor_days == 3650 and hurried.contributor_days == 1
    # Same evidence, different budgets: the rule trace must reflect the budget
    # it was given rather than a cached one.
    assert isinstance(patient.rules, list) and isinstance(hurried.rules, list)
