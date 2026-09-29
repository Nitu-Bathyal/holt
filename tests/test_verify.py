"""Stage D is the only stage that can remove a claim, so it is tested directly.

On a clean run it drops nothing, which is the correct outcome and also means the
rendered trajectories cannot demonstrate the behaviour. These tests do.
"""

from __future__ import annotations

from datetime import timedelta

from holt.agent.findings import Findings
from holt.agent.verify import check_quotes, verify
from holt.evidence.fixtures import FixtureProvider, write_fixture
from holt.types import T_CUTOFF, EvidenceRecord, Window

BEFORE = T_CUTOFF - timedelta(days=1)


def provider(tmp_path, ids):
    write_fixture(
        "a/b",
        Window.PRE_T,
        [EvidenceRecord(i, "github", "https://x", BEFORE, {"author": "sam"}) for i in ids],
        root=tmp_path,
    )
    p = FixtureProvider(Window.PRE_T, root=tmp_path)
    p.fetch("a/b")
    return p


def test_a_finding_with_no_resolving_evidence_is_dropped(tmp_path):
    p = provider(tmp_path, ["pr:a/b#1:opened"])
    f = Findings()
    f.add("repo_kind", "real_software", evidence_ids=("pr:a/b#999:opened",))
    kept, dropped = verify(f, p)
    assert len(kept) == 0 and len(dropped) == 1
    assert dropped[0].field == "repo_kind"


def test_an_unresolvable_citation_is_stripped_but_the_finding_survives(tmp_path):
    """Partial support is still support; the bad citation must not travel with it."""
    p = provider(tmp_path, ["pr:a/b#1:opened"])
    f = Findings()
    f.add("repo_kind", "registry", evidence_ids=("pr:a/b#1:opened", "pr:a/b#999:opened"))
    kept, dropped = verify(f, p)
    assert len(kept) == 1 and not dropped
    assert kept.items[0].evidence_ids == ("pr:a/b#1:opened",)


def test_a_finding_citing_nothing_at_all_is_dropped(tmp_path):
    """An uncited claim is exactly what this stage exists to remove."""
    f = Findings()
    f.add("repo_kind", "real_software")
    kept, dropped = verify(f, provider(tmp_path, ["pr:a/b#1:opened"]))
    assert len(kept) == 0 and len(dropped) == 1


def test_verification_never_rewrites_a_surviving_value(tmp_path):
    """It removes; it does not soften. A survivor comes through unchanged."""
    p = provider(tmp_path, ["repo:a/b:readme"])
    f = Findings()
    f.add("onboarding", "substantive", evidence_ids=("repo:a/b:readme",), note="because")
    kept, _ = verify(f, p)
    assert kept.items[0].value == "substantive"
    assert kept.items[0].note == "because"


# ─── quotation ──────────────────────────────────────────────────────────────
#
# A claim can cite a thread that exists and still put words in its mouth. The
# id resolving proves the thread is real; nothing about it proves the words are.


def records_for(number: str, bodies: list[str]) -> list[EvidenceRecord]:
    return [
        EvidenceRecord(
            f"pr:a/b#{number}:comment:{i}", "github", "https://x", BEFORE, {"body": body}
        )
        for i, body in enumerate(bodies)
    ]


def outcome(quote: str, number: str = "1") -> Findings:
    f = Findings()
    f.add(
        "thread_outcome",
        {"outcome": "changes_requested", "signal": "review", "quote": quote},
        evidence_ids=(f"pr:a/b#{number}:opened",),
    )
    return f


def test_a_quote_the_thread_never_said_takes_its_claim_with_it():
    records = records_for("1", ["Please add a test for the empty case."])
    kept, invented = check_quotes(outcome("We will never merge this."), records)
    assert not kept and len(invented) == 1


def test_a_real_quote_survives_the_formatting_a_model_applies():
    """Whitespace, case and punctuation are ours to forgive; the words are not."""
    records = records_for("1", ["Please add a test for the empty case, then ping me."])
    kept, invented = check_quotes(outcome("please add a  test for the empty case."), records)
    assert len(kept) == 1 and not invented


def test_a_quote_from_a_different_thread_is_not_evidence_for_this_one():
    """The failure that actually happens: real words, wrong pull request.

    `paperclipai/paperclip#7219` was cited for a sentence said on `#7166`, and
    `pingcap/tidb#68668` for one said on `#68652`. Both are in the committed
    fixtures, and both are removed by this rule.
    """
    records = records_for("1", ["Bump! We need this so bad."]) + records_for(
        "2", ["Unrelated."]
    )
    kept, invented = check_quotes(outcome("Bump! We need this so bad.", number="2"), records)
    assert not kept and len(invented) == 1


def test_quoting_our_own_speaker_tag_is_quoting_nobody():
    """`_render_thread` writes `[octocat]`; a reader shown that has been shown
    nothing, and no human said it."""
    records = records_for("1", ["Looks good to me."])
    kept, invented = check_quotes(outcome("[octocat]"), records)
    assert not kept and len(invented) == 1
    # ...but the tag in front of real words is our formatting, not the model's
    # invention, and must not cost the claim.
    kept, invented = check_quotes(outcome("[octocat] Looks good to me."), records)
    assert len(kept) == 1 and not invented


def test_a_finding_that_quotes_nothing_is_not_accused_of_anything():
    """Silence is a real outcome. There is nothing here to check."""
    records = records_for("1", [])
    kept, invented = check_quotes(outcome(""), records)
    assert len(kept) == 1 and not invented


def test_the_quote_check_cannot_change_a_verdict():
    """The guard is deliberately verdict-neutral: `classify` reads only
    `repo_kind`, `is_archived`, `contribute_elsewhere` (a mirror or fork,
    from GitHub's repository fields), `personal_project` (agent/personal.py)
    and `inactive` (no merge and no push in 90 days) from findings, and all
    five are unquoted.
    A guard that could move a verdict would have needed the frozen benchmark
    re-run."""
    import inspect

    from holt.agent import verdict

    source = inspect.getsource(verdict.classify)
    assert "quote" not in source
    assert source.count("findings.get") == 5
