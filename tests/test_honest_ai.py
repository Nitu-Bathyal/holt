"""The AI report reads outsiders, quotes the right speaker, and says only what was measured.

Each test here pins one error the 27 Sep 2026 audit found in replayed AI
reports: insider threads read as outsider feedback (PostHog), a PR author's own
words passing as a maintainer's review, narration leaking field names and
unmeasured figures (odoo), automated posts quoted as people (nixpkgs), stages
run one after another with no output cap, and no record of cost or time.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from holt import model as model_mod
from holt.agent import narration, pipeline, stages
from holt.agent.findings import Findings
from holt.agent.signals import build_threads
from holt.agent.verify import automated_body, check_quotes, spoken_words
from holt.model import ModelsConfig, OpenAIModel, OutputLimitReached, Usage
from holt.types import EvidenceRecord

T0 = datetime(2026, 5, 1, tzinfo=UTC)


def rec(eid: str, minutes: int = 0, **payload) -> EvidenceRecord:
    return EvidenceRecord(eid, "github", "https://x", T0 + timedelta(minutes=minutes), payload)


def pr(n: int, author: str, assoc: str | None = "NONE", *, state: str = "open",
       replies=(), bot: bool = False) -> list[EvidenceRecord]:
    """One pull request: opened, optionally merged/closed, and replies (who, assoc, body)."""
    extra = {"author_association": assoc} if assoc is not None else {}
    out = [rec(f"pr:a/b#{n}:opened", 0, author=author, author_is_bot=bot,
               title=f"PR {n} by {author}", body=f"My change number {n} does things",
               files=["src/x.py"], **extra)]
    if state == "merged":
        out.append(rec(f"pr:a/b#{n}:merged", 500, author=author, merged=True))
    elif state == "closed":
        out.append(rec(f"pr:a/b#{n}:closed", 500, author=author, merged=False))
    for i, (who, who_assoc, body) in enumerate(replies):
        out.append(rec(f"pr:a/b#{n}:comment:{i}", 10 + i, author=who, author_is_bot=False,
                       author_association=who_assoc, body=body))
    return out


class Capture:
    replayed = False

    def __init__(self, answer):
        self.answer = answer
        self.calls: list[dict] = []
        self.usage = Usage()

    def complete(self, *, label, system, prompt, schema):
        self.calls.append({"label": label, "system": system, "prompt": prompt})
        return self.answer(prompt) if callable(self.answer) else self.answer


# ─── Outcomes reads outsider threads only ──────────────────────────────────


def mixed_repo() -> list[EvidenceRecord]:
    return [
        # Staff member's own PR, with their automated QA post and a colleague's review.
        *pr(1, "staff", "MEMBER", state="merged", replies=[
            ("staff", "MEMBER", "> 🤖 Automated comment by **QA Swarm** — not written by a human"),
            ("colleague", "MEMBER", "Looks great, merging now."),
        ]),
        # Outsider, reviewed by a maintainer; the author's own reply must go.
        *pr(2, "newcomer", "FIRST_TIME_CONTRIBUTOR", state="merged", replies=[
            ("newcomer", "FIRST_TIME_CONTRIBUTOR", "I fixed everything you asked for."),
            ("maint", "MEMBER", "Please add a test for the empty case first."),
            ("ci-helper", "NONE", "Approved automatically following the successful run of ci."),
        ]),
        *pr(3, "visitor", "NONE", state="closed", replies=[
            ("maint", "OWNER", "We are not taking this kind of change, sorry."),
        ]),
        *pr(4, "quiet", "NONE"),
        *pr(5, "dependabot[bot]", "NONE", bot=True, state="merged"),
        *pr(6, "helper", "CONTRIBUTOR", replies=[("passerby", "NONE", "+1 would love this")]),
    ]


def test_outcomes_reads_only_outsider_threads_without_self_replies_or_automation():
    records = mixed_repo()
    threads = build_threads(records)
    client = Capture({"threads": [], "posture": "mixed", "posture_rationale": "r"})
    stages.read_outcomes("a/b", threads, client, Findings(), records=records)

    prompt = model_mod.canonical(client.calls[0]["prompt"])
    shown = {int(line.split("#")[1].split(":")[0])
             for line in prompt.splitlines() if line.startswith("--- evidence id:")}
    assert shown == {2, 3, 4, 6}  # not the staff PR, not the bot's
    assert "QA Swarm" not in prompt and "Looks great" not in prompt
    assert "I fixed everything" not in prompt  # the author's own reply
    assert "Approved automatically" not in prompt
    assert "[maint, maintainer] Please add a test" in prompt
    assert "[passerby] +1 would love this" in prompt  # not labelled a maintainer
    assert client.calls[0]["system"].startswith(stages.OUTCOMES_SYSTEM + stages.OUTSIDER_NOTE)


def test_staff_with_private_membership_are_not_outsiders():
    """GitHub shows them as CONTRIBUTOR; merging other people's work gives them away."""
    records = [
        *pr(1, "quiet-staffer", "CONTRIBUTOR", replies=[("kim", "NONE", "Nice idea")]),
        *pr(2, "newcomer", "NONE", state="merged"),
    ]
    records.append(rec("pr:a/b#2:merged", 500, author="newcomer", merged=True,
                       merged_by="quiet-staffer", merged_by_is_bot=False))
    threads = build_threads(records)
    conversations = stages.outsider_conversations(records, threads)
    assert set(conversations) == {"pr:a/b#2"}


def test_outcomes_samples_across_outcomes_not_the_chattiest():
    records = []
    for n in range(1, 13):  # twelve merged threads with long conversations
        records += pr(n, f"m{n}", state="merged",
                      replies=[("maint", "MEMBER", f"review round {i}") for i in range(5)])
    for n in range(20, 24):
        records += pr(n, f"c{n}", state="closed")
    for n in range(30, 34):
        records += pr(n, f"q{n}")
    threads = build_threads(records)
    conversations = stages.outsider_conversations(records, threads)
    chosen = stages.stratified_sample(list(threads.values()), conversations, 12)
    numbers = [t.number for t in chosen]
    assert len(numbers) == 12
    assert sum(n < 20 for n in numbers) == 4  # merged no longer crowds out the rest
    assert sum(20 <= n < 30 for n in numbers) == 4
    assert sum(n >= 30 for n in numbers) == 4
    # Repeatable: the same evidence always reads the same threads.
    assert numbers == [t.number for t in
                       stages.stratified_sample(list(threads.values()), conversations, 12)]


def test_a_citation_to_a_thread_that_was_not_shown_is_dropped():
    records = mixed_repo()
    threads = build_threads(records)
    client = Capture({"threads": [
        {"pr_id": "pr:a/b#1:opened", "outcome": "merged_after_review",
         "signal": "welcoming", "quote": "Looks great, merging now."},
        {"pr_id": "3", "outcome": "closed_dismissive", "signal": "discouraging",
         "quote": "We are not taking this kind of change"},
    ], "posture": "mixed", "posture_rationale": "r"})
    findings = Findings()
    stages.read_outcomes("a/b", threads, client, findings, records=records)
    cited = [f.evidence_ids for f in findings if f.field == "thread_outcome"]
    assert cited == [("pr:a/b#3:opened",)]


def test_old_captures_keep_the_recorded_selection_so_replays_still_match():
    """No author_association: the prompt is the one the recordings were made with."""
    records = pr(1, "sam", assoc=None, replies=[("sam", "NONE", "bump"), ("kim", "NONE", "ok")])
    records = [EvidenceRecord(r.evidence_id, r.source, r.url, r.timestamp,
                              {k: v for k, v in r.payload.items() if k != "author_association"})
               for r in records]
    threads = build_threads(records)
    client = Capture({"threads": [], "posture": "mixed", "posture_rationale": "r"})
    stages.read_outcomes("a/b", threads, client, Findings(), records=records)
    prompt = model_mod.canonical(client.calls[0]["prompt"])
    assert "[AUTHOR] bump" in prompt and "[kim] ok" in prompt
    assert client.calls[0]["system"] == model_mod.guarded(stages.OUTCOMES_SYSTEM)


# ─── the quote check knows who spoke ───────────────────────────────────────


def outcome(n: int, quote: str, what: str = "changes_requested") -> Findings:
    f = Findings()
    f.add("thread_outcome", {"outcome": what, "signal": "welcoming", "quote": quote},
          evidence_ids=(f"pr:a/b#{n}:opened",))
    return f


def test_the_authors_own_description_is_not_a_maintainers_review():
    records = pr(1, "sam", replies=[("kim", "MEMBER", "Please rename the helper.")])
    kept, invented = check_quotes(outcome(1, "My change number 1 does things"), records)
    assert not kept and len(invented) == 1
    kept, invented = check_quotes(outcome(1, "PR 1 by sam"), records)  # the title
    assert not kept and len(invented) == 1
    kept, _ = check_quotes(outcome(1, "Please rename the helper."), records)
    assert len(kept) == 1


def test_the_authors_own_replies_and_automated_posts_are_not_quotable():
    records = mixed_repo()
    for quote in ("I fixed everything you asked for.",
                  "Approved automatically following the successful run of ci."):
        kept, invented = check_quotes(outcome(2, quote), records)
        assert not kept and invented, quote
    kept, invented = check_quotes(
        outcome(1, "Automated comment by QA Swarm — not written by a human"), records)
    assert not kept and invented


def test_a_bot_account_is_not_a_speaker():
    records = pr(1, "sam") + [rec("pr:a/b#1:review:0", 5, author="stamphog",
                                  author_is_bot=True, body="Review agent failed after 3 attempts")]
    assert "Review agent" not in spoken_words(records).get("1", "")


@pytest.mark.parametrize("body,automated", [
    ("> [!NOTE]\n> 🤖 Automated comment by **QA Swarm** — not written by a human", True),
    ("## `nixpkgs-review` result\nGenerated using [`nixpkgs-review`].", True),
    ("<!-- This is an auto-generated comment: summarize by coderabbit.ai -->", True),
    ("@robodoo r+", True),
    ("@NixOS/nixpkgs-merge-bot merge", True),
    ("@alice can you rebase this?", False),
    ("Thanks! Please add a test.", False),
])
def test_automated_bodies_are_recognised(body, automated):
    assert automated_body(body) is automated


def test_a_posture_built_on_rejected_quotes_goes_with_them():
    records = pr(1, "sam") + pr(2, "lee") + pr(3, "kai", replies=[("m", "MEMBER", "Nice work")])
    f = Findings()
    f.add("outsider_posture", "welcoming",
          evidence_ids=("pr:a/b#1:opened", "pr:a/b#2:opened", "pr:a/b#3:opened"))
    for n in (1, 2):
        f.add("thread_outcome", {"outcome": "merged_after_review", "signal": "welcoming",
                                 "quote": f"My change number {n} does things"},
              evidence_ids=(f"pr:a/b#{n}:opened",))
    kept, invented = check_quotes(f, records)
    assert [i.field for i in kept] == []
    assert {i.field for i in invented} == {"outsider_posture", "thread_outcome"}


# ─── the narration is fact-checked ─────────────────────────────────────────

SIGNALS = {"outsider_threads": 88, "outsider_merged": 30, "outsider_ignored": 42,
           "median_first_response_hours": 0.8, "bot_share": 0.155,
           "distinct_outsider_authors": 56, "distinct_merged_authors": 30}


def check(text: str, trace=(), spoken=None):
    out, removed = narration.check_narration(
        {"bottom_line": text}, SIGNALS, trace, spoken or {}, extra_numbers=(7,))
    return out["bottom_line"], removed


def test_internal_field_names_never_reach_the_reader():
    text, removed = check("Nobody landed anything; distinct_merged_authors is 0. It is quiet.")
    assert text == "It is quiet."
    assert "internal field" in removed[0][2]


def test_a_figure_that_was_not_measured_is_removed():
    text, removed = check("30 of 88 were merged. About 70% of newcomers were welcomed.")
    assert text == "30 of 88 were merged."
    assert "70" in removed[0][2]


def test_figures_written_the_way_people_write_them_are_kept():
    for sentence in ("Half heard back within 48 minutes.",
                     "Bots account for ~15.5% of activity.",
                     "42 of 88 got no reply, so 46 did.",
                     "About 34% were merged.",
                     "It is judged for someone with 7 days."):
        text, removed = check(sentence)
        assert text == sentence and not removed, removed


def test_a_quote_must_be_something_a_non_author_said():
    spoken = {"2": "Please add a test for the empty case first."}
    text, _ = check("A maintainer asked: “Please add a test for the empty case.”", spoken=spoken)
    assert text
    text, removed = check("They wrote “Approved automatically following the run”.", spoken=spoken)
    assert not text and "quotes" in removed[0][2]


def test_paragraph_breaks_survive_the_check():
    out, _ = narration.check_narration(
        {"s": "30 were merged.\n\nBots are 99% of it. 42 got no reply."}, SIGNALS, (), {})
    assert out["s"] == "30 were merged.\n\n42 got no reply."


# ─── the pipeline: parallel, capped, measured ──────────────────────────────


class Provider:
    judges_recency = False

    def __init__(self, records):
        self.records = records
        self.ids = {r.evidence_id for r in records}

    def fetch(self, repo):
        return list(self.records)

    def resolve(self, evidence_id):
        return evidence_id if evidence_id in self.ids else None


class Parallel(Capture):
    """Answers each stage; A, B and C must all be in flight at once to get past the barrier."""

    def __init__(self, narrated):
        super().__init__(None)
        self.barrier = threading.Barrier(3, timeout=10)
        self.narrated = narrated

    def complete(self, *, label, system, prompt, schema):
        if label == "narrate":
            self.calls.append({"label": label, "system": system, "prompt": prompt})
            return self.narrated
        self.barrier.wait()  # raises BrokenBarrierError if the stages ran one at a time
        return {
            "classify": {"repo_kind": "real_software", "confidence": "high", "rationale": "r",
                         "evidence_ids": ["pr:a/b#2:opened"], "governance_flags": []},
            "opportunity": {"onboarding": "absent", "rationale": "r",
                            "evidence_ids": ["pr:a/b#2:opened"]},
            "outcomes": {"threads": [{
                "pr_id": "2", "outcome": "merged_after_review", "signal": "welcoming",
                "quote": "Please add a test for the empty case first."}],
                "posture": "mixed", "posture_rationale": "r"},
        }[label]


def test_stages_a_b_c_run_at_once_in_a_fixed_order_and_the_report_is_timed(caplog):
    client = Parallel({"bottom_line": "You will wait; distinct_merged_authors is tiny.",
                       "what_the_evidence_shows": "Exactly 999 people were welcomed.",
                       "what_could_not_be_determined": ""})
    with caplog.at_level("INFO", logger="holt.report"):
        assessment, trace = pipeline.analyze("a/b", Provider(mixed_repo()), client,
                                             as_of=T0 + timedelta(days=30))
    # Joined in the order A, B, C whatever order they finished in, so the
    # narration prompt (and its replay key) does not depend on timing.
    narrate = model_mod.canonical(client.calls[-1]["prompt"]) if client.calls else ""
    order = [narrate.index(f"  {name} =") for name in
             ("repo_kind", "onboarding", "outsider_posture", "thread_outcome")]
    assert order == sorted(order)
    assert set(trace.timings) >= {"fetch", "classify", "opportunity", "outcomes",
                                  "narrate", "total"}
    # Both narrated fields failed the check, so the computed wording stands in.
    assert assessment.bottom_line == pipeline._computed_bottom_line(assessment.verdict,
                                                                    trace.rules)
    assert "999" not in assessment.summary and "not an AI's judgement" in assessment.summary
    assert len(trace.unsupported_sentences) == 2
    assert "ai report a/b" in caplog.text and "sentences removed" in caplog.text


# ─── every provider call is capped ─────────────────────────────────────────


class FakeOpenAI:
    def __init__(self, finish="stop"):
        self.kwargs = None
        self.finish = finish
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            choices=[SimpleNamespace(finish_reason=self.finish,
                                     message=SimpleNamespace(content="{}"))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))


@pytest.mark.parametrize("provider,param", [("openai", "max_completion_tokens"),
                                            ("openrouter", "max_tokens")])
def test_every_openai_wire_call_sets_an_output_cap(monkeypatch, provider, param):
    monkeypatch.setattr(model_mod, "_user_config", ModelsConfig(provider=provider))
    fake = FakeOpenAI()
    OpenAIModel(_client=fake).complete(label="outcomes", system="s", prompt="p", schema={})
    assert fake.kwargs[param] == model_mod.max_output_tokens("outcomes")


def test_a_call_cut_off_at_the_cap_fails_loudly(monkeypatch):
    monkeypatch.setattr(model_mod, "_user_config", ModelsConfig(provider="openrouter"))
    with pytest.raises(OutputLimitReached):
        OpenAIModel(_client=FakeOpenAI("length")).complete(
            label="narrate", system="s", prompt="p", schema={})


def test_openrouter_model_names_are_priced():
    usage = Usage()
    usage.add("openai/gpt-5-mini", 1_000_000, 0)
    assert usage.cost_usd == pytest.approx(0.25)
