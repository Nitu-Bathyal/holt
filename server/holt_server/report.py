"""Assessment + Trace -> the Report object in API.md (`schema.Report`).

The engine's `Assessment` is shaped for a terminal: rendered Markdown lines for
the landing section, claims flattened to text. This rebuilds what the web needs
from the same sources: landing from the records the run actually read (the same
`landing.compute` the engine renders from), and evidence URLs from those
records, so every item links to GitHub.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from holt.agent import asks as asks_mod
from holt.agent import examples
from holt.agent import labels
from holt.agent import landing as landing_mod
from holt.agent import rates
from holt.agent.signals import Signals, Thread, Threads, build_threads, outsider_threads
from holt.agent.verdict import rule_codes, slow_note, slow_sentence
from holt.report import Assessment, Claim
from holt.types import EvidenceRecord

from holt_server import schema

RULES_ONLY_UNKNOWN = (
    "No AI read the conversations for this report, so it doesn't say how "
    "maintainers talk to newcomers or what kind of project this is. The verdict "
    "and the numbers are counted straight from GitHub and don't need an AI."
)
NO_OUTSIDERS_UNKNOWN = (
    "We found no pull requests from first-time contributors in the period we "
    "read, so there was nothing to count."
)
ALL_DROPPED_UNKNOWN = (
    "Every statement the AI wrote was removed because the evidence didn't back "
    "it up. The verdict and the numbers don't depend on the AI and still stand."
)



def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def url_for(evidence_id: str, records: dict[str, EvidenceRecord]) -> str | None:
    record = records.get(evidence_id)
    if record is not None and record.url:
        return record.url
    # Built from the id when the record is not at hand. The id grammar is
    # `pr:owner/repo#123:...`, `issue:owner/repo#123:...`, `repo:owner/repo:...`.
    kind, _, rest = evidence_id.partition(":")
    slug = rest.split("#", 1)[0].split(":", 1)[0]
    if "/" not in slug:
        return None
    base = f"https://github.com/{slug}"
    number = re.match(r"[^#]*#(\d+)", rest)
    if kind == "pr" and number:
        return f"{base}/pull/{number.group(1)}"
    if kind == "issue" and number:
        return f"{base}/issues/{number.group(1)}"
    return base


def evidence_item(claim: Claim, records: dict[str, EvidenceRecord]) -> dict[str, Any] | None:
    """One evidence card. `kind` and `value` stay machine values (API.md); the
    text is in plain words (agent/labels.py)."""
    if not claim.evidence_id:
        return None
    url = url_for(claim.evidence_id, records)
    if not url:
        return None  # API.md: every evidence item must be clickable.
    kind, value, body, quote = claim.kind or "claim", claim.value or None, claim.text, None
    if kind == "outcome" and value:
        quote = claim.quote or None
        body = labels.outcome(value, quoted=bool(quote))
    elif claim.kind and value:
        said = labels.value(kind, value)
        said = said[:1].upper() + said[1:] + ("" if said.endswith((".", "!", "?")) else ".")
        body = f"{said} {claim.note}" if claim.note else said
    return {"id": claim.evidence_id, "url": url, "kind": kind, "value": value,
            "text": body, "quote": quote}


RULES_EVIDENCE_EACH = examples.EACH


def counted_examples(threads: dict[str, Thread],
                     records: dict[str, EvidenceRecord],
                     as_of: datetime | None = None,
                     settle_hours: float = 0.0) -> list[dict[str, Any]]:
    """Recent outside pull requests behind the counts (agent/examples.py)."""
    return examples.counted(threads, records, as_of, settle_hours)


def split_limits(limits: str) -> list[str]:
    out = []
    for line in (limits or "").splitlines():
        line = line.strip().lstrip("-•* ").strip()
        if line:
            out.append(line)
    return out


def stats(signals: Signals) -> dict[str, Any]:
    # Attempts are the decided ones, the engine's denominator for every rate, so
    # a percentage on a page is the one the verdict was computed from.
    return {
        "outsider_attempts": signals.outsider_judgeable,
        "outsider_merged": signals.outsider_merged,
        "distinct_outsiders": signals.distinct_outsider_authors,
        "first_time_merged_authors": signals.distinct_first_timer_merged_authors,
        "no_reply": signals.outsider_ignored,
        "median_first_response_hours": signals.median_first_response_hours,
        "bot_share": round(signals.bot_share, 3),
        "still_open": signals.outsider_still_open,
        "closed_silently": signals.outsider_closed_silently,
        "closed_by_bot": signals.outsider_closed_by_bot + signals.outsider_closed_stale,
        "withdrawn": signals.outsider_withdrawn,
        "too_old": signals.outsider_too_old,
    }


def decided_only(threads: Threads, as_of: datetime | None,
                 settle_hours: float) -> Threads:
    """The threads without the outside pull requests the counts leave out
    (still open, drafts, spam), so where work landed is counted over the same
    pull requests as the stats and the numbers line above it."""
    outsiders = outsider_threads(threads)
    keep = {t.key for t in rates.split(outsiders, as_of, settle_hours).decided}
    drop = {t.key for t in outsiders} - keep
    out = Threads({k: t for k, t in threads.items() if k not in drop})
    out.team = threads.team
    return out


def sample(threads: dict[str, Thread]) -> dict[str, Any]:
    """What the counts were read from, and who was left out before counting."""
    opened = [t.opened_at for t in threads.values()]
    outsiders = {t.key for t in outsider_threads(threads)}
    bots = [t for t in threads.values() if t.author_is_bot]
    team = [t for t in threads.values() if not t.author_is_bot and t.key not in outsiders]
    return {
        "pull_requests": len(threads),
        "first_opened": iso(min(opened)) if opened else None,
        "last_opened": iso(max(opened)) if opened else None,
        "team_pull_requests": len(team),
        "team_people": len({t.author for t in team}),
        "bot_pull_requests": len(bots),
    }


def build(
    *,
    repo: str,
    mode: str,
    assessment: Assessment,
    signals: Signals,
    records: Iterable[EvidenceRecord],
    cost: dict[str, Any] | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    by_id = {r.evidence_id: r for r in records}
    threads = build_threads(by_id.values())
    as_of = assessment.as_of or generated_at or datetime.now(UTC)
    where = landing_mod.compute(decided_only(threads, as_of, signals.settle_hours))

    evidence = []
    for claim in assessment.claims:
        item = evidence_item(claim, by_id)
        if item is not None:
            evidence.append(item)
    if mode == "rules":
        evidence += counted_examples(threads, by_id, as_of, signals.settle_hours)

    unknowns: list[str] = []
    if mode == "ai":
        unknowns += split_limits(assessment.limits)
        if not assessment.claims and assessment.dropped_claims:
            unknowns.insert(0, ALL_DROPPED_UNKNOWN)
    else:
        unknowns.append(RULES_ONLY_UNKNOWN)
    if not signals.outsider_threads:
        unknowns.append(NO_OUTSIDERS_UNKNOWN)

    # Validated here, so a report that breaks the contract fails its job
    # instead of reaching a page. The dump includes the derived fields
    # (headline, tone, verdict_line, odds), so the stored job result and the
    # SSE `done` event carry them too.
    return schema.Report.model_validate({
        "repo": repo,
        "mode": mode,
        "days": assessment.contributor_days,
        "verdict": assessment.verdict.value,
        # Rules mode computes a bottom line too ("headline. deciding rule"), but
        # the verdict block already says exactly that, so only AI mode sends it.
        "bottom_line": (assessment.bottom_line or None) if mode == "ai" else None,
        "summary": (assessment.summary or None) if mode == "ai" else None,
        "stats": stats(signals),
        "decided_by": [str(r) for r in assessment.rules],
        "rule_codes": [c or "" for c in rule_codes(assessment.rules)],
        "unknowns": unknowns,
        "landing": [{"path": a.path, "merged": a.landed, "attempted": a.attempted,
                     "is_file": a.is_file} for a in where.landed],
        "never_landed": [{"path": a.path, "attempted": a.attempted, "is_file": a.is_file}
                         for a in where.never],
        "evidence": evidence,
        "evidence_until": iso(assessment.as_of),
        "generated_at": iso(generated_at or datetime.now(UTC)),
        "cost": cost if mode == "ai" else None,
        "sample": sample(threads),
        # Rules reports from a live reading: every budget gets the same verdict
        # (verdict.py), so another `days` is this report with its note redone.
        "budget_independent": mode == "rules" and signals.settle_hours > 0,
        "asks": [{"code": a.code, "url": a.url, "link": a.link} for a in asks_mod.read(
            by_id.values(), {t.key for t in outsider_threads(threads)})],
    }).model_dump(mode="json")


# --- another time budget, from a report already made ----------------------------

# The lines that read the reader's budget, and the ones a slow line goes before.
_BUDGET_CODES = ("slow", "slow_note")
_THIN_EVIDENCE = ("too_few_attempts", "few_merges", "few_people", "one_merge", "one_person")


def retime(report: dict[str, Any], days: int) -> dict[str, Any] | None:
    """`report` as it reads for a `days`-day budget, or None if it can't be.

    Only for a report marked `budget_independent`: its verdict is the same
    for every budget (verdict.py), and the budget shows only in whether the
    typical first reply is "slow". So the lines that say so are taken out and
    put back for `days`, where the engine puts them: the note right after the
    merge count under "Worth your time", and the slow line before the reason
    the evidence is thin. No GitHub read, no model.
    """
    if not report.get("budget_independent") or report.get("mode") != "rules":
        return None
    lines = [(t, c) for t, c in zip(report.get("decided_by") or [], report.get("rule_codes") or [])
             if c not in _BUDGET_CODES]
    median = (report.get("stats") or {}).get("median_first_response_hours")
    if median is not None and median > days * 24:
        codes = [c for _, c in lines]
        if report.get("verdict") == "viable" and "merges" in codes:
            note = slow_note(median, days)
            lines.insert(codes.index("merges") + 1, (str(note), note.code))
        elif report.get("verdict") in ("insufficient_evidence", "long_shot"):
            at = next((i for i, c in enumerate(codes) if c in _THIN_EVIDENCE), None)
            if at is not None:
                lines.insert(at, (slow_sentence(median, days), "slow"))
    return {**report, "days": days,
            "decided_by": [t for t, _ in lines], "rule_codes": [c for _, c in lines]}
