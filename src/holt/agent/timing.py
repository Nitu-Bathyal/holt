"""How long it takes here: first reply, time to merge, rhythm and the stale bot.

Facts for the reader, never rules: nothing here reaches the verdict.

**Time to merge** comes from a cohort that isn't cut short. A busy
repository's sample covers two to four weeks, so a pull request that takes
forty days to merge can't appear in it, and its "slow" merge time would be
capped by the sample rather than by the project. So merge times are measured
on outside pull requests *opened* 60 to 240 days before the reading
(COHORT_DAYS): every one has had at least 60 days to land. The provider reads
them with one light search (`github_graphql.TIMING_SEARCH`, up to three pages)
unless the sample already reaches back that far, and says which it did in a
`timing:<repo>:window` record. Open and closed-unmerged pull requests count as
not merged by day d, never as missing.

**First reply** keeps today's typical wait (signals.median_first_response_hours,
over the ones that got a reply) and adds the waits by which half, and 8 in 10
("most"), of settled outside pull requests (14 days old or more) had an
answer: a reply from the team, or a merge. One
still open with no answer counts as not yet, so a project that leaves a third
unanswered has no such wait. One closed with no answer (spam cleared out, the
author giving up, a bot's check) stopped waiting then: it counts up to its
close and leaves every longer wait.

Every share is taken over the pull requests old enough to have had the whole
wait, and still waiting when it began (`share_within`), so a young one is
never a "no" for a wait it hasn't had time for.

**Rhythm**: over the last 26 weeks of outside merges, "merges in bursts" when
there are at least 8, fewer than 30% of weeks had one, and the busiest 4 weeks
hold at least 60% of them. Only when the sample reaches back 26 weeks: a busy
repository's short sample can't see its quiet weeks. A steady flow says
nothing.

Work that lands elsewhere (Gerrit, a merge bot, an internal sync:
landing_detection) gets no merge timing and no rhythm: GitHub's merge time
isn't the project's.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from holt.agent import rates, stale
from holt.agent.people import MAINTAINER_ASSOCIATIONS
from holt.agent.signals import looks_like_bot, outsider_threads

if TYPE_CHECKING:
    from holt.agent.signals import Thread
    from holt.types import EvidenceRecord

# Outside pull requests opened this many days before the reading: old enough
# to have had 60 days to land, recent enough to be how the project works now.
COHORT_DAYS = (60, 240)
MERGED_BY_DAYS = (3, 7, 14, 30, 60)
# No merge-time numbers under this many outside pull requests in the cohort,
# no "slow" merge time under this many outside merges, and no slow first
# reply under this many answered pull requests.
MIN_PRS = 8
MIN_MERGES = 8
MIN_ANSWERED = 8
# "Most" is 8 in 10; "slow" for a merge is the 90th percentile of merge times.
REPLY_MOST = 0.8
MERGE_SLOW = 0.9
# Where at least this share of outside merges landed off the button, GitHub's
# merge times aren't the project's.
ELSEWHERE_SHARE = 0.5

# Rhythm. On the golden set (Sep 2026) 18 samples reach back 26 weeks: moment
# (21 merges in 4 weeks) is flagged; bubbletea (15 in 8 weeks) and rustlings
# (15 in 9) sit just past the week line, and plantuml (36 in 19) is steady.
RHYTHM_WEEKS = 26
BURST_MIN_MERGES = 8
BURST_MAX_WEEK_SHARE = 0.30
BURST_TOP_WEEKS = 4
BURST_TOP_SHARE = 0.60

HOUR = timedelta(hours=1)


@dataclass(frozen=True, slots=True)
class Waited:
    """One pull request's wait for something: how long it has had, how long
    until it happened (None: it hasn't), and when it stopped waiting without
    it (closed; None: it didn't)."""

    age_hours: float
    hours: float | None
    stopped_hours: float | None = None

    def counts_at(self, hours: float) -> bool:
        """Whether it had the whole of `hours` to wait."""
        if self.age_hours < hours:
            return False
        gave_up = self.stopped_hours is not None and self.stopped_hours < hours
        return not gave_up or (self.hours is not None and self.hours <= hours)


def share_within(items: Iterable[Waited], hours: float, min_n: int = MIN_PRS) -> float | None:
    """The share that had it happen within `hours`, over the ones that had
    that long to wait; None under `min_n` of them."""
    eligible = [w for w in items if w.counts_at(hours)]
    if len(eligible) < min_n:
        return None
    return sum(1 for w in eligible if w.hours is not None and w.hours <= hours) / len(eligible)


def within(items: Iterable[Waited], share: float, min_n: int = MIN_PRS) -> float | None:
    """The shortest wait by which `share` of them had it happen, or None."""
    items = list(items)
    for h in sorted({w.hours for w in items if w.hours is not None}):
        got = share_within(items, h, min_n)
        if got is None:
            return None  # longer waits have fewer old enough, never more
        if got >= share:
            return h
    return None


def quantile(values: Iterable[float], q: float) -> float:
    """Nearest rank: the smallest value with at least `q` of them at or below it."""
    xs = sorted(values)
    return xs[max(0, math.ceil(q * len(xs)) - 1)]


def bursts(merges: Iterable[datetime], as_of: datetime,
           weeks: int = RHYTHM_WEEKS) -> bool | None:
    """Whether the outside merges of the last `weeks` weeks came in bursts;
    None under BURST_MIN_MERGES of them."""
    per_week: Counter[int] = Counter()
    for when in merges:
        age = as_of - when
        if timedelta(0) <= age < timedelta(weeks=weeks):
            per_week[age.days // 7] += 1
    n = sum(per_week.values())
    if n < BURST_MIN_MERGES:
        return None
    top = sum(c for _, c in per_week.most_common(BURST_TOP_WEEKS))
    return len(per_week) / weeks < BURST_MAX_WEEK_SHARE and top / n >= BURST_TOP_SHARE


@dataclass(slots=True)
class Timing:
    # The waits by which half, and 8 in 10, of settled outside pull requests
    # had an answer (a reply from the team, or a merge).
    first_reply_half_hours: float | None = None
    first_reply_slow_hours: float | None = None
    # Share of the cohort merged within each of MERGED_BY_DAYS; None under MIN_PRS.
    merged_within: dict[int, float] | None = None
    # Days to merge among the cohort's merged ones: median, and 90th percentile.
    merge_typical_days: float | None = None
    merge_slow_days: float | None = None
    # The wait by which half of the cohort was merged; None when fewer did.
    merge_half_days: float | None = None
    # The cohort: outside pull requests counted, how many merged, and when the
    # first and last were opened (how much of the 60-240 day window was read).
    merge_cohort_prs: int = 0
    merge_cohort_merged: int = 0
    merge_cohort_from: datetime | None = None
    merge_cohort_to: datetime | None = None
    merges_in_bursts: bool | None = None
    last_outside_merge: datetime | None = None
    # The stale bot: quiet days before it closes a pull request (None when
    # only its closes were seen), and where that was read.
    stale_bot: bool = False
    stale_close_days: int | None = None
    stale_url: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Flat, for the golden set's numbers and the report's stats."""
        out: dict[str, Any] = {
            "first_reply_half_hours": self.first_reply_half_hours,
            "first_reply_slow_hours": self.first_reply_slow_hours,
        }
        for d in MERGED_BY_DAYS:
            out[f"merged_within_{d}_days"] = (
                round(self.merged_within[d], 3) if self.merged_within else None)
        out.update({
            "merge_typical_days": self.merge_typical_days,
            "merge_slow_days": self.merge_slow_days,
            "merge_half_days": self.merge_half_days,
            "merge_cohort_prs": self.merge_cohort_prs,
            "merge_cohort_merged": self.merge_cohort_merged,
            "merge_cohort_from": _day(self.merge_cohort_from),
            "merge_cohort_to": _day(self.merge_cohort_to),
            "merges_in_bursts": self.merges_in_bursts,
            "last_outside_merge": _day(self.last_outside_merge),
            "stale_bot": self.stale_bot,
            "stale_close_days": self.stale_close_days,
        })
        return out


def _day(when: datetime | None) -> str | None:
    return when.date().isoformat() if when else None


def _hours(delta: timedelta) -> float:
    return delta / HOUR


def answer(t: Thread, as_of: datetime) -> Waited:
    """A pull request's wait for an answer: the team's first reply, or its
    merge if that came first. Closed unanswered, it stopped waiting then."""
    times = [h for h in (t.first_response_hours,
                         _hours(t.merged_at - t.opened_at) if t.merged and t.merged_at else None)
             if h is not None]
    stopped = (_hours(t.closed_at - t.opened_at)
               if t.closed_unmerged and not t.merged and t.closed_at else None)
    return Waited(_hours(as_of - t.opened_at), min(times, default=None), stopped)


# --- the cohort ---------------------------------------------------------------------


def window(records: Iterable[EvidenceRecord]) -> EvidenceRecord | None:
    return next((r for r in records if r.evidence_id.startswith("timing:")
                 and r.evidence_id.endswith(":window")), None)


def _searched(records: list[EvidenceRecord], team: frozenset[str],
              start: datetime, end: datetime) -> list[tuple[datetime, datetime | None]]:
    """(opened, merged) for the outside pull requests the timing search read.

    The team is the sample's, plus anyone who merged a pull request in the
    cohort: merging takes write access. A project's staff often read as
    CONTRIBUTOR (private org members), and the sample, a few busy weeks, can
    miss them: on microsoft/vscode 14 of 17 "outside" merges were the team's.
    """
    opened: dict[str, tuple[datetime, Mapping[str, Any]]] = {}
    merged: dict[str, datetime] = {}
    mergers: set[str] = set()
    for r in records:
        eid = r.evidence_id
        if not eid.startswith("timing:") or "#" not in eid:
            continue
        key = eid.split(":landed")[0]
        if eid.endswith(":landed"):
            merged[key] = r.timestamp
            by = r.payload.get("by")
            if by and not looks_like_bot(by, bool(r.payload.get("by_bot"))):
                mergers.add(by)
        else:
            opened[key] = (r.timestamp, r.payload)
    team = team | mergers
    out = []
    for key, (when, p) in opened.items():
        login = p.get("login") or ""
        if (looks_like_bot(login, bool(p.get("bot"))) or p.get("draft")
                or p.get("association") in MAINTAINER_ASSOCIATIONS or login in team):
            continue
        if start <= when <= end:
            out.append((when, merged.get(key)))
    return out


def _sampled(threads: Mapping[str, Thread], start: datetime,
             end: datetime) -> list[tuple[datetime, datetime | None]]:
    """(opened, merged) for the sample's outside pull requests in the window."""
    return [(t.opened_at, t.merged_at if t.merged else None)
            for t in outsider_threads(threads)
            if not rates.excluded(t) and start <= t.opened_at <= end]


def _lands_elsewhere(outside_merges: list[Thread]) -> bool:
    landed = sum(1 for t in outside_merges if t.landed_via)
    return bool(outside_merges) and landed / len(outside_merges) >= ELSEWHERE_SHARE


def _merge_timing(out: Timing, cohort: list[tuple[datetime, datetime | None]],
                  as_of: datetime) -> None:
    out.merge_cohort_prs = len(cohort)
    if not cohort:
        return
    out.merge_cohort_from = min(o for o, _ in cohort)
    out.merge_cohort_to = max(o for o, _ in cohort)
    waits = [Waited(_hours(as_of - o), _hours(m - o) if m is not None else None)
             for o, m in cohort]
    days = [w.hours / 24 for w in waits if w.hours is not None]
    out.merge_cohort_merged = len(days)
    if len(cohort) < MIN_PRS:
        return
    out.merged_within = {d: share_within(waits, d * 24.0, MIN_PRS) or 0.0
                         for d in MERGED_BY_DAYS}
    if (half := within(waits, 0.5, MIN_PRS)) is not None:
        out.merge_half_days = round(half / 24, 1)
    if days:
        out.merge_typical_days = round(statistics.median(days), 1)
    if len(days) >= MIN_MERGES:
        out.merge_slow_days = round(quantile(days, MERGE_SLOW), 1)


# --- the whole block ----------------------------------------------------------------


def read(records: Iterable[EvidenceRecord], threads: Mapping[str, Thread],
         as_of: datetime, settle_hours: float) -> Timing:
    """Everything above, from the evidence a report read.

    `threads` are the main sample's (signals.build_threads over the same
    records); their team decides who is outside in the cohort too.
    `settle_hours` is the reading's settle window (0 for the frozen benchmark,
    which gets no timing at all).
    """
    records = list(records)
    out = Timing()
    if not rates.judges_time(as_of, settle_hours):
        return out
    team = getattr(threads, "team", frozenset())
    outside = outsider_threads(threads)

    # First reply: over settled outside pull requests.
    replies = [answer(t, as_of) for t in rates.split(outside, as_of, settle_hours).decided]
    if sum(1 for w in replies if w.hours is not None) >= MIN_ANSWERED:
        half = within(replies, 0.5, MIN_ANSWERED)
        slow = within(replies, REPLY_MOST, MIN_ANSWERED)
        out.first_reply_half_hours = round(half, 1) if half is not None else None
        out.first_reply_slow_hours = round(slow, 1) if slow is not None else None

    rule = stale.read(records, outside)
    if rule is not None:
        out.stale_bot, out.stale_close_days, out.stale_url = True, rule.days, rule.url or None

    merges = [t for t in outside if t.merged and not rates.excluded(t)
              and t.merged_at is not None and t.merged_at <= as_of]
    out.last_outside_merge = max((t.merged_at for t in merges), default=None)
    if _lands_elsewhere(merges):
        return out

    opened = [t.opened_at for t in threads.values()]
    if opened and min(opened) <= as_of - timedelta(weeks=RHYTHM_WEEKS):
        out.merges_in_bursts = bursts((t.merged_at for t in merges), as_of)

    marker = window(records)
    if marker is None:
        return out
    start = as_of - timedelta(days=COHORT_DAYS[1])
    end = as_of - timedelta(days=COHORT_DAYS[0])
    cohort = (_searched(records, team, start, end) if marker.payload.get("source") == "search"
              else _sampled(threads, start, end))
    _merge_timing(out, cohort, as_of)
    return out
