"""Which pull requests a rate is taken over, and what the sample covers.

A merge rate or a no-reply share is only honest over pull requests whose story
has ended. Three things used to be counted that shouldn't be:

* Pull requests opened in the last two weeks. A busy repository read at any
  moment has dozens with no outcome *yet*; pytorch's 200 newest span about
  two days. Counting the young ones that already have an outcome is worse
  than leaving them all out: what happens within hours is the fast outcomes
  (a quick merge, a quick triage close), so rates over them are inflated
  (openssl read 40% merged that way; 11% over the ones two weeks old). A pull
  request is **decided** once it is older than the settle window, whatever
  happened to it. Younger ones are "still open" (still settling, even if
  already merged or closed) and leave both sides of every rate. The live
  provider reads further back when a busy repository's newest pages hold too
  few decided ones (`github_graphql.SETTLED_TARGET`).
* Pull requests closed without a word. On a popular repository that is mostly
  maintainers clearing out spam and AI junk, which is a good sign, not being
  ignored. "Ignored" is now only an open pull request, past the settle window,
  that nobody from the project answered.
* Drafts, and pull requests labelled as spam or invalid. A draft isn't asking
  for review, and a labelled spam PR is not an attempt anyone should be
  measured by (Hacktoberfest brings plenty). Both leave the counts entirely.

Also here: the dates a sample covers, and whether the repository looks dormant,
so a report built on 2019 history says so instead of calling it "recent".

The frozen benchmark fixtures are read without a reference time (or with the
window switched off), and keep the arithmetic they were scored with: every
silent unmerged attempt is "no reply", nothing is still open. Drafts and labels
were never captured there, so leaving them out changes nothing for them.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from holt.agent.signals import Thread
    from holt.types import EvidenceRecord

# How long a pull request may stay open before it counts as decided. Two weeks
# covers a maintainer's holiday or a release freeze without excusing a month of
# silence, and is long enough that a busy repository's newest few hundred pull
# requests stop dominating its rates.
SETTLE_DAYS = 14
SETTLE_HOURS = SETTLE_DAYS * 24.0

# No merge in this long, and the repository reads as dormant.
DORMANT_DAYS = 90
# Pull requests opened longer ago than this leave every count (live readings
# only). A quiet project's newest 200 pull requests can reach back years, and
# moment/moment read "Worth your time" on merges from 2021 while it sat in
# maintenance mode. How a project treats outside work today is what the reader
# is asking about. docs/research/EVALUATION.md, "Verdict tiers".
MAX_SAMPLE_DAYS = 365

# What happened to one pull request.
MERGED = "merged"
CLOSED_REPLIED = "closed_replied"
CLOSED_SILENTLY = "closed_silently"
OPEN_REPLIED = "open_replied"
IGNORED = "ignored"
STILL_OPEN = "still_open"

# Rule codes this module's lines carry. They inform; they never decide, so
# anything looking for the deciding rule skips them (`first_deciding`).
INFO_CODES = frozenset({"sample_period", "dormant", "excluded", "still_open", "closed_silently",
                        "slow_note", "too_old"})


# Rules that come after the merge count and overrule it (verdict.py): when
# one is there, it is the reason, not the count before it.
OVERRULING_CODES = frozenset({"rubber_stamp", "long_odds", "replies_no_merges", "few_merged",
                              "mostly_silent", "slow_replies", "one_merge", "one_person"})


def first_deciding(rules: list[str], skip: frozenset[str] = frozenset()) -> str | None:
    """The rule line that gave the answer: an overruling one if present, else
    the first that isn't one of these notes (or in `skip`), else the first."""
    overruled = next((r for r in rules if getattr(r, "code", "") in OVERRULING_CODES), None)
    return overruled or next(
        (r for r in rules if getattr(r, "code", "") not in INFO_CODES | skip),
        rules[0] if rules else None)

# Labels a project uses to say "this was not a real attempt". Matched on the
# label with case and separators flattened ("bot:ai-policy-close" reads as
# "bot ai policy close"). `invalid` only as the label's last word ("invalid",
# "status: invalid"), not "do-not-merge/invalid-commit-message", which is a
# real pull request with a fixable problem. Deliberately not `wontfix`: that is
# a real pull request the project decided against, which is what a rate
# measures.
_OFF_TOPIC = re.compile(
    r"\bspam\b|\binvalid$|\bslop\b|\bjunk\b|\brejected ai\b|\bai rejected\b"
    r"|\bai policy close\b|\bwontfix ai\b|\bai wontfix\b"
)


def _flat(label: str) -> str:
    return " ".join(re.sub(r"[-_:/.]+", " ", label.lower()).split())


def off_topic_label(labels: Iterable[str]) -> str | None:
    """The first label that marks a pull request as spam or not a real attempt."""
    return next((label for label in labels if _OFF_TOPIC.search(_flat(label))), None)


def excluded(thread: Thread) -> bool:
    """A draft, or labelled as spam or invalid: not counted anywhere.

    Never a merged one: whatever it was labelled, it landed, and a landing is
    what the counts are about. (Hacktoberfest's `invalid` is sometimes put on
    a merged pull request only to say it doesn't count for the event.)
    """
    if thread.merged:
        return False
    return thread.draft or off_topic_label(thread.labels) is not None


def judges_time(as_of: datetime | None, settle_hours: float) -> bool:
    """Whether this reading can tell decided from still open (see the module doc)."""
    return as_of is not None and settle_hours > 0


def outcome(thread: Thread, as_of: datetime | None,
            settle_hours: float = SETTLE_HOURS) -> str:
    """Where one pull request stands. Without a reference time nothing is still
    open and a silent close is "ignored", as the benchmark was scored."""
    honest = judges_time(as_of, settle_hours)
    if honest and as_of - thread.opened_at < timedelta(hours=settle_hours):
        return STILL_OPEN
    if thread.merged:
        return MERGED
    replied = thread.engaged
    if thread.closed_unmerged:
        if replied:
            return CLOSED_REPLIED
        return CLOSED_SILENTLY if honest else IGNORED
    return OPEN_REPLIED if replied else IGNORED


@dataclass(slots=True)
class Split:
    """Newcomer attempts sorted by outcome."""

    decided: list[Thread] = field(default_factory=list)
    still_open: int = 0
    closed_silently: int = 0
    ignored: int = 0
    excluded: int = 0
    too_old: int = 0


def split(attempts: Iterable[Thread], as_of: datetime | None,
          settle_hours: float = SETTLE_HOURS) -> Split:
    out = Split()
    honest = judges_time(as_of, settle_hours)
    for t in attempts:
        if excluded(t):
            out.excluded += 1
            continue
        if honest and as_of - t.opened_at > timedelta(days=MAX_SAMPLE_DAYS):
            out.too_old += 1
            continue
        how = outcome(t, as_of, settle_hours)
        if how == STILL_OPEN:
            out.still_open += 1
            continue
        out.decided.append(t)
        if how == CLOSED_SILENTLY:
            out.closed_silently += 1
        elif how == IGNORED:
            out.ignored += 1
    return out


# --- what the sample covers -----------------------------------------------------


def _date(d: datetime) -> str:
    return f"{d.day} {d:%b %Y}"


def _pushed_at(meta: Mapping[str, Any] | None) -> datetime | None:
    raw = (meta or {}).get("pushed_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _last_merge(records: Iterable[EvidenceRecord],
                threads: Mapping[str, Thread]) -> datetime | None:
    """The newest merge in the sample, counting ones landed off the button."""
    times = []
    for r in records:
        eid = r.evidence_id
        if eid.endswith(":merged"):
            times.append(r.timestamp)
        elif eid.endswith(":closed"):
            thread = threads.get(":".join(eid.split(":")[:2]))
            if thread is not None and thread.landed_via:
                times.append(r.timestamp)
    return max(times, default=None)


def period_sentence(threads: Mapping[str, Thread], as_of: datetime) -> str | None:
    """The dates the sample's pull requests were opened, for every report."""
    opened = [t.opened_at for t in threads.values()]
    if not opened:
        return None
    first, last = min(opened), max(opened)
    n = len(opened)
    what = "1 pull request" if n == 1 else f"{n} pull requests"
    when = (f"opened on {_date(first)}" if first.date() == last.date()
            else f"opened between {_date(first)} and {_date(last)}")
    # Not "the newest": a busy repository's sample has an older part too.
    # What was left out for being over a year old is said by count_sentences.
    return f"These numbers come from {what}, {when}."


def dormant_sentence(records: Iterable[EvidenceRecord], threads: Mapping[str, Thread],
                     as_of: datetime, meta: Mapping[str, Any] | None) -> str | None:
    """A plain line when nothing has been merged here in DORMANT_DAYS, or None."""
    found = dormancy(records, threads, as_of, meta)
    return found[0] if found else None


def inactive_sentence(records: Iterable[EvidenceRecord], threads: Mapping[str, Thread],
                      as_of: datetime, meta: Mapping[str, Any] | None) -> str | None:
    """The dormancy line when the project looks inactive, not merely quiet on
    pull requests: no merge *and* no push in DORMANT_DAYS. This one decides
    (verdict.py): a pull request to an inactive project may never be read."""
    found = dormancy(records, threads, as_of, meta)
    return found[0] if found and found[1] else None


def dormancy(records: Iterable[EvidenceRecord], threads: Mapping[str, Thread],
             as_of: datetime, meta: Mapping[str, Any] | None) -> tuple[str, bool] | None:
    """(the line, whether the project looks inactive), or None when it doesn't
    look dormant at all.

    `pushed_at` is GitHub's time of the last push to any branch, read at fetch
    time: when it is recent, work may be landing outside pull requests, and the
    line says so rather than calling the project dead. A push after `as_of`
    (a reading of the past) says nothing about then and is ignored.
    """
    if not threads:
        return None
    window = timedelta(days=DORMANT_DAYS)
    last = _last_merge(records, threads)
    if last is not None:
        if as_of - last <= window:
            return None
        lead = f"The last pull request merged here was on {_date(last)}"
    elif as_of - min(t.opened_at for t in threads.values()) > window:
        lead = f"No pull request has been merged here in the last {DORMANT_DAYS} days"
    else:
        # A short sample with no merge in it doesn't show three quiet months.
        return None
    pushed = _pushed_at(meta)
    if pushed is not None and pushed <= as_of and as_of - pushed <= window:
        return (f"{lead}, though code was pushed on {_date(pushed)}, so work may be "
                "landing some other way. Check recent activity before you start.", False)
    return (f"{lead}, so this project looks inactive. A pull request here may "
            "never be looked at.", True)


# --- lines for the rule trace -------------------------------------------------------
#
# Plain sentences, returned with their rule code; verdict.py wraps them. They
# say what was left out of the rates and why, so no count is dropped quietly.


def _pr(n: int) -> str:
    return ("1 pull request from an outside contributor" if n == 1
            else f"{n} pull requests from outside contributors")


def count_sentences(still_open: int, closed_silently: int, excluded_: int,
                    settle_days: int = SETTLE_DAYS, too_old: int = 0) -> list[tuple[str, str]]:
    out = []
    if too_old:
        out.append((
            f"{_pr(too_old)} {'was' if too_old == 1 else 'were'} opened more than a "
            f"year ago, so {'it isn' if too_old == 1 else 'they aren'}'t counted: "
            "only the last 12 months show how the project works today.",
            "too_old",
        ))
    if excluded_:
        out.append((
            f"{_pr(excluded_)} {'was a draft or was' if excluded_ == 1 else 'were drafts or were'} "
            "labelled as spam or invalid, so "
            f"{'it isn' if excluded_ == 1 else 'they aren'}'t counted anywhere.",
            "excluded",
        ))
    if still_open:
        out.append((
            f"{_pr(still_open)} {'was' if still_open == 1 else 'were'} opened in the "
            f"last {settle_days} days, too recently to know how "
            f"{'it' if still_open == 1 else 'they'} will end, so "
            f"{'it isn' if still_open == 1 else 'they aren'}'t counted yet.",
            "still_open",
        ))
    if closed_silently:
        out.append((
            f"{_pr(closed_silently)} {'was' if closed_silently == 1 else 'were'} closed "
            "without a reply. That's often how maintainers clear out "
            f"spam, so {'it isn' if closed_silently == 1 else 'they aren'}'t counted "
            "as ignored.",
            "closed_silently",
        ))
    return out
