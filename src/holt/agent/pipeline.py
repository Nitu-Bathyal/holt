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

from holt.agent import (
    examples, labels, landing, landing_detection, narration, personal, rates, repo_kind_rules,
    stages,
)
from holt.agent.findings import Finding, Findings
from holt.agent.signals import (
    MIN_AGE_HOURS,
    Signals,
    Thread,
    build_threads,
    compute,
    outsider_threads,
)
from holt.agent.verdict import classify as decide
from holt.agent.verdict import Rule, contested_kind, hours_phrase, headline, legacy_trace
from holt.agent.verify import check_quotes, knows_association, spoken_words, verify
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


def claim_for(item: Finding, text: str | None = None, show_note: bool = True) -> Claim:
    """A verified finding as the evidence list shows it: plain words, never an
    enum value (labels.py), with what it is about kept apart for code."""
    if item.field == "thread_outcome":
        outcome = item.value["outcome"]
        quote = (item.value.get("quote") or "").strip()
        # An empty quote used to render as a pair of quotation marks with
        # nothing between them, which reads as a bug because it is one.
        text = (f"{labels.outcome(outcome)} — “{clip(quote, MAX_QUOTE_CHARS)}”" if quote
                else labels.outcome(outcome, quoted=False))
        return Claim(text=text, evidence_id=item.evidence_ids[0], kind="outcome",
                     value=outcome, quote=clip(quote, MAX_QUOTE_CHARS) if quote else "")
    note = clip(item.note, MAX_CLAIM_CHARS) if item.note and show_note else ""
    if text is None:
        text = f"{labels.field(item.field)}: {labels.value(item.field, item.value)}" + (
            f" ({MODEL_NOTE_LABEL}: {note})" if note else "")
    value = (",".join(map(str, item.value)) if isinstance(item.value, list | tuple)
             else str(item.value))
    return Claim(text=text, evidence_id=item.evidence_ids[0], kind=item.field,
                 value=value, note=note)


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
    read_at = as_of or datetime.now(UTC)
    signals = compute(threads, read_at, _min_age(provider, min_age_hours))
    # Live evidence says who is on the team. The model stages then see only the
    # team's replies and plain words (labels, rule sentences, durations); older
    # captures keep the prompts their recordings were made with.
    plain = knows_association(records)

    report("Reading threads", 0.35)
    findings = _read_in_parallel(repo, records, threads, model, timings,
                                 read_at, signals.settle_hours)

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
    _add_personal(findings, records, threads, signals, as_of, meta)
    _add_inactive(findings, records, threads, signals, as_of, meta)

    verdict, rules = decide(findings, signals, contributor_days)
    if contested:
        rules.insert(0, contested)
    report("Writing the report", 0.85)
    with _timed(timings, "narrate"):
        # Live evidence: the narrator reads only findings whose quotes passed
        # the team-only check, so a bystander's words can't reach the prose.
        # Older captures keep the order their recordings were made with.
        told = Findings(check_quotes(findings, records)[0]) if plain else findings
        checked, unsupported = _narrate(
            repo, verdict, rules, told, signals, records, model, plain,
            contributor_days,
        )
    # After narration, so the prompt the recordings were made with is unchanged.
    _say_how_merges_landed(rules, threads, as_of, _min_age(provider, min_age_hours))
    _say_what_was_read(rules, records, threads, as_of, _min_age(provider, min_age_hours))

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
    claims = [claim_for(item) for item in quoting]

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
        "ai report %s: %.1fs (%s; model %s), %d in / %d out tokens, $%.4f, %s; "
        "%d claims dropped, %d sentences removed",
        repo, timings["total"],
        ", ".join(f"{k} {v:.1f}s" for k, v in timings.items() if k != "total"),
        ", ".join(f"{k} {v}ms" for k, v in getattr(usage, "stage_ms", dict)().items())
        or "replayed",
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


NARRATED_FIELDS = ("bottom_line", "what_the_evidence_shows", "what_could_not_be_determined")


def _narrate(repo, verdict, rules, findings, signals: Signals, records, model,
             plain: bool, contributor_days: int):
    """Stage E, then its check: (checked fields, removed sentences).

    The prose is checked like the findings were: a sentence stating a figure
    that was not measured, quoting words nobody on the team said, or naming an
    internal field is removed. Where that empties a field, the computed
    wording stands in, so the reader is never shown a blank.

    On live evidence the narrator is handed what the reader sees: the rule
    sentences under "What decided it" and the counts in words, durations as
    "16.2 days". The legacy trace said "37 first-time merges ... out of 99
    attempts" where the page said "out of 90", and the prose repeated it.
    When the check removes the bottom line or the lead paragraph's opening,
    the narrator gets one more try with the reason (about $0.002): on nixpkgs
    one leaked field name cost the paragraph its main point.
    """
    if plain:
        trace_lines = [str(r) for r in rules]
        measured = plain_measurements(signals)
    else:
        trace_lines = legacy_trace(rules)
        measured = _legacy_measurements(signals)
    allowed = [*trace_lines, *map(str, rules)]
    extra = (contributor_days, signals.outsider_judgeable)
    spoken = spoken_words(records)

    def attempt(retry_note: str = ""):
        narrated = stages.narrate(repo, verdict.value, trace_lines, findings, measured,
                                  model, plain=plain, retry_note=retry_note)
        return narration.check_narration(
            {k: narrated[k] for k in NARRATED_FIELDS}, signals.as_dict(), allowed,
            spoken, extra_numbers=extra if plain else (contributor_days,),
        ) + (narrated,)

    checked, unsupported, narrated = attempt()
    lost = _lost_lead(narrated, unsupported)
    if plain and lost:
        again, removed, renarrated = attempt(narration.retry_note(lost))
        if len(_lost_lead(renarrated, removed)) < len(lost):
            checked, unsupported = again, removed
    return checked, unsupported


def _lost_lead(narrated: dict, unsupported: list[tuple[str, str, str]]) -> list[tuple[str, str]]:
    """Removed sentences from the bottom line or the lead paragraph: (sentence, why)."""
    lead = (narrated.get("what_the_evidence_shows") or "").split("\n\n")[0]
    return [(sentence, why) for name, sentence, why in unsupported
            if name == "bottom_line"
            or (name == "what_the_evidence_shows" and sentence in lead)]


def _legacy_measurements(signals: Signals) -> dict:
    """The counts as the committed recordings were made with them.

    Held to the signal fields that existed when the trajectories were recorded:
    new signals reach the *verdict* immediately but only reach the prose on the
    next re-record, so adding one does not invalidate every committed trajectory
    and break replay for a judge.
    """
    return {
        k: v for k, v in signals.as_dict().items()
        if k not in ("reviewed_share", "merge_rate", "merged_files_median",
                     "merged_dirs_median", "merged_with_files",
                     "outsider_answered", "outsider_still_open",
                     "outsider_closed_silently", "outsider_excluded",
                     "outsider_reviewed_share", "merged_threads",
                     "outsider_too_old", "outsider_landed_elsewhere")
        and not k.startswith(("first_timer_", "distinct_first_timer_", "first_pr_"))
    }


def plain_measurements(signals: Signals) -> dict[str, object]:
    """The counts for the narrator, in the words and units the page uses.

    "Outside contributors", not "first-time": these count everyone outside the
    team. Attempts are the decided ones, as on the page and in the rules.
    """
    median = signals.median_first_response_hours
    return {
        "Pull requests read": signals.total_threads,
        "Pull requests from outside contributors old enough to judge (the attempts)":
            signals.outsider_judgeable,
        "Attempts merged": signals.outsider_merged,
        "Attempts that got no reply at all from the project": signals.outsider_ignored,
        "Different outside contributors who tried": signals.distinct_outsider_authors,
        "Different outside contributors whose work was merged":
            signals.distinct_merged_authors,
        "Typical wait for a first reply, among attempts that got one":
            hours_phrase(median) if median is not None else "no replies to measure",
        "Share of pull request activity from bots": f"{signals.bot_share:.0%}",
        "Outside pull requests still too new to judge": signals.outsider_still_open,
        "Outside pull requests closed without a word (not counted as ignored)":
            signals.outsider_closed_silently,
    }


# Stages A, B and C read different evidence and write different findings, so
# they run at once: a report waits for the slowest of three calls instead of
# the sum. Each writes into its own list and the lists are joined in the fixed
# order A, B, C, so the narration prompt -- and the replay key it hashes to --
# is the same as when they ran one after another.
_READERS = (
    ("classify", lambda repo, records, threads, model, out, *_:
        stages.classify(repo, records, threads, model, out)),
    ("opportunity", lambda repo, records, threads, model, out, *_:
        stages.assess_opportunity(repo, records, model, out)),
    ("outcomes", lambda repo, records, threads, model, out, as_of, settle_hours:
        stages.read_outcomes(repo, threads, model, out, records=records,
                             as_of=as_of, settle_hours=settle_hours)),
)


def _read_in_parallel(repo, records, threads, model, timings: dict[str, float],
                      as_of: datetime | None = None, settle_hours: float = 0.0) -> Findings:
    def run(name, stage):
        out = Findings()
        with _timed(timings, name):
            stage(repo, records, threads, model, out, as_of, settle_hours)
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
    # None of these gives the reason: rates.py's lines say what was counted,
    # and the packaging one says what the work is (repo_kind_rules).
    deciding = rates.first_deciding(rules, skip=frozenset({"package_updates"})) or ""
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
        f"{s['outsider_merged']} of {signals.outsider_judgeable} pull requests from "
        f"outside contributors were merged, by {s['distinct_merged_authors']} of the "
        f"{s['distinct_outsider_authors']} people who tried."
    )
    summary += " " + first_timer_sentence(signals)
    if s["median_first_response_hours"] is not None:
        summary += (
            f" Of the {s['outsider_answered']} that got a reply, half heard "
            f"back within {hours_phrase(s['median_first_response_hours'])}."
        )
    summary += f" {s['outsider_ignored']} got no reply at all."
    if s["outsider_closed_silently"]:
        summary += (
            f" {s['outsider_closed_silently']} were closed without a reply, "
            "which isn't counted as ignored."
        )
    if s["outsider_still_open"]:
        summary += (
            f" {s['outsider_still_open']} were opened in the last {rates.SETTLE_DAYS} "
            "days, too recently to count."
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

NO_MODEL_METHOD = "holt --no-model (the answer from counting alone; no model ran)"


def analyze_without_model(
    repo: str,
    provider: EvidenceProvider,
    contributor_days: int = 7,
    as_of: datetime | None = None,
    progress: Progress | None = None,
    min_age_hours: float | None = None,
    count: Callable[..., Signals] = compute,
) -> tuple[Assessment, Trace]:
    """The verdict, with no model call anywhere and the cost of that printed.

    `progress` and `min_age_hours` behave as in `analyze`. `count` turns the
    threads into signals; the backtest (golden/backtest.py) passes other ways
    of counting to compare them under the same rules.
    """
    report = _reporter(progress)
    report("Fetching pull requests", 0.0)
    records = provider.fetch(repo)
    report("Counting replies and merges", 0.6)
    threads = build_threads(records)
    signals = count(
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
    # outsider landed here (a fork that merges outsiders is its own project).
    if meta is not None and (
        elsewhere := landing_detection.elsewhere(meta.payload, signals.outsider_merged)
    ):
        findings.add("contribute_elsewhere", elsewhere, (meta.evidence_id,),
                     "read from GitHub's mirror and fork fields and the description")

    _add_personal(findings, records, threads, signals, as_of, meta)
    _add_inactive(findings, records, threads, signals, as_of, meta)

    # What Stage A would call a registry or a list, measured from the diffs
    # outside contributors sent instead of asked of a model. The AI report
    # still takes the model's word (see repo_kind_rules).
    kind = repo_kind_rules.read(records)
    if kind.catalogue is not None:
        repo_kind_rules.add_finding(findings, kind.catalogue)

    report("Applying the rules", 0.9)
    verdict, rules = decide(findings, signals, contributor_days)
    _say_how_merges_landed(rules, threads, as_of, _min_age(provider, min_age_hours))
    # After the line above, which the generic kind rule silences: the measured
    # sentence replaces it and stays last, where the web reads the reason.
    rules = repo_kind_rules.explain(rules, kind, verdict)
    _say_what_was_read(rules, records, threads, as_of, _min_age(provider, min_age_hours))

    return Assessment(
        repo=repo,
        verdict=verdict,
        summary=_counted_summary(signals),
        bottom_line=_computed_bottom_line(verdict, rules),
        limits=(
            "No model ran. This answer comes from counting the pull request "
            "history, so it can't tell you what specific threads said or who was "
            "welcoming, and beyond spotting catalogues and lists it can't tell what "
            "kind of project this is. Ask for the AI report for what maintainers "
            "actually said, thread by thread."
        ),
        rules=list(rules),
        contributor_days=contributor_days,
        as_of=as_of,
        landing=landing.render(landing.compute(threads)),
        # Rules-only findings (a catalogue detected, archived, inactive): the
        # detector's own sentence says more than "Kind of project: ...".
        claims=[
            claim_for(i, text=i.note if i.field == "repo_kind" else None,
                      show_note=i.field == "repo_kind")
            for i in findings
        ],
        method=NO_MODEL_METHOD,
        replayed=False,
        models=[],
        dropped_claims=0,
        examples=examples.counted(threads, {r.evidence_id: r for r in records},
                                  as_of or datetime.now(UTC),
                                  _min_age(provider, min_age_hours)),
    ), _done(report, Trace(signals=signals, rules=rules))


def first_timer_sentence(signals: Signals) -> str:
    """The first-timers among the outsiders, in one sentence.

    Their own numbers because they answer a different question: whether this
    project lands a stranger's *first* pull request, not only a regular's.
    """
    tried = signals.first_timer_threads
    if not tried:
        return "None of them came from someone new to this repo."
    merged = signals.first_timer_merged
    people = signals.distinct_first_timer_authors
    return (
        f"{tried} of them came from {people} "
        f"{'person' if people == 1 else 'people'} new to this repo, "
        f"and {merged} of those {'was' if merged == 1 else 'were'} merged."
    )


# Rules after which how the merges happened is beside the point.
_NOT_ABOUT_MERGES = {"archived", "elsewhere", "closed_kind", "non_software_kind", "inactive",
                     "personal"}
# Rules that follow the merge count and turn the repository down.
_TURNED_DOWN = rates.OVERRULING_CODES


def _add_inactive(findings: Findings, records: list, threads: dict[str, Thread],
                  signals: Signals, as_of: datetime | None, meta) -> None:
    """No merge and no push in 90 days: a finding the verdict turns down on.

    Only for a reading that knows its moment (live, or a recording of one), as
    the dormancy line; the frozen benchmark never had it.
    """
    if meta is None or not signals.settle_hours:
        return
    line = rates.inactive_sentence(records, threads, as_of or datetime.now(UTC), meta.payload)
    if line:
        findings.add("inactive", line, (meta.evidence_id,),
                     "no merge in the sample and no push on GitHub in 90 days")


def _add_personal(findings: Findings, records: list, threads: dict[str, Thread],
                  signals: Signals, as_of: datetime | None, meta) -> None:
    """Someone's own project or a small team's (agent/personal.py): a finding
    the verdict answers "Personal project" on. Live readings only, as above."""
    if meta is None or not signals.settle_hours:
        return
    line = personal.detect(records, threads, as_of or datetime.now(UTC))
    if line:
        findings.add("personal_project", line, (meta.evidence_id,),
                     "who opened the pull requests, the stars, and what the project says about itself")


def _say_how_merges_landed(rules: list[str], threads: dict[str, Thread],
                           as_of: datetime | None = None, settle_hours: float = 0.0) -> None:
    """Add a line saying which merges GitHub shows as closed, and how they landed.

    Counting a pull request GitHub calls "closed" as merged is a claim the
    reader can check, so it is said next to the rules rather than done quietly.
    """
    if any(getattr(r, "code", "") in _NOT_ABOUT_MERGES for r in rules):
        return
    outside = outsider_threads(threads)
    # The same pull requests the counts are over (decided, and inside the last
    # year), so "4 of the 13 merged" matches the merge count beside it.
    at = as_of or datetime.now(UTC)
    if rates.judges_time(at, settle_hours):
        outside = rates.split(outside, at, settle_hours).decided
    if line := landing_detection.landed_sentence(outside):
        # Never after a rule that turned the repository down: the web reads
        # the reason from the last line.
        at = len(rules) - 1 if rules and getattr(rules[-1], "code", "") in _TURNED_DOWN else len(rules)
        rules.insert(at, Rule(line, code="landed_off_button"))


def _say_what_was_read(rules: list[str], records: list, threads: dict[str, Thread],
                       as_of: datetime | None, settle_hours: float) -> None:
    """Put the dates the sample covers, and a dormancy warning, at the top.

    Only for a reading that knows its moment (live, or a recording of one): the
    frozen benchmark keeps the trace it was scored with. No dormancy line when
    the answer is that pull requests aren't the way in at all (archived, a
    mirror): it would only repeat that.
    """
    as_of = as_of or datetime.now(UTC)
    if not rates.judges_time(as_of, settle_hours):
        return
    meta = next((r for r in records if r.evidence_id.endswith(":meta")), None)
    dormant = None
    if not any(getattr(r, "code", "") in _NOT_ABOUT_MERGES for r in rules):
        dormant = rates.dormant_sentence(records, threads, as_of,
                                         meta.payload if meta else None)
    lines = [Rule(line, code=code) for line, code in (
        (rates.period_sentence(threads, as_of), "sample_period"),
        (dormant, "dormant"),
    ) if line]
    rules[:0] = lines


def _done(report: Progress, trace: Trace) -> Trace:
    report("Done", 1.0)
    return trace
