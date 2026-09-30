"""The backtest: the engine's answer on a past date against what happened next.

For each golden repository, one recording holds what a live report would have
read on the as-of date ("before") and the pull requests opened in the window
after it, with everything that happened to them up to the capture ("after").
`run` replays the engine on "before" under each way of counting, measures what
happened to "after", and scores the answers. The definitions, fixed before the
first run, are in the maintainers' backtest notes.

    python -m golden.backtest record [REPO ...] [--as-of 2026-06-15]   needs GITHUB_TOKEN
    python -m golden.backtest run [--json]                             offline

Nothing here reaches the network except `record`.
"""

from __future__ import annotations

import argparse
import dataclasses
import gzip
import json
import statistics
import sys
import time
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from golden.golden import HERE, PAGES, load_repos, timing_records, without_timing
from holt.agent import rates, timing
from holt.agent.pipeline import analyze_without_model
from holt.agent.signals import (
    MIN_AGE_HOURS,
    Signals,
    Thread,
    build_threads,
    compute,
    outsider_threads,
)
from holt.agent.verdict import DEFAULT_CONTRIBUTOR_DAYS
from holt.evidence.fixtures import content_hash, record_from_dict, record_to_dict, redact_records
from holt.evidence.provider import EvidenceProvider
from holt.types import EvidenceRecord, Window

# One folder per as-of date: golden/backtests/2026-06-15/<owner>__<name>.json.gz
BACKTESTS = HERE / "backtests"

AS_OF = datetime(2026, 6, 15, tzinfo=UTC)
WINDOW_DAYS = 45
# Read from the as-of date forward, oldest first: a busy repository's window
# then starts where the "before" read stopped, not weeks later.
AFTER_PAGES = 8
# The server's warm pass keeps this many points in hand (HOLT_WARM_MIN_POINTS);
# a recording run never takes the token below it.
MIN_POINTS = 1500

# --- the outcome (the maintainers' backtest notes) ------------------------------------

# Fewer people than this in the window, and the answer was never tested.
MIN_PEOPLE = 8
REPLY_HOURS = 14 * 24
# A Worth answer is broken when fewer than this share of people got in; a Not
# worth answer when at least this share did.
FALSE_GREEN_BELOW = 0.15
FALSE_RED_FROM = 0.40
# The plain baseline: the before sample's own first-PR merge rate.
BASELINE_WORTH_FROM = 0.30
BASELINE_NOT_WORTH_BELOW = 0.10

# Rules whose Not worth is about what a merge is worth, not whether one
# happens: scored with the rest (as pre-declared), and also shown without.
CATALOGUE_RULES = frozenset({"catalogue_shape", "non_software_kind"})

RANK = {"viable": 3, "long_shot": 2, "not_viable": 1}
SHORT = {"viable": "Worth", "long_shot": "Long shot", "not_viable": "Not worth",
         "insufficient_evidence": "Not enough", "personal": "Personal", "catalogue": "List"}


# --- recordings -----------------------------------------------------------------


@dataclass(slots=True)
class Backtest:
    repo: str
    as_of: datetime
    window_end: datetime
    captured_at: datetime
    before: list[EvidenceRecord]
    after: list[EvidenceRecord]


def date_root(as_of: datetime) -> Path:
    """The folder that holds every recording made for one as-of date."""
    return BACKTESTS / as_of.date().isoformat()


def as_of_dates() -> list[datetime]:
    """Every as-of date with recordings, oldest first."""
    return sorted(datetime.fromisoformat(p.name).replace(tzinfo=UTC)
                  for p in BACKTESTS.glob("????-??-??") if p.is_dir())


def backtest_path(repo: str, root: Path) -> Path:
    return root / (repo.replace("/", "__") + ".json.gz")


def _part(records: Iterable[EvidenceRecord]) -> tuple[list[dict], str, int]:
    records, removed = redact_records(records)
    records = sorted(records, key=lambda r: r.evidence_id)
    return [record_to_dict(r) for r in records], content_hash(records), removed


def write_backtest(bt: Backtest, root: Path | None = None) -> Path:
    """Scrubbed of third-party credentials, hashed, gzipped. Deterministic bytes."""
    before, before_hash, removed_b = _part(bt.before)
    after, after_hash, removed_a = _part(bt.after)
    body = {
        "repo": bt.repo,
        "as_of": bt.as_of.isoformat(),
        "window_end": bt.window_end.isoformat(),
        "captured_at": bt.captured_at.isoformat(),
        "pages": PAGES,
        "after_pages": AFTER_PAGES,
        "before_sha256": before_hash,
        "after_sha256": after_hash,
        "credentials_redacted": removed_b + removed_a,
        "before": before,
        "after": after,
    }
    path = backtest_path(bt.repo, root or date_root(bt.as_of))
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    tmp.replace(path)
    return path


def read_backtest(repo: str, root: Path) -> Backtest:
    path = backtest_path(repo, root)
    data = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
    before = [record_from_dict(r) for r in data["before"]]
    after = [record_from_dict(r) for r in data["after"]]
    if content_hash(before) != data["before_sha256"] or content_hash(after) != data["after_sha256"]:
        raise ValueError(f"{path} was edited after it was recorded (content hash mismatch)")
    return Backtest(
        repo=data["repo"],
        as_of=datetime.fromisoformat(data["as_of"]),
        window_end=datetime.fromisoformat(data["window_end"]),
        captured_at=datetime.fromisoformat(data["captured_at"]),
        before=before,
        after=after,
    )


def after_query(home: str, as_of: datetime, window_end: datetime) -> str:
    """Pull requests opened in the window, oldest first. The as-of date is a
    midnight, so this starts exactly where the before read's `created:<` stops."""
    return (f"repo:{home} is:pr created:{as_of.date().isoformat()}.."
            f"{(window_end - timedelta(seconds=1)).date().isoformat()} sort:created-asc")


def record(repos: list[str], as_of: datetime = AS_OF, window_days: int = WINDOW_DAYS,
           root: Path | None = None, force: bool = False, transport=None) -> int:
    """Capture each repository's before and after. Returns the number that failed."""
    from holt.evidence.github_graphql import GitHubGraphQL, LiveGitHubProvider, project

    root = root or date_root(as_of)

    transport = transport or GitHubGraphQL()
    window_end = as_of + timedelta(days=window_days)
    failed = 0
    for i, repo in enumerate(repos, 1):
        if backtest_path(repo, root).exists() and not force:
            print(f"[{i}/{len(repos)}] {repo}: already recorded (--force to redo)")
            continue
        if transport.remaining is not None and transport.remaining < MIN_POINTS:
            print(f"Stopping: {transport.remaining} points left, under the "
                  f"{MIN_POINTS} floor. Run again after the reset.")
            return failed + 1
        captured_at = datetime.now(UTC).replace(microsecond=0)
        try:
            before = LiveGitHubProvider(Window.PRE_T, cutoff=as_of, transport=transport,
                                        max_pages=PAGES).fetch(repo)
            meta = next((r for r in before if r.evidence_id.endswith(":meta")), None)
            home = (meta.payload.get("name_with_owner") if meta else None) or repo
            if home.lower() != repo.lower():
                failed += 1
                print(f"[{i}/{len(repos)}] {repo}: renamed to {home}; list that instead")
                continue
            nodes = list(transport.search_pull_requests(
                after_query(home, as_of, window_end), AFTER_PAGES))
            after = [r for r in project(repo, nodes, home=home)
                     if r.timestamp <= captured_at]
        except Exception as exc:  # noqa: BLE001 -- reported, and the rest still run
            failed += 1
            print(f"[{i}/{len(repos)}] {repo}: FAILED {type(exc).__name__}: {exc}")
            continue
        path = write_backtest(Backtest(repo, as_of, window_end, captured_at, before, after), root)
        n_before = sum(1 for r in before if r.evidence_id.endswith(":opened"))
        n_after = sum(1 for r in after if r.evidence_id.endswith(":opened"))
        print(f"[{i}/{len(repos)}] {repo}: {n_before} PRs before, {n_after} after, "
              f"{path.stat().st_size // 1024} KB (rate {transport.remaining})", flush=True)
        time.sleep(0.3)
    return failed


class _BeforeProvider(EvidenceProvider):
    """Serves the before records as a live read on the as-of date served them."""

    judges_recency = True

    def __init__(self, bt: Backtest) -> None:
        super().__init__(Window.PRE_T, bt.as_of)
        self.repo = bt.repo
        self._records = bt.before
        self._by_id = {r.evidence_id: r for r in bt.before}

    def _fetch_raw(self, request: str, /, **params: object) -> Iterable[EvidenceRecord]:
        if request != self.repo:
            raise ValueError(f"this provider serves {self.repo}, not {request}")
        return list(self._records)

    def _resolve_raw(self, evidence_id: str) -> EvidenceRecord | None:
        return self._by_id.get(evidence_id)


# --- ways of counting (the maintainers' backtest notes, "Counting methods") ----------


def _outside(threads: dict[str, Thread]) -> list[Thread]:
    return [t for t in outsider_threads(threads) if not rates.excluded(t)]


def count_people(threads: dict[str, Thread], as_of: datetime | None = None,
                 min_age_hours: float = MIN_AGE_HOURS) -> Signals:
    """Every person once: merged if any of their pull requests merged,
    unanswered if none of their decided ones got a reply."""
    base = compute(threads, as_of, min_age_hours)
    by: dict[str, list[Thread]] = defaultdict(list)
    for t in _outside(threads):
        by[t.author].append(t)
    decided = {t.key for t in rates.split(outsider_threads(threads), as_of, min_age_hours).decided}
    people = still = merged = ignored = elsewhere = 0
    latencies: list[float] = []
    for ts in by.values():
        mine = [t for t in ts if t.key in decided]
        if not mine:
            still += any(rates.outcome(t, as_of, min_age_hours) == rates.STILL_OPEN for t in ts)
            continue
        people += 1
        landed = [t for t in mine if t.merged]
        if landed:
            merged += 1
            elsewhere += all(t.landed_via for t in landed)
        if all(rates.outcome(t, as_of, min_age_hours) == rates.IGNORED for t in mine):
            ignored += 1
        replies = sorted((t.opened_at, h) for t in mine if (h := t.first_response_hours) is not None)
        if replies:
            latencies.append(replies[0][1])
    return dataclasses.replace(
        base,
        outsider_threads=people + still, outsider_still_open=still,
        outsider_merged=merged, outsider_ignored=ignored, outsider_answered=len(latencies),
        median_first_response_hours=round(statistics.median(latencies), 1) if latencies else None,
        merge_rate=(merged / people) if people else None,
        outsider_landed_elsewhere=elsewhere,
    )


def count_first_prs(threads: dict[str, Thread], as_of: datetime | None = None,
                    min_age_hours: float = MIN_AGE_HOURS) -> Signals:
    """Each person's first pull request in the sample, once."""
    base = compute(threads, as_of, min_age_hours)
    by: dict[str, list[Thread]] = defaultdict(list)
    for t in _outside(threads):
        by[t.author].append(t)
    firsts = [min(ts, key=lambda t: t.opened_at) for ts in by.values()]
    split = rates.split(firsts, as_of, min_age_hours)
    decided = split.decided
    latencies = [h for t in decided if (h := t.first_response_hours) is not None]
    landed = [t for t in decided if t.merged]
    return dataclasses.replace(
        base,
        outsider_threads=len(decided) + split.still_open, outsider_still_open=split.still_open,
        outsider_merged=len(landed), outsider_ignored=split.ignored,
        outsider_answered=len(latencies),
        median_first_response_hours=round(statistics.median(latencies), 1) if latencies else None,
        merge_rate=(len(landed) / len(decided)) if decided else None,
        distinct_outsider_authors=len(decided), distinct_merged_authors=len(landed),
        outsider_landed_elsewhere=sum(1 for t in landed if t.landed_via),
    )


COUNTS: dict[str, Callable[..., Signals]] = {
    "prs": compute,
    "people": count_people,
    "first_pr": count_first_prs,
}


# --- what happened next ------------------------------------------------------------


@dataclass(slots=True)
class Outcome:
    people: int
    merged: float | None
    replied_14d: float | None

    @property
    def tested(self) -> bool:
        return self.people >= MIN_PEOPLE


def outcome(bt: Backtest) -> Outcome:
    """What happened to each person's first outside pull request in the window."""
    threads = build_threads(bt.before + bt.after)
    window = [t for t in _outside(threads) if bt.as_of < t.opened_at <= bt.window_end]
    by: dict[str, list[Thread]] = defaultdict(list)
    for t in window:
        by[t.author].append(t)
    firsts = [min(ts, key=lambda t: t.opened_at) for ts in by.values()]
    if not firsts:
        return Outcome(0, None, None)
    merged = sum(1 for t in firsts if t.merged)
    replied = sum(1 for t in firsts
                  if (h := t.first_response_hours) is not None and h <= REPLY_HOURS)
    return Outcome(len(firsts), merged / len(firsts), replied / len(firsts))


# --- scoring -------------------------------------------------------------------


@dataclass(slots=True)
class Row:
    repo: str
    verdict: str
    rule: str
    outcome: Outcome


def answer(bt: Backtest, count: Callable[..., Signals]) -> tuple[str, str, Signals]:
    """The engine's verdict on the as-of date, its deciding rule and its counts."""
    provider = _BeforeProvider(bt)
    assessment, trace = analyze_without_model(
        bt.repo, provider, contributor_days=DEFAULT_CONTRIBUTOR_DAYS, as_of=bt.as_of,
        count=count)
    rule = rates.first_deciding(trace.rules)
    return assessment.verdict.value, (getattr(rule, "code", "") if rule else ""), trace.signals


def baseline(bt: Backtest) -> str:
    """The plainest predictor: the before sample's own first-PR merge rate."""
    provider = _BeforeProvider(bt)
    threads = build_threads(provider.fetch(bt.repo))
    s = count_first_prs(threads, bt.as_of, MIN_AGE_HOURS)
    if s.outsider_judgeable < MIN_PEOPLE or s.merge_rate is None:
        return "insufficient_evidence"
    if s.merge_rate >= BASELINE_WORTH_FROM:
        return "viable"
    if s.merge_rate < BASELINE_NOT_WORTH_BELOW:
        return "not_viable"
    return "long_shot"


def _ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else None


@dataclass(slots=True)
class Score:
    method: str
    rows: list[Row]

    @property
    def scored(self) -> list[Row]:
        return [r for r in self.rows if r.outcome.tested and r.verdict in RANK]

    @property
    def false_greens(self) -> list[Row]:
        return [r for r in self.scored
                if r.verdict == "viable" and r.outcome.merged < FALSE_GREEN_BELOW]

    @property
    def false_reds(self) -> list[Row]:
        return [r for r in self.scored
                if r.verdict == "not_viable" and r.outcome.merged >= FALSE_RED_FROM]

    def without(self, repos: set[str]) -> Score:
        return Score(self.method, [r for r in self.rows if r.repo not in repos])

    def group(self, verdict: str) -> list[Row]:
        return [r for r in self.rows if r.verdict == verdict and r.outcome.tested]

    @property
    def rank_agreement(self) -> float | None:
        rows = self.scored
        return spearman([RANK[r.verdict] for r in rows], [r.outcome.merged for r in rows])


def score_all(backtests: list[Backtest], methods: Iterable[str] = COUNTS) -> list[Score]:
    outcomes = {bt.repo: outcome(bt) for bt in backtests}
    scores = []
    for method in methods:
        rows = []
        for bt in backtests:
            verdict, rule, _ = answer(bt, COUNTS[method])
            rows.append(Row(bt.repo, verdict, rule, outcomes[bt.repo]))
        scores.append(Score(method, rows))
    scores.append(Score("baseline", [Row(bt.repo, baseline(bt), "baseline", outcomes[bt.repo])
                                     for bt in backtests]))
    return scores


def pooled(runs: dict[str, list[Score]]) -> list[Score]:
    """Every date's rows in one score per method, each row named with its date."""
    out = []
    for i, first in enumerate(next(iter(runs.values()))):
        rows = [Row(f"{r.repo} ({day})", r.verdict, r.rule, r.outcome)
                for day, scores in runs.items() for r in scores[i].rows]
        out.append(Score(first.method, rows))
    return out


# --- how long it takes here (engine 7): does the line hold? ----------------------


def record_timing(repos: list[str], root: Path, transport=None) -> int:
    """Add (or redo) engine 7's timing cohort in each recording's before part,
    as of its as-of date. Returns the number that failed."""
    from holt.evidence.github_graphql import GitHubGraphQL

    transport = transport or GitHubGraphQL()
    failed = 0
    for i, repo in enumerate(repos, 1):
        if not backtest_path(repo, root).exists():
            continue
        bt = read_backtest(repo, root)
        try:
            added, points = timing_records(transport, repo, bt.as_of, bt.before, stale=False)
        except Exception as exc:  # noqa: BLE001 -- reported, and the rest still run
            failed += 1
            print(f"[{i}/{len(repos)}] {repo}: FAILED {type(exc).__name__}: {exc}")
            continue
        bt.before = without_timing(bt.before) + added
        write_backtest(bt, root)
        print(f"[{i}/{len(repos)}] {repo}: {added[0].payload}, {points} points "
              f"(rate {transport.remaining})", flush=True)
    return failed


@dataclass(slots=True)
class Held:
    """One timing line said on the as-of date, and what happened next: the
    share of the window's outside pull requests it held for."""

    repo: str
    claim: str  # "reply_most", "reply_half", "merged_7", "merged_30", "merge_half"
    said: float  # the wait said (hours or days), or the share said
    target: float  # the share the line promises
    held: float  # the share it held for
    n: int


def calibrate(bt: Backtest) -> list[Held]:
    """Each line the before part supports, checked on the window after it."""
    said = timing.read(bt.before, build_threads(bt.before), bt.as_of, rates.SETTLE_HOURS)
    both = build_threads(bt.before + bt.after)
    window = [t for t in _outside(both) if bt.as_of < t.opened_at <= bt.window_end]
    answers = [timing.answer(t, bt.captured_at) for t in window]
    merges = [timing.Waited((bt.captured_at - t.opened_at) / timing.HOUR,
                            (t.merged_at - t.opened_at) / timing.HOUR
                            if t.merged and t.merged_at and t.merged_at <= bt.captured_at
                            else None) for t in window]
    out: list[Held] = []

    def check(claim: str, items: list, hours: float, target: float, stated: float) -> None:
        eligible = [w for w in items if w.counts_at(hours)]
        held = timing.share_within(items, hours, timing.MIN_PRS)
        if held is not None:
            out.append(Held(bt.repo, claim, stated, target, held, len(eligible)))

    if (h := said.first_reply_slow_hours) is not None:
        check("reply_most", answers, h, timing.REPLY_MOST, h)
    if (h := said.first_reply_half_hours) is not None:
        check("reply_half", answers, h, 0.5, h)
    if said.merged_within:
        for d in (7, 30):
            check(f"merged_{d}", merges, d * 24.0, said.merged_within[d], said.merged_within[d])
    if (d := said.merge_half_days) is not None:
        check("merge_half", merges, d * 24.0, 0.5, d)
    return out


def calibration_report(runs: dict[str, list[Held]]) -> str:
    """Per claim and date: how many repositories, the median share the line
    held for against what it promised, and how many landed within 15 points."""
    names = {"reply_most": "most get a first reply within N",
             "reply_half": "about half get a first reply within N",
             "merged_7": "the share merged within a week",
             "merged_30": "the share merged within a month",
             "merge_half": "about half are merged within X"}
    out = ["| line | date | repos | promised (median) | held (median) | "
           "within ±15 points |", "|---|---|---|---|---|---|"]
    for claim, name in names.items():
        for day, rows in runs.items():
            rs = [r for r in rows if r.claim == claim]
            if not rs:
                continue
            close = sum(1 for r in rs if abs(r.held - r.target) <= 0.15)
            out.append(f"| {name} | {day} | {len(rs)} | "
                       f"{statistics.median(r.target for r in rs):.0%} | "
                       f"{statistics.median(r.held for r in rs):.0%} | {close}/{len(rs)} |")
    out += ["", "| repo | date | line | said | promised | held | PRs |", "|---|---|---|---|---|---|---|"]
    for day, rows in runs.items():
        for r in rows:
            said = (f"{r.said / 24:.1f} d" if r.claim.startswith("reply")
                    else f"{r.said:.1f} d" if r.claim == "merge_half" else f"{r.said:.0%}")
            out.append(f"| {r.repo} | {day} | {r.claim} | {said} | {r.target:.0%} | "
                       f"{r.held:.0%} | {r.n} |")
    return "\n".join(out)


# --- the report ------------------------------------------------------------------


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{x:.0%}"


def _median(rows: list[Row], attr: str) -> float | None:
    values = [getattr(r.outcome, attr) for r in rows if getattr(r.outcome, attr) is not None]
    return statistics.median(values) if values else None


def _summary(scores: list[Score]) -> list[str]:
    out = ["| method | scored | false greens | false reds | rank agreement | "
           "Worth: merged / replied | Long shot | Not worth |",
           "|---|---|---|---|---|---|---|---|"]
    for s in scores:
        cells = []
        for v in ("viable", "long_shot", "not_viable"):
            g = s.group(v)
            cells.append(f"{_pct(_median(g, 'merged'))} / {_pct(_median(g, 'replied_14d'))} "
                         f"(n={len(g)})")
        ra = s.rank_agreement
        out.append(f"| {s.method} | {len(s.scored)} | {len(s.false_greens)} | "
                   f"{len(s.false_reds)} | {'–' if ra is None else f'{ra:.2f}'} | "
                   + " | ".join(cells) + " |")
    return out


def report(scores: list[Score]) -> str:
    rows0 = scores[0].rows
    tested = sum(1 for r in rows0 if r.outcome.tested)
    out = [f"{len(rows0)} repositories, {tested} tested "
           f"(at least {MIN_PEOPLE} people opened an outside PR in the window).", ""]
    out += _summary(scores)
    catalogues = {r.repo for r in rows0 if r.rule in CATALOGUE_RULES}
    if catalogues:
        out += ["", f"Without the {len(catalogues)} catalogues and lists (their Not worth "
                "means \"not a software contribution\", not \"won't merge\"):", ""]
        out += _summary([s.without(catalogues) for s in scores])
    out += ["", "Medians are over tested repositories: the share of people whose first "
            "window PR was merged / replied to within 14 days.", ""]
    for s in scores:
        wrong = [("false green", r) for r in s.false_greens] + [("false red", r) for r in s.false_reds]
        if wrong:
            out.append(f"**{s.method}**: " + "; ".join(
                f"{r.repo} ({kind}, {r.rule}: {_pct(r.outcome.merged)} of "
                f"{r.outcome.people} got in)" for kind, r in wrong))
    out += ["", "| repo | people | merged | replied 14d | "
            + " | ".join(s.method for s in scores) + " |",
            "|---|---|---|---|" + "---|" * len(scores)]
    for i, r in enumerate(rows0):
        o = r.outcome
        out.append(f"| {r.repo} | {o.people} | {_pct(o.merged)} | {_pct(o.replied_14d)} | "
                   + " | ".join(SHORT.get(s.rows[i].verdict, s.rows[i].verdict) for s in scores)
                   + " |")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m golden.backtest",
                                     description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("record", help="capture before and after (needs GITHUB_TOKEN)")
    rec.add_argument("repos", nargs="*", help="default: every repository in golden/repos.json")
    rec.add_argument("--as-of", default=AS_OF.date().isoformat(), help="YYYY-MM-DD, midnight UTC")
    rec.add_argument("--window", type=int, default=WINDOW_DAYS, help="days after the as-of date")
    rec.add_argument("--force", action="store_true", help="re-record existing recordings")
    tim = sub.add_parser("record-timing", help="add engine 7's timing cohort to the before "
                         "parts, as of their as-of date (needs GITHUB_TOKEN)")
    tim.add_argument("repos", nargs="*", help="default: every repository in golden/repos.json")
    tim.add_argument("--as-of", help="only this date (default: each recorded date)")
    cal = sub.add_parser("calibrate", help="do the timing lines hold for the next pull "
                         "requests? (offline)")
    cal.add_argument("--as-of", help="only this date (default: each recorded date)")
    run = sub.add_parser("run", help="score every counting method (offline)")
    run.add_argument("--as-of", help="only this date (default: each recorded date, then pooled)")
    run.add_argument("--json", action="store_true", help="rows as JSON instead of Markdown")
    args = parser.parse_args(argv)

    if args.cmd == "record":
        as_of = datetime.fromisoformat(args.as_of).replace(tzinfo=UTC)
        return 1 if record(args.repos or list(load_repos()), as_of, args.window,
                           force=args.force) else 0

    dates = ([datetime.fromisoformat(args.as_of).replace(tzinfo=UTC)] if args.as_of
             else as_of_dates())
    if args.cmd == "record-timing":
        return 1 if any([record_timing(args.repos or list(load_repos()), date_root(d))
                         for d in dates]) else 0
    if args.cmd == "calibrate":
        held = {}
        for d in dates:
            root = date_root(d)
            held[d.date().isoformat()] = [h for r in load_repos() if backtest_path(r, root).exists()
                                          for h in calibrate(read_backtest(r, root))]
        print(calibration_report(held))
        return 0
    runs: dict[str, list[Score]] = {}
    for as_of in dates:
        root = date_root(as_of)
        repos = [r for r in load_repos() if backtest_path(r, root).exists()]
        if repos:
            runs[as_of.date().isoformat()] = score_all([read_backtest(r, root) for r in repos])
    if not runs:
        print("No backtest recordings yet: run `python -m golden.backtest record`.",
              file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({day: {s.method: [{"repo": r.repo, "verdict": r.verdict, "rule": r.rule,
                                            **dataclasses.asdict(r.outcome)} for r in s.rows]
                                for s in scores} for day, scores in runs.items()}, indent=1))
        return 0
    sections = [f"## As of {day}\n\n{report(scores)}" for day, scores in runs.items()]
    if len(runs) > 1:
        sections.append(f"## Every date pooled\n\n{report(pooled(runs))}")
    print("\n\n".join(sections))
    return 0

if __name__ == "__main__":
    sys.exit(main())
