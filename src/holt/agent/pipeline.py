"""A -> B -> C -> D -> verdict -> E.

The ordering that matters: the verdict is computed *before* narration and handed
to Stage E as an input it cannot alter. If the report and verdict.py could
disagree, the determinism claim would be worth nothing.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime

from holt.agent import landing, landing_detection, narration, stages
from holt.agent.findings import Finding, Findings
from holt.agent.signals import MIN_AGE_HOURS, Signals, Thread, build_threads, compute, newcomer_threads
from holt.agent.verdict import classify as decide
from holt.agent.verdict import Rule, contested_kind, hours_phrase, headline, legacy_trace
from holt.agent.verify import check_quotes, spoken_words, verify
from holt.evidence.provider import EvidenceProvider
from holt.model import ModelClient
from holt.report import Assessment, Claim

log = logging.getLogger("holt.report")

MAX_CLAIM_CHARS = 240
MAX_QUOTE_CHARS = 180

# A model's rationale is its reading of the evidence, not the evidence. Where
# one is shown next to a verified citation it says so, so a reader cannot take
# the model's words for something the record says.
MODEL_NOTE_LABEL = "AI's reading, not a quote"

# Assessment fields written by a model in the full pipeline. Everything else --
# the verdict, the rules, the counts, the landing table, the citations -- is
# computed. Carried on the Trace so a front end can label these as AI-written.
MODEL_WRITTEN_FIELDS = ("summary", "bottom_line", "limits")

# Called with a plain-English stage and overall progress from 0 to 1. The web
# server streams these to the browser as they happen.
Progress = Callable[[str, float], None]


def _reporter(progress: Progress | None) -> Progress:
    """Never let a broken progress callback break an analysis."""
    if progress is None:
        return lambda stage, fraction: None

    def report(stage: str, fraction: float) -> None:
        try:
            progress(stage, max(0.0, min(1.0, fraction)))
        except Exception:  # noqa: BLE001 - a display hook must not fail the run
            pass

    return report


def _min_age(provider: EvidenceProvider, min_age_hours: float | None) -> float:
    """The "too new to judge" window: on for live reads, off for frozen captures."""
    if min_age_hours is not None:
        return min_age_hours
    return MIN_AGE_HOURS if getattr(provider, "judges_recency", True) else 0.0


def clip(text: str, limit: int) -> str:
    """Cut on a word boundary. Cutting mid-word reads as a bug, because it is one."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    head = text[:limit]
    cut = max(head.rfind(" "), head.rfind(". "))
    return (head[:cut] if cut > limit // 2 else head).rstrip(" ,;:.") + "…"


@dataclass(slots=True)
class Trace:
    """What happened, for the demo and the trajectory record."""

    signals: Signals
    before_verification: int = 0
    after_verification: int = 0
    dropped: list[Finding] = field(default_factory=list)
    # Findings whose id resolved but whose quotation is not in the record.
    invented: list[Finding] = field(default_factory=list)
    rules: list[str] = field(default_factory=list)
    # Which Assessment fields a model wrote; empty when no model ran.
    model_written: tuple[str, ...] = ()
    # Narrated sentences the narration check removed: (field, sentence, why).
    unsupported_sentences: list[tuple[str, str, str]] = field(default_factory=list)
    # Seconds per stage ("fetch", "classify", "opportunity", "outcomes",
    # "narrate") and "total", for AI reports. Classify, opportunity and
    # outcomes overlap, so the stages add up to more than the total.
    timings: dict[str, float] = field(default_factory=dict)


def analyze(
    repo: str,
    provider: EvidenceProvider,
    model: ModelClient | None,
    contributor_days: int = 7,
    as_of: datetime | None = None,
    progress: Progress | None = None,
    min_age_hours: float | None = None,
) -> tuple[Assessment, Trace]:
    """The full assessment. The web server and the CLI both call this.

    `progress`, if given, is called with a plain-English stage and a fraction
    from 0 to 1 as each stage starts, and with ("Done", 1.0) at the end.

    `min_age_hours` is how new an unanswered pull request can be before its
    silence counts as being ignored, measured back from `as_of` (or now). By
    default it applies to live evidence and not to committed fixtures, whose
    published numbers were computed without it.
    """
    if model is None:
        return analyze_without_model(
            repo, provider, contributor_days, as_of,
            progress=progress, min_age_hours=min_age_hours,
        )
    report = _reporter(progress)
    started = time.monotonic()
    timings: dict[str, float] = {}
    report("Fetching pull requests", 0.0)
    records = provider.fetch(repo)
    timings["fetch"] = round(time.monotonic() - started, 2)
    report("Counting replies and merges", 0.3)
    threads = build_threads(records)
    signals = compute(
        threads, as_of or datetime.now(UTC), _min_age(provider, min_age_hours)
    )

    report("Reading threads", 0.35)
    findings = _read_in_parallel(repo, records, threads, model, timings)

    report("Checking evidence", 0.75)
    before = len(findings)
    findings, dropped = verify(findings, provider)

    # `repo_kind` is the only model-derived field that can decide the answer by
    # itself, and Stage D cannot check it -- an id resolving says nothing about
    # whether a classification is true. Where the evidence contradicts the
    # reason the kind rule would give, the field is dropped before it decides
    # anything and the disagreement is printed. See eval/PREREGISTRATION-4.md.
    meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
    contested = contested_kind(findings, signals, meta.payload if meta else None)
    if contested:
        findings.drop("repo_kind")

    verdict, rules = decide(findings, signals, contributor_days)
    if contested:
        rules.insert(0, contested)
    # The narration prompt is deliberately held to the signal fields that existed
    # when the trajectories were recorded. New signals reach the *verdict*
    # immediately but only reach the prose on the next re-record, so adding one
    # does not invalidate every committed trajectory and break replay for a judge.
    # When a new signal changes the outcome it still reaches the narrator, via
    # the rule trace.
    narrated_signals = {
        k: v for k, v in signals.as_dict().items()
        if k not in ("reviewed_share", "merge_rate", "merged_files_median",
                     "merged_dirs_median", "merged_with_files")
    }
    # Likewise the rule trace: the reader sees plain sentences, and the narrator
    # is handed the wording the recordings were made with.
    narrated_signals = {
        k: v for k, v in narrated_signals.items()
        if k not in ("outsider_awaiting_reply", "outsider_answered")
    }
    report("Writing the report", 0.85)
    trace_lines = legacy_trace(rules)
    with _timed(timings, "narrate"):
        narrated = stages.narrate(
            repo, verdict.value, trace_lines, findings, narrated_signals, model
        )

    # The prose is checked like the findings were: a sentence stating a figure
    # that was not measured, quoting words nobody but the author (or a program)
    # wrote, or naming an internal field is removed. Where that empties a field,
    # the computed wording stands in, so the reader is never shown a blank.
    checked, unsupported = narration.check_narration(
        {k: narrated[k] for k in ("bottom_line", "what_the_evidence_shows",
                                  "what_could_not_be_determined")},
        signals.as_dict(), [*trace_lines, *map(str, rules)], spoken_words(records),
        extra_numbers=(contributor_days,),
    )
    # After narration, so the prompt the recordings were made with is unchanged.
    _say_how_merges_landed(rules, threads)

    # The evidence list is built from verified findings, not written by the
    # model. Stage E supplies prose; it cannot introduce a citation.
    #
    # The quote check runs here rather than inside Stage D on purpose. A claim
    # whose id does not resolve is worthless to everyone, narrator included, so
    # `verify` removes it before anything else runs. A claim whose id resolves
    # but whose words are not in the record is a different failure: the thread
    # is real and the outcome may well be right, and what must not reach the
    # reader is the quotation. Filtering the claim list is exactly that, and it
    # leaves the narration prompt byte-identical, so every committed trajectory
    # still replays -- a guarantee that would otherwise cost a re-record of the
    # frozen benchmark to buy.
    quoting, invented = check_quotes(findings, records)
    claims: list[Claim] = []
    for item in quoting:
        if item.field == "thread_outcome":
            outcome = item.value["outcome"].replace("_", " ")
            quote = (item.value.get("quote") or "").strip()
            # An empty quote used to render as a pair of quotation marks with
            # nothing between them, which reads as a bug because it is one.
            text = (f"{outcome} — “{clip(quote, MAX_QUOTE_CHARS)}”" if quote
                    else f"{outcome}, nothing said")
        else:
            text = f"{item.field.replace('_', ' ')}: {item.value}" + (
                f" ({MODEL_NOTE_LABEL}: {clip(item.note, MAX_CLAIM_CHARS)})"
                if item.note else "")
        claims.append(Claim(text=text, evidence_id=item.evidence_ids[0]))

    assessment = Assessment(
        repo=repo,
        verdict=verdict,
        summary=checked["what_the_evidence_shows"] or _counted_summary(signals),
        bottom_line=checked["bottom_line"] or _computed_bottom_line(verdict, rules),
        limits=checked["what_could_not_be_determined"],
        rules=list(rules),
        contributor_days=contributor_days,
        as_of=as_of,
        landing=landing.render(landing.compute(threads)),
        claims=claims,
        method="holt (A classify, B opportunity, C outcomes, D verify, deterministic verdict, E narrate)",
        replayed=model.replayed,
        models=list(model.usage.models),
        dropped_claims=len(dropped) + len(invented),
    )
    timings["total"] = round(time.monotonic() - started, 2)
    usage = model.usage
    log.info(
        "ai report %s: %.1fs (%s), %d in / %d out tokens, $%.4f, %s; "
        "%d claims dropped, %d sentences removed",
        repo, timings["total"],
        ", ".join(f"{k} {v:.1f}s" for k, v in timings.items() if k != "total"),
        usage.input_tokens, usage.output_tokens, usage.cost_usd,
        ", ".join(usage.models) or "no model", len(dropped) + len(invented),
        len(unsupported),
    )
    report("Done", 1.0)
    return assessment, Trace(
        signals=signals,
        before_verification=before,
        after_verification=len(findings),
        dropped=dropped,
        invented=invented,
        rules=rules,
        model_written=MODEL_WRITTEN_FIELDS,
        unsupported_sentences=unsupported,
        timings=timings,
    )


# Stages A, B and C read different evidence and write different findings, so
# they run at once: a report waits for the slowest of three calls instead of
# the sum. Each writes into its own list and the lists are joined in the fixed
# order A, B, C, so the narration prompt -- and the replay key it hashes to --
# is the same as when they ran one after another.
_READERS = (
    ("classify", lambda repo, records, threads, model, out:
        stages.classify(repo, records, threads, model, out)),
    ("opportunity", lambda repo, records, threads, model, out:
        stages.assess_opportunity(repo, records, model, out)),
    ("outcomes", lambda repo, records, threads, model, out:
        stages.read_outcomes(repo, threads, model, out, records=records)),
)


def _read_in_parallel(repo, records, threads, model, timings: dict[str, float]) -> Findings:
    def run(name, stage):
        out = Findings()
        with _timed(timings, name):
            stage(repo, records, threads, model, out)
        return out

    with ThreadPoolExecutor(max_workers=len(_READERS)) as pool:
        futures = [pool.submit(run, name, stage) for name, stage in _READERS]
        parts = [f.result() for f in futures]
    merged = Findings()
    for part in parts:
        merged.items.extend(part.items)
    return merged


@contextmanager
def _timed(timings: dict[str, float], name: str):
    began = time.monotonic()
    try:
        yield
    finally:
        timings[name] = round(time.monotonic() - began, 2)


def _computed_bottom_line(verdict, rules) -> str:
    deciding = next((r for r in rules if getattr(r, "code", "") != "awaiting_reply"),
                    rules[0] if rules else "")
    return f"{headline(verdict)}. {deciding}"


def _counted_summary(signals: Signals) -> str:
    """The counts in a few sentences, computed. Used with no model, and
    wherever the model's version did not survive the narration check."""
    s = signals.as_dict()
    if not signals.outsider_threads:
        return (
            "Nobody from outside the project opened a pull request in the period "
            "we looked at, so there was nothing to count."
        )
    summary = (
        f"{s['outsider_merged']} of {s['outsider_threads']} pull requests from "
        f"newcomers were merged, by {s['distinct_merged_authors']} of the "
        f"{s['distinct_outsider_authors']} people who tried."
    )
    if s["median_first_response_hours"] is not None:
        summary += (
            f" Of the {s['outsider_answered']} that got a reply, half heard "
            f"back within {hours_phrase(s['median_first_response_hours'])}."
        )
    summary += f" {s['outsider_ignored']} got no reply at all."
    if s["outsider_awaiting_reply"]:
        summary += (
            f" {s['outsider_awaiting_reply']} are too new to have had a reply "
            "yet and weren't counted as ignored."
        )
    return summary + " These are counts from the pull request history, not an AI's judgement."


# --- degraded mode -----------------------------------------------------------
#
# The project measured its own model stages at +0.01 MCC over the arithmetic
# (Iteration 22). A finding that large about your own architecture should change
# the architecture, not just the write-up: if the rules decide the verdict, the
# verdict must be obtainable without a model, and the reader must be told what
# they lost. That is this function.
#
# It is not a second implementation of the verdict. It calls the same `decide`
# on the same `Signals`, so the two modes cannot disagree about a repository
# they both have findings for -- a test asserts exactly that over the pool.
# What it does not do is write: Stages A, B, C and E never run, so there are no
# thread quotes, no narration, and no `repo_kind`. That absence is the point of
# `eval/evidence_integrity.py`'s yield column, and it is stated on the report
# rather than left for the reader to notice.

NO_MODEL_METHOD = (
    "holt --no-model (deterministic verdict from arithmetic; "
    "stages A, B, C and E did not run)"
)


def analyze_without_model(
    repo: str,
    provider: EvidenceProvider,
    contributor_days: int = 7,
    as_of: datetime | None = None,
    progress: Progress | None = None,
    min_age_hours: float | None = None,
) -> tuple[Assessment, Trace]:
    """The verdict, with no model call anywhere and the cost of that printed.

    `progress` and `min_age_hours` behave as in `analyze`.
    """
    report = _reporter(progress)
    report("Fetching pull requests", 0.0)
    records = provider.fetch(repo)
    report("Counting replies and merges", 0.6)
    threads = build_threads(records)
    signals = compute(
        threads, as_of or datetime.now(UTC), _min_age(provider, min_age_hours)
    )

    findings = Findings()
    # `is_archived` is a structured GitHub field. Stage A was asking a model to
    # read a boolean the provider already had, which is the clearest single
    # illustration of why the model stages measured +0.01: some of what they
    # were doing did not need a model at all. Here it is taken from the record
    # and cited to it.
    meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
    if meta is not None and meta.payload.get("is_archived"):
        findings.add("is_archived", True, (meta.evidence_id,),
                     "GitHub reports this repository as archived")
    # A mirror or a fork: GitHub's own fields, plus whether anything from a
    # newcomer landed here (a fork that merges outsiders is its own project).
    if meta is not None and (
        elsewhere := landing_detection.elsewhere(meta.payload, signals.outsider_merged)
    ):
        findings.add("contribute_elsewhere", elsewhere, (meta.evidence_id,),
                     "read from GitHub's mirror and fork fields and the description")

    report("Applying the rules", 0.9)
    verdict, rules = decide(findings, signals, contributor_days)
    _say_how_merges_landed(rules, threads)

    return Assessment(
        repo=repo,
        verdict=verdict,
        summary=_counted_summary(signals),
        bottom_line=_computed_bottom_line(verdict, rules),
        limits=(
            "No model ran. This answer comes from counting the pull request "
            "history, so it can't tell you what specific threads said, who was "
            "welcoming, or what kind of project this is, and it cites no specific "
            "threads, where a full AI report cites about 12. In our testing on "
            "repositories it hadn't seen, counting alone predicted how newcomers "
            "would fare a little less well than the full report (a score of 0.55 "
            "against 0.63, where 1 is perfect). Ask for the AI report for "
            "something you can check thread by thread."
        ),
        rules=list(rules),
        contributor_days=contributor_days,
        as_of=as_of,
        landing=landing.render(landing.compute(threads)),
        claims=[
            Claim(text=f"{i.field.replace('_', ' ')}: {i.value}", evidence_id=i.evidence_ids[0])
            for i in findings
        ],
        method=NO_MODEL_METHOD,
        replayed=False,
        models=[],
        dropped_claims=0,
    ), _done(report, Trace(signals=signals, rules=rules))


# Rules after which how the merges happened is beside the point.
_NOT_ABOUT_MERGES = {"archived", "elsewhere", "closed_kind", "non_software_kind"}


def _say_how_merges_landed(rules: list[str], threads: dict[str, Thread]) -> None:
    """Add a line saying which merges GitHub shows as closed, and how they landed.

    Counting a pull request GitHub calls "closed" as merged is a claim the
    reader can check, so it is said next to the rules rather than done quietly.
    """
    if any(getattr(r, "code", "") in _NOT_ABOUT_MERGES for r in rules):
        return
    if line := landing_detection.landed_sentence(newcomer_threads(threads)):
        rules.append(Rule(line, code="landed_off_button"))


def _done(report: Progress, trace: Trace) -> Trace:
    report("Done", 1.0)
    return trace
