"""Pre-cutoff signals computed from evidence, with no model involved.

The split matters. Counting merges and measuring how long a maintainer took to
reply are arithmetic; asking a language model to do them adds cost, variance and
a chance of being wrong about a number that was sitting right there. What the
model is for is judgement -- what kind of project is this, what does the tone of
that thread mean -- which is the part arithmetic cannot reach.

Note what is deliberately absent: this module has no diff-shape rules. L1 has
those, and if the agent shared them it would agree with the label by
construction on the dimension that matters most. The agent judges what a
contribution *was* by reading, not by re-running the grader's arithmetic.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from holt.agent import landing_detection, people, rates, replies
from holt.agent.people import MAINTAINER_ASSOCIATIONS
from holt.types import EvidenceRecord


def pr_key(evidence_id: str) -> str:
    return ":".join(evidence_id.split(":")[:2])


# GitHub only marks an account as a Bot when it is a real GitHub App. Plenty of
# automation runs on ordinary user accounts -- wingetbot on microsoft/winget-pkgs
# posts every validation log as a normal user -- and counting those as human
# engagement turns an auto-merge pipeline into a conversational project. Applied
# at read time so fixtures stay as captured.
_BOT_HINTS = ("dependabot", "renovate", "greenkeeper", "imgbot", "allcontributors",
              "codecov", "sonarcloud", "netlify", "vercel", "mergify", "stale")


# A pull request opened an hour ago has not been ignored, or rejected; nobody
# has had the chance to read it. Open pull requests younger than this are
# "still open" and leave every rate (see rates.py, which owns the window).
MIN_AGE_HOURS = rates.SETTLE_HOURS

def looks_like_bot(login: str, flagged: bool = False) -> bool:
    if flagged:
        return True
    low = (login or "").lower()
    if low.endswith("[bot]") or low.endswith("bot") or "-bot" in low:
        return True
    return any(hint in low for hint in _BOT_HINTS)


@dataclass(slots=True)
class Thread:
    """One pull request and everything that happened on it before the cutoff."""

    key: str
    number: int
    author: str
    author_is_bot: bool
    opened_at: object
    files: list[str] = field(default_factory=list)
    changed_files: int = 0
    additions: int = 0
    deletions: int = 0
    merged: bool = False
    closed_unmerged: bool = False
    # When it was merged (or closed, for one landed another way); None when
    # not merged or when the capture has no time for it.
    merged_at: object = None
    # Set when GitHub shows the pull request closed but it landed another way
    # (a merge bot, an internal sync, Gerrit, a maintainer's push): a VIA key
    # from landing_detection. `merged` is then True as well.
    landed_via: str | None = None
    # Read at fetch time; absent from captures before evidence v2.
    draft: bool = False
    labels: list[str] = field(default_factory=list)
    responses: list[tuple[object, str, str]] = field(default_factory=list)
    # The author's association with the repository (see
    # people.MAINTAINER_ASSOCIATIONS), or None when the capture predates it.
    association: str | None = None
    # (when, who) for each maintainer reply; see agent/replies.py. None on a
    # thread built by hand, where every non-author response counts.
    replies: list[tuple[object, str]] | None = None
    # The title as read at fetch time: maintainers retitle junk ("AI junk").
    title: str = ""
    # Who closed an unmerged pull request, and when (rates.closure). None when
    # the capture predates `closed_by` or GitHub named nobody.
    closed_at: object = None
    closed_by: str | None = None
    closed_by_bot: bool = False

    @property
    def first_response_hours(self) -> float | None:
        """Hours until a maintainer first replied."""
        return replies.first_reply_hours(self)

    @property
    def engaged(self) -> bool:
        return replies.answered(self)


class Threads(dict):
    """Pull requests by key, and the project's team as the same evidence shows it.

    `team` is `people.maintainers` over the records the threads were built
    from. A plain dict of hand-built threads has none, and is judged by each
    thread's own association.
    """

    team: frozenset[str] = frozenset()


def build_threads(records: Iterable[EvidenceRecord]) -> dict[str, Thread]:
    threads = Threads()
    records = list(records)
    threads.team = people.maintainers(records, is_automation=replies.looks_like_automation)

    for r in records:
        if not r.evidence_id.endswith(":opened"):
            continue
        p = r.payload
        key = pr_key(r.evidence_id)
        threads[key] = Thread(
            key=key,
            number=int(key.split("#")[-1]),
            author=p.get("author", ""),
            author_is_bot=looks_like_bot(p.get("author", ""), bool(p.get("author_is_bot"))),
            opened_at=r.timestamp,
            files=list(p.get("files") or []),
            changed_files=p.get("changed_files") or 0,
            additions=p.get("additions") or 0,
            deletions=p.get("deletions") or 0,
            draft=bool(p.get("is_draft")),
            labels=list(p.get("labels") or []),
            association=p.get("author_association"),
            title=p.get("title") or "",
        )

    closed_at: dict[str, object] = {}
    for r in records:
        key = pr_key(r.evidence_id)
        thread = threads.get(key)
        if thread is None:
            continue
        if r.evidence_id.endswith(":merged"):
            thread.merged = True
            thread.merged_at = r.timestamp
        elif r.evidence_id.endswith(":closed"):
            thread.closed_unmerged = True
            closed_at[key] = r.timestamp
            thread.closed_at = r.timestamp
            thread.closed_by = r.payload.get("closed_by")
            thread.closed_by_bot = bool(thread.closed_by) and replies.looks_like_automation(
                thread.closed_by, bool(r.payload.get("closed_by_is_bot")))
        elif ":review:" in r.evidence_id or ":comment:" in r.evidence_id:
            if not looks_like_bot(
                r.payload.get("author", ""), bool(r.payload.get("author_is_bot"))
            ):
                thread.responses.append(
                    (r.timestamp, r.payload.get("author", ""), r.payload.get("body") or "")
                )
    landing_detection.mark_landed(threads, records)
    for key, when in closed_at.items():
        if threads[key].landed_via and threads[key].merged_at is None:
            threads[key].merged_at = when
    replies.attach(threads, records, threads.team)
    return threads


def _earlier_merges(threads: dict[str, Thread], by_merge_time: bool = False) -> dict[str, list]:
    """When each author's merged pull requests were opened, or merged.

    `by_merge_time` is the honest question, "had something of theirs landed
    before they opened this one?". The opening time is what the legacy
    outsider rule was recorded with (see `outsider_threads`), so it keeps it:
    two pull requests opened a day apart and merged in the other order made
    the second-opened one count as the first-timer's.
    """
    merged_opens: dict[str, list] = {}
    for t in threads.values():
        if t.merged and not t.author_is_bot:
            when = (t.merged_at or t.opened_at) if by_merge_time else t.opened_at
            merged_opens.setdefault(t.author, []).append(when)
    return merged_opens


def _had_merged_before(t: Thread, merged_opens: dict[str, list]) -> bool:
    return any(earlier < t.opened_at for earlier in merged_opens.get(t.author, []))


def outsider_threads(threads: dict[str, Thread]) -> list[Thread]:
    """Pull requests opened by people outside the project.

    Outside means not on the project's team: not OWNER, MEMBER or
    COLLABORATOR, and not shown doing a maintainer's job in the sample (see
    `people.maintainers`, which the replies share).

    Someone returning with their tenth pull request is still an outsider: the
    question a would-be contributor has is whether work from people like them
    lands, and people like them include the ones who came back.

    A capture made before the association was recorded falls back, thread by
    thread, to the rule that stood in for it: an outsider is someone who had
    not landed anything in the sample before this pull request was opened.
    That rule counted maintainers as newcomers (every maintainer's first pull
    request in the sample was a "first-time" one), which is why it was
    replaced, but it is what the recorded runs were computed with and keeps
    them replaying unchanged.
    """
    merged_opens = _earlier_merges(threads)
    team = getattr(threads, "team", frozenset())
    out = []
    for t in threads.values():
        if t.author_is_bot:
            continue
        if t.association is None:
            if not _had_merged_before(t, merged_opens):
                out.append(t)
        elif t.association not in MAINTAINER_ASSOCIATIONS and t.author not in team:
            out.append(t)
    return out


def first_timer_threads(threads: dict[str, Thread]) -> list[Thread]:
    """Outsider pull requests from people new to this repository.

    New means nothing of theirs had landed here when they opened it: no
    earlier merge of theirs in the sample, counted by when it was merged. GitHub's association narrows
    that where it can. It is read at fetch time, so a CONTRIBUTOR (someone
    whose commit has landed here) with no merge anywhere in the sample landed
    it before the sample began, and was never new within it. NONE,
    FIRST_TIME_CONTRIBUTOR and FIRST_TIMER need no special case: nothing of
    theirs has landed, so the sample finds no earlier merge either.

    What neither can see: a CONTRIBUTOR whose first merge in the sample was not
    their first here. That merge counts as a first-timer's.
    """
    merged_at = _earlier_merges(threads, by_merge_time=True)
    return [
        t
        for t in outsider_threads(threads)
        if not (t.association == "CONTRIBUTOR" and t.author not in merged_at)
        and not _had_merged_before(t, merged_at)
    ]


@dataclass(slots=True)
class Signals:
    total_threads: int
    outsider_threads: int
    outsider_merged: int
    outsider_ignored: int
    median_first_response_hours: float | None
    bot_share: float
    distinct_outsider_authors: int
    distinct_merged_authors: int
    # Share of merged threads where somebody other than the author, and not a
    # bot, said anything at all. Mechanical, over every merge -- not the
    # twelve-thread model-judged sample that the first rejection rule used and
    # which is the likeliest reason that attempt failed.
    reviewed_share: float | None
    merge_rate: float | None
    # The shape of a merged contribution: how many files it touched, and how
    # many top-level directories those spanned, at the median. A catalogue entry
    # is one file in one place almost by definition; a change to running
    # software is not. These exist so a claim *about* that shape -- `registry`,
    # `awesome_list` -- can be checked against it rather than trusted.
    merged_files_median: float | None = None
    merged_dirs_median: float | None = None
    merged_with_files: int = 0
    # How many decided outsider attempts got any reply.
    # `median_first_response_hours` is the median over exactly these; the rest
    # never got one, which a median over replies alone cannot show. Report the
    # two together.
    outsider_answered: int = 0
    # The same questions asked of people new to this repository (see
    # `first_timer_threads`), a subset of the outsiders. Reported, never used
    # by the verdict: a project that merges returning contributors' work is
    # still worth a contributor's time, and a first-timer wants to know both.
    first_timer_threads: int = 0
    first_timer_merged: int = 0
    distinct_first_timer_authors: int = 0
    distinct_first_timer_merged_authors: int = 0
    # Outsider attempts too recent to count: opened within the settle window
    # (rates.py), whether or not they are already merged or closed. Counted in `outsider_threads` (they are attempts) and
    # in no rate. `outsider_ignored` is then only open, settled and unanswered;
    # closed without a word is `outsider_closed_silently`, which is usually a
    # maintainer clearing out spam. Drafts and pull requests labelled as spam
    # are in `outsider_excluded` and nowhere else.
    outsider_still_open: int = 0
    outsider_closed_silently: int = 0
    # Closed with no reply, but not "without a word" (rates.closure): by a bot
    # soon after opening, by a bot later on, or by the author.
    outsider_closed_by_bot: int = 0
    outsider_closed_stale: int = 0
    outsider_withdrawn: int = 0
    outsider_excluded: int = 0
    # Outsider attempts opened more than rates.MAX_SAMPLE_DAYS ago (live
    # readings only): in no count, like `outsider_excluded`.
    outsider_too_old: int = 0
    # Decided outside merges GitHub shows as closed because they landed some
    # other way (Gerrit, a merge bot, a maintainer's push): landing_detection.
    # Where most do, the review happened there too, and silence on GitHub
    # says nothing (verdict.py).
    outsider_landed_elsewhere: int = 0
    # The settle window these were counted with, in hours; 0 for the frozen
    # benchmark's arithmetic. Not a count: kept so anything listing the pull
    # requests behind a count (the server's examples) buckets them the same way.
    settle_hours: float = 0.0
    # `reviewed_share` over the decided outside merges only, and how many
    # merges it covers: whether *your* pull request would get read. The
    # all-merges share counts a maintainer merging their own work unreviewed,
    # which says nothing about how outsiders are treated.
    outsider_reviewed_share: float | None = None
    merged_threads: int = 0
    # Each outside person once, by the first pull request they sent in the
    # sample: how many of those first pull requests have an outcome (merged,
    # closed, or still open after FIRST_PR_OPEN_DAYS), and how many were merged. The question a reader has is "will *my* pull request get
    # in?", and they send one. Counted per pull request, one prolific author
    # weighs as much as twenty people who each tried once. The backtest
    # (the maintainers' backtest notes) found this share predicts what happens to
    # the next newcomers better than any per-pull-request rate.
    first_pr_people: int = 0
    first_pr_merged: int = 0

    @property
    def first_pr_rate(self) -> float | None:
        """Share of people whose first pull request here was merged."""
        return self.first_pr_merged / self.first_pr_people if self.first_pr_people else None

    @property
    def outsider_judgeable(self) -> int:
        """Decided attempts: the denominator of every rate."""
        return self.outsider_threads - self.outsider_still_open

    def as_dict(self) -> dict:
        return {
            "total_threads": self.total_threads,
            "outsider_threads": self.outsider_threads,
            "outsider_merged": self.outsider_merged,
            "outsider_ignored": self.outsider_ignored,
            "median_first_response_hours": self.median_first_response_hours,
            "bot_share": round(self.bot_share, 3),
            "distinct_outsider_authors": self.distinct_outsider_authors,
            "distinct_merged_authors": self.distinct_merged_authors,
            "reviewed_share": self.reviewed_share,
            "merge_rate": self.merge_rate,
            "merged_files_median": self.merged_files_median,
            "merged_dirs_median": self.merged_dirs_median,
            "merged_with_files": self.merged_with_files,
            "outsider_answered": self.outsider_answered,
            "first_timer_threads": self.first_timer_threads,
            "first_timer_merged": self.first_timer_merged,
            "distinct_first_timer_authors": self.distinct_first_timer_authors,
            "distinct_first_timer_merged_authors": self.distinct_first_timer_merged_authors,
            "outsider_still_open": self.outsider_still_open,
            "outsider_closed_silently": self.outsider_closed_silently,
            "outsider_closed_by_bot": self.outsider_closed_by_bot,
            "outsider_closed_stale": self.outsider_closed_stale,
            "outsider_withdrawn": self.outsider_withdrawn,
            "outsider_excluded": self.outsider_excluded,
            "outsider_too_old": self.outsider_too_old,
            "outsider_landed_elsewhere": self.outsider_landed_elsewhere,
            "outsider_reviewed_share": self.outsider_reviewed_share,
            "merged_threads": self.merged_threads,
            "first_pr_people": self.first_pr_people,
            "first_pr_merged": self.first_pr_merged,
        }


# A first pull request still open and unmerged at this age counts as not
# merged; a younger one still open counts as neither. The 14-day settle
# window is too short for this rate: on projects where review takes weeks
# (pytorch, llvm, kubernetes) most first pull requests two to eight weeks old
# are still open and will land, and counting them as failures read kubernetes
# at 12% of newcomers merged when 49% of the next ones got in. Leaving them out
# until 60 days made the rate predict the next newcomers better on both
# backtest dates (the maintainers' backtest notes); 30 and 45 days did nearly as well.
FIRST_PR_OPEN_DAYS = 60


def first_prs(outsiders: Iterable[Thread], as_of: datetime | None,
              min_age_hours: float = MIN_AGE_HOURS) -> rates.Split:
    """Each person's first pull request in the sample, sorted by outcome.

    First among the ones any rate could count: not a draft or labelled spam,
    and not older than the sample reaches (rates.split). A person whose first
    one is too new to judge is still open, not decided.
    """
    capped = rates.judges_time(as_of, min_age_hours)
    firsts: dict[str, Thread] = {}
    for t in outsiders:
        if rates.excluded(t, retitled=capped):
            continue
        if capped and as_of - t.opened_at > timedelta(days=rates.MAX_SAMPLE_DAYS):
            continue
        if t.author not in firsts or t.opened_at < firsts[t.author].opened_at:
            firsts[t.author] = t
    return rates.split(firsts.values(), as_of, min_age_hours)


def compute(
    threads: dict[str, Thread],
    as_of: datetime | None = None,
    min_age_hours: float = MIN_AGE_HOURS,
) -> Signals:
    """Count what the threads show.

    `as_of` is the moment the evidence is read at. Given one, open attempts
    younger than `min_age_hours` are still open and every rate is over the
    decided rest (rates.py). Without one (or with `min_age_hours=0`) every
    attempt is decided and every silent one counts as ignored, which is how
    the committed benchmark was computed.
    """
    everyone = outsider_threads(threads)
    split = rates.split(everyone, as_of, min_age_hours)
    outsiders = split.decided
    firsts_by_person = [
        t for t in first_prs(everyone, as_of, min_age_hours).decided
        if t.merged or t.closed_unmerged or not rates.judges_time(as_of, min_age_hours)
        or as_of - t.opened_at >= timedelta(days=FIRST_PR_OPEN_DAYS)
    ]
    decided = {t.key for t in outsiders}
    firsts = [t for t in first_timer_threads(threads) if t.key in decided]
    merged_threads = [t for t in threads.values() if t.merged]
    outsider_merges = [t for t in outsiders if t.merged]
    # Every merge with a file list, not only the outsiders': what a merged
    # contribution *is* here is a property of the repository, and narrowing it
    # to newcomers would measure it on a handful of threads in a repository that
    # merges hundreds.
    shaped = [t for t in merged_threads if t.files]
    file_counts = [len(t.files) for t in shaped]
    dir_counts = [len({f.split("/")[0] for f in t.files}) for t in shaped]
    latencies = [h for t in outsiders if (h := t.first_response_hours) is not None]
    bots = sum(1 for t in threads.values() if t.author_is_bot)

    return Signals(
        total_threads=len(threads),
        outsider_threads=len(outsiders) + split.still_open,
        outsider_merged=sum(1 for t in outsiders if t.merged),
        outsider_ignored=split.ignored,
        median_first_response_hours=round(statistics.median(latencies), 1) if latencies else None,
        bot_share=(bots / len(threads)) if threads else 0.0,
        distinct_outsider_authors=len({t.author for t in outsiders}),
        # People who actually landed something, as distinct from people who
        # tried. Conflating the two produced a user-visible falsehood: a repo
        # with 15 merges and 72 attempters was reported as "15 merges from 72
        # people".
        distinct_merged_authors=len({t.author for t in outsiders if t.merged}),
        # A pull request landed off the button (an internal sync, Gerrit, a merge
        # bot) was reviewed where it landed; GitHub just doesn't show it. Without
        # this, rates over decided pull requests alone called react-native's
        # imported, reviewed-in-house merges "waved through unread".
        reviewed_share=(
            sum(1 for t in merged_threads if t.engaged or t.landed_via) / len(merged_threads)
            if merged_threads else None
        ),
        merge_rate=(len(outsiders) and sum(1 for t in outsiders if t.merged) / len(outsiders))
        or (None if not outsiders else 0.0),
        merged_files_median=statistics.median(file_counts) if file_counts else None,
        merged_dirs_median=statistics.median(dir_counts) if dir_counts else None,
        merged_with_files=len(shaped),
        outsider_answered=len(latencies),
        first_timer_threads=len(firsts),
        first_timer_merged=sum(1 for t in firsts if t.merged),
        distinct_first_timer_authors=len({t.author for t in firsts}),
        distinct_first_timer_merged_authors=len({t.author for t in firsts if t.merged}),
        outsider_still_open=split.still_open,
        outsider_closed_silently=split.closed_silently,
        outsider_closed_by_bot=split.closed_by_bot,
        outsider_closed_stale=split.closed_stale,
        outsider_withdrawn=split.withdrawn,
        outsider_excluded=split.excluded,
        outsider_too_old=split.too_old,
        outsider_landed_elsewhere=sum(1 for t in outsider_merges if t.landed_via),
        settle_hours=min_age_hours if rates.judges_time(as_of, min_age_hours) else 0.0,
        outsider_reviewed_share=(
            sum(1 for t in outsider_merges if t.engaged or t.landed_via) / len(outsider_merges)
            if outsider_merges else None
        ),
        merged_threads=len(merged_threads),
        first_pr_people=len(firsts_by_person),
        first_pr_merged=sum(1 for t in firsts_by_person if t.merged),
    )
