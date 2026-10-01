"""Warm the caches before people arrive: popular repos' reports and starter
issues, the repository details Discover shows, and the /find searches the web
app's default pages make.

    python -m holt_server.warm                 # everything, stopping on GitHub budget
    python -m holt_server.warm --dry-run       # what would run, no GitHub calls
    python -m holt_server.warm --no-find --limit 50
    python -m holt_server.warm --stale-only    # after a deploy: redo reports from an older engine
    python -m holt_server.warm --tier weekly   # reports only: saved or recently viewed repos
    python -m holt_server.warm --tier monthly  # reports only: the rest of the seed list
    python -m holt_server.warm --no-reports --no-starter --no-find   # details only (daily timer)

Or in the API process on a schedule: HOLT_WARM_INTERVAL_HOURS=6.

How it stays out of the way:

* Reports go through the normal job queue at badge priority, so every user
  request runs first. The pass keeps HOLT_WARM_PARALLEL (3) report jobs in
  flight and queues the next as one finishes; the runner's badge lane
  (HOLT_BADGE_CONCURRENCY) should allow as many at a time.
* Fresh work is skipped: reports under HOLT_WARM_MAX_AGE_HOURS (20), finds
  and starter issues still inside most of their cache lifetime. A report or
  find made by an older engine version (holt.engine_version) is never fresh.
  `--stale-only` does just those: every seed whose latest report is from an
  older engine, however young, and nothing else. Run it after a deploy that
  bumps ENGINE_VERSION. Where the evidence behind that report was kept
  (evidence_store.py) and is younger than its repo's refresh tier (a week or
  a month; at least HOLT_EVIDENCE_REUSE_HOURS), the report is made again from
  it, in this process, with no GitHub call.
* Seeds the last look found closed to outside pull requests (GitHub's
  settings, or archived) or dormant (no push in DORMANT_DAYS) go last, so a
  pass that runs out of budget has done the useful ones. That comes from
  their last report and repo_meta; nothing is read from GitHub to decide it.
* Repository details (discover.py) are read for every reported repo at once,
  a hundred per GraphQL query (about a point each), once a day. A repo's
  first report reads its own details right away (meta_refresh.py); the
  details-only pass (`deploy/prod/warm-meta.sh`, a daily timer) keeps the
  rest from going stale. The summary says how many GitHub points it used.
* Refresh tiers (`--tier`, deploy/prod/warm-refresh.sh): repos someone saved,
  viewed in the last INTEREST_DAYS, or has an open pull request PR watch
  alerts on, are the weekly tier; the rest of the seed list is the monthly one. A tier pass runs reports only, the oldest
  first, and skips any younger than HOLT_WARM_MAX_AGE_HOURS, which the
  timer sets per tier (a week, a month).
* Before each report job, and every few other steps, it checks the GitHub
  GraphQL points left on every token and stops below HOLT_WARM_MIN_POINTS,
  counting REPORT_POINTS for each report still in flight, so a warm pass can
  never starve the requests people make. `--wait-for-budget` waits for the
  points to come back instead of stopping (a long sweep, left alone).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select, text

from holt_server import evidence_store, repos, starter
from holt_server.db import (
    ACTIVE,
    BADGE_PRIORITY,
    ENGINE_VERSION,
    AlertSettings,
    Contribution,
    FindCache,
    Job,
    RepoMeta,
    RepoView,
    Report,
    SavedRepo,
    StarterCache,
    dedupe_key,
    find_key,
    now,
    utc,
)
from holt_server.errors import ApiError

log = logging.getLogger("holt_server.warm")

# Package data, so it ships in the wheel and the image.
SEEDS = Path(__file__).with_name("seeds") / "repos.txt"
DAYS = 7
JOB_TIMEOUT_S = 15 * 60
POLL_S = 1.0
# Budget is checked before every report job, and before the first of the
# other steps and then every this many.
BUDGET_EVERY = 5
# The most GitHub points one report costs (measured: 10 typical, 18 at most),
# held back for each report still in flight when the budget is checked.
REPORT_POINTS = 20
# What a report costs on average (production, 304 repos), for dry-run estimates.
REPORT_POINTS_TYPICAL = 12
# --wait-for-budget: how long to wait before looking at the points again.
BUDGET_WAIT_S = 300
# Seeds with no push in this many days go last (the engine's "inactive" rule
# looks at the same 90 days), and so do those whose last report was decided
# by one of these rules.
DORMANT_DAYS = 90
QUIET_RULES = frozenset({"archived", "prs_closed", "inactive"})
# A job that never finishes fails its repository and the pass goes on; this
# many in a row means nothing is working the queue, and the pass stops.
MAX_TIMEOUTS_IN_A_ROW = 3
# Refresh a cached find or starter list once this share of its lifetime is gone.
REFRESH_AFTER = 0.8
FIND_LIMIT = 20
LOCK_ID = 7_406_111
# Exit status when another process is warming (as deploy.sh: try again later).
BUSY = 75
TIERS = ("weekly", "monthly")
# Viewed on Holt this recently: the weekly tier.
INTEREST_DAYS = 30
# A report is stored a few minutes after its evidence was read (the job's run
# time), so a snapshot this much older than the report is still its evidence.
SNAPSHOT_SLACK = timedelta(hours=1)

# The searches the web app makes on its own pages (web/src/app/hacktoberfest
# and web/src/app/find): languages as the web sends them, lower-cased.
HACKTOBERFEST_TABS: list[list[str]] = [
    [], ["python"], ["javascript", "typescript"], ["go"], ["rust"], ["java"],
    ["c", "c++"], ["ruby"], ["php"],
]
FIND_CHIPS = ["python", "javascript", "typescript", "go", "rust", "java", "c++", "ruby",
              "php", "nix"]


@dataclass(frozen=True)
class Profile:
    languages: tuple[str, ...]
    hacktoberfest: bool
    days: int = DAYS

    @property
    def key(self) -> str:
        return find_key(list(self.languages), [], self.hacktoberfest, self.days)


def profiles() -> list[Profile]:
    seen: dict[str, Profile] = {}
    candidates = [Profile(tuple(sorted(t)), True) for t in HACKTOBERFEST_TABS]
    candidates += [Profile((lang,), hf) for lang in FIND_CHIPS for hf in (True, False)]
    for p in candidates:
        seen.setdefault(p.key, p)
    return list(seen.values())


def load_seeds(path: Path | str | None = None) -> list[str]:
    """`owner/repo` per line; `#` comments and blank lines ignored; deduplicated."""
    out, seen = [], set()
    for line in Path(path or SEEDS).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        try:
            repo = repos.normalize(line)
        except ApiError:
            log.warning("seed %r is not a repository; skipped", line)
            continue
        if repos.key(repo) not in seen:
            seen.add(repos.key(repo))
            out.append(repo)
    return out


@dataclass
class Result:
    reports_run: int = 0
    reports_fresh: int = 0
    # Made again from kept evidence, with no GitHub call (--stale-only).
    reports_rederived: int = 0
    reports_failed: int = 0
    # Closed to outside pull requests or dormant, so warmed last.
    quiet_last: int = 0
    starter_run: int = 0
    starter_fresh: int = 0
    meta_run: int = 0
    meta_points: int = 0
    finds_run: int = 0
    finds_fresh: int = 0
    stopped: str | None = None
    dry_run: bool = False
    failures: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = [f"reports {self.reports_run} run, {self.reports_fresh} fresh, "
                 f"{self.reports_failed} failed",
                 f"{self.reports_rederived} made again from kept evidence",
                 f"{self.quiet_last} closed or dormant seeds last",
                 f"starter issues {self.starter_run} run, {self.starter_fresh} fresh",
                 f"repo details {self.meta_run} read ({self.meta_points} GitHub points)",
                 f"finds {self.finds_run} run, {self.finds_fresh} fresh"]
        if self.dry_run:
            parts.append(f"the reports would use about "
                         f"{self.reports_run * REPORT_POINTS_TYPICAL} GitHub points")
        if self.stopped:
            parts.append(f"stopped: {self.stopped}")
        return "; ".join(parts)


class OutOfBudget(Exception):
    pass


class Warmer:
    def __init__(self, svc, say: Callable[[str], None] = log.info, dry_run: bool = False,
                 parallel: int | None = None, wait_for_budget: bool = False):
        self.svc = svc
        self.say = say
        self.dry_run = dry_run
        # Report jobs in flight at once; a dry run goes one by one, in order.
        self.parallel = 1 if dry_run else max(1, parallel or svc.settings.warm_parallel)
        self.wait_for_budget = wait_for_budget
        self.result = Result(dry_run=dry_run)
        self._steps = 0
        self._timeouts = 0
        self._in_flight = 0
        # One budget check at a time, so two workers can't both take the last points.
        self._budget = asyncio.Lock()
        # repo keys of the weekly refresh tier (--stale-only's snapshot ages).
        self._weekly: set[str] = set()

    # --- budget -------------------------------------------------------------

    async def check_budget(self) -> None:
        """Before a step other than a report: every BUDGET_EVERY steps."""
        if self.dry_run:
            return
        self._steps += 1
        if (self._steps - 1) % BUDGET_EVERY:
            return
        async with self._budget:
            await self._enough_points()

    @contextlib.asynccontextmanager
    async def report_slot(self):
        """Around one report job: the budget checked first, with REPORT_POINTS
        held back for every report already in flight."""
        async with self._budget:
            await self._enough_points()
            self._in_flight += 1
        try:
            yield
        finally:
            self._in_flight -= 1

    async def _enough_points(self) -> None:
        """OutOfBudget when the points left, less what the reports in flight
        may still spend, are under HOLT_WARM_MIN_POINTS; with --wait-for-budget,
        wait for them to come back instead."""
        floor = self.svc.settings.warm_min_points
        while True:
            remaining = await self.svc.lookup.remaining()
            spare = remaining - self._in_flight * REPORT_POINTS
            if spare >= floor:
                return
            why = f"GitHub points left {remaining} < {floor}"
            if self._in_flight:
                n = self._in_flight
                why = (f"GitHub points left {remaining}, {spare} after the {n} "
                       f"report{'' if n == 1 else 's'} in flight, < {floor}")
            if not self.wait_for_budget:
                raise OutOfBudget(why)
            self.say(f"{why}; looking again in {BUDGET_WAIT_S // 60} minutes")
            await asyncio.sleep(BUDGET_WAIT_S)

    # --- freshness ----------------------------------------------------------

    async def latest_report(self, repo: str) -> Report | None:
        """The seed's newest 7-day rules report: its time and engine version only."""
        async with self.svc.db.session() as s:
            row = (await s.execute(
                select(Report.created_at, Report.engine_version).where(
                    Report.repo_key == repos.key(repo), Report.mode == "rules",
                    Report.days == DAYS)
                .order_by(Report.created_at.desc(), Report.id.desc()).limit(1)
            )).first()
        return Report(created_at=row[0], engine_version=row[1]) if row else None

    async def report_is_fresh(self, repo: str) -> bool:
        cutoff = now() - timedelta(hours=self.svc.settings.warm_max_age_hours)
        latest = await self.latest_report(repo)
        return latest is not None and not latest.outdated and utc(latest.created_at) >= cutoff

    async def report_is_outdated(self, repo: str) -> bool:
        """There is a report, and an older engine made it."""
        latest = await self.latest_report(repo)
        return latest is not None and latest.outdated

    async def starter_is_fresh(self, repo: str) -> bool:
        ttl = timedelta(hours=self.svc.settings.starter_cache_hours * REFRESH_AFTER)
        async with self.svc.db.session() as s:
            row = await s.get(StarterCache, repos.key(repo))
        return (row is not None and utc(row.created_at) >= now() - ttl
                and starter.current(row.issues, row.rules_version))

    async def find_is_fresh(self, profile: Profile) -> bool:
        ttl = timedelta(hours=self.svc.settings.find_cache_hours * REFRESH_AFTER)
        async with self.svc.db.session() as s:
            row = await s.get(FindCache, profile.key)
        return row is not None and not row.outdated and utc(row.created_at) >= now() - ttl

    # --- jobs ---------------------------------------------------------------

    async def run_job(self, job: Job) -> Job | None:
        """The finished job, or None if it timed out (counted as a failure)."""
        if self._timeouts >= MAX_TIMEOUTS_IN_A_ROW:
            raise OutOfBudget(
                f"{self._timeouts} jobs in a row were never finished; is anything "
                "working the queue (HOLT_BADGE_CONCURRENCY > 0)?")
        try:
            done = await self._run_job(job)
        except TimeoutError as exc:
            self._timeouts += 1
            self.say(str(exc))
            return None
        self._timeouts = 0
        return done

    async def _run_job(self, job: Job) -> Job:
        """Queue (or join an identical queued job) and wait for it to finish."""
        from holt_server.api import active_job, insert_or_join

        if job.kind == "find":
            job_id = await self._insert_find(job)
        elif (running := await active_job(self.svc, job.repo_key, job.mode, job.days)):
            job_id = running.id  # wait on it; joining would raise its priority
        else:
            job_id = (await insert_or_join(self.svc, job))[0].id
        waited = 0.0
        while waited < JOB_TIMEOUT_S:
            async with self.svc.db.session() as s:
                row = await s.get(Job, job_id)
            if row is not None and row.status not in ACTIVE:
                return row
            await asyncio.sleep(POLL_S)
            waited += POLL_S
        raise TimeoutError(f"job {job_id} still running after {JOB_TIMEOUT_S}s")

    async def _insert_find(self, job: Job) -> str:
        from sqlalchemy.exc import IntegrityError

        async with self.svc.db.session() as s:
            s.add(job)
            try:
                await s.commit()
                self.svc.runner.wake()
                return job.id
            except IntegrityError:
                await s.rollback()
        async with self.svc.db.session() as s:
            return (await s.execute(select(Job.id).where(
                Job.dedupe_key == job.dedupe_key, Job.status.in_(ACTIVE)))).scalar_one()

    # --- the three passes ---------------------------------------------------

    async def warm_report(self, repo: str, stale_only: bool = False) -> None:
        skip = (not await self.report_is_outdated(repo) if stale_only
                else await self.report_is_fresh(repo))
        if skip:
            self.result.reports_fresh += 1
            return
        if stale_only and await self.from_snapshot(repo):
            return
        if self.dry_run:
            self.say(f"would analyse {repo}")
            self.result.reports_run += 1
            return
        key = repos.key(repo)
        async with self.report_slot():
            done = await self.run_job(Job(
                kind="analysis", repo=repo, repo_key=key, mode="rules", days=DAYS, params={},
                priority=BADGE_PRIORITY, dedupe_key=dedupe_key(key, "rules", DAYS)))
        if done is None:
            self.result.reports_failed += 1
            self.result.failures.append(f"{repo}: timed out")
        elif done.status == "done":
            self.result.reports_run += 1
            self.say(f"{repo}: {(done.result or {}).get('headline', 'done')}")
        else:
            self.result.reports_failed += 1
            code = (done.error or {}).get("code", "error")
            self.result.failures.append(f"{repo}: {code}")
            self.say(f"{repo}: failed ({code})")
            if code == "rate_limited":
                raise OutOfBudget("GitHub rate limit reached")

    def reuse_hours(self, repo: str) -> float:
        """How old a snapshot of `repo` may be and still stand in for a GitHub
        read: its refresh tier's age, which is how stale its report may get
        anyway, or HOLT_EVIDENCE_REUSE_HOURS if longer. 0 when that is 0."""
        s = self.svc.settings
        if s.evidence_reuse_hours <= 0:
            return 0
        tier = (s.refresh_weekly_hours if repos.key(repo) in self._weekly
                else s.refresh_monthly_hours)
        return max(s.evidence_reuse_hours, tier)

    async def from_snapshot(self, repo: str) -> bool:
        """Make `repo`'s outdated report again from its newest kept evidence,
        without GitHub. False (read GitHub instead) when there is none, it is
        older than `reuse_hours`, or older than the report it would replace
        (that one was read while evidence wasn't kept)."""
        hours = self.reuse_hours(repo)
        store = self.svc.evidence
        if not store.enabled or hours <= 0:
            return False
        latest = await self.latest_report(repo)
        snap = await asyncio.to_thread(store.newest, repo)
        if snap is None or latest is None:
            return False
        made = utc(latest.created_at)
        if snap.cutoff < now() - timedelta(hours=hours) or snap.cutoff < made - SNAPSHOT_SLACK:
            return False
        if self.dry_run:
            self.say(f"would make {repo} again from its evidence of {snap.cutoff:%Y-%m-%d}")
            self.result.reports_rederived += 1
            return True
        try:
            report = await asyncio.to_thread(evidence_store.rederive, snap, DAYS)
        except Exception:  # noqa: BLE001 -- GitHub is the way it always worked
            log.exception("making %s again from its evidence failed", repo)
            return False
        async with self.svc.db.session() as s:
            # As old as the report it replaces, never older, so it is the
            # newest and the refresh tiers still see the evidence's real age.
            s.add(Report(repo=snap.repo, repo_key=repos.key(repo), mode="rules", days=DAYS,
                         report=report, engine_version=ENGINE_VERSION,
                         created_at=max(made, snap.cutoff)))
            await s.commit()
        self.result.reports_rederived += 1
        self.say(f"{repo}: {report.get('headline', 'done')} (from evidence of "
                 f"{snap.cutoff:%Y-%m-%d})")
        return True

    async def warm_starter(self, repo: str) -> None:
        from holt_server.api import fetch_starter_issues

        if await self.starter_is_fresh(repo):
            self.result.starter_fresh += 1
            return
        if starter.module() is None or self.dry_run:
            return
        await self.check_budget()
        try:
            await fetch_starter_issues(self.svc, repo)
            self.result.starter_run += 1
        except ApiError as err:
            self.result.failures.append(f"{repo} starter issues: {err.code}")
            if err.code == "rate_limited":
                raise OutOfBudget("GitHub rate limit reached") from err

    async def warm_meta(self, seeds: list[str]) -> None:
        """Details (language, stars, topics...) of every reported repo whose
        copy is missing or a day old, a hundred per query."""
        from holt_server import discover

        stale = await discover.stale_meta(self.svc, seeds)
        batches = discover.batches(stale)
        if self.dry_run:
            if stale:
                self.say(f"would read details of {len(stale)} repos in {len(batches)} "
                         f"quer{'y' if len(batches) == 1 else 'ies'}")
            return
        for batch in batches:
            await self.check_budget()
            before = getattr(self.svc.lookup, "points_used", 0)
            try:
                details = await self.svc.lookup.details(batch)
            except ApiError as err:
                self.result.failures.append(f"repo details: {err.code}")
                if err.code == "rate_limited":
                    raise OutOfBudget("GitHub rate limit reached") from err
                return
            finally:
                self.result.meta_points += (
                    getattr(self.svc.lookup, "points_used", 0) - before)
            self.result.meta_run += await discover.store_meta(self.svc, details)

    async def warm_find(self, profile: Profile) -> None:
        if await self.find_is_fresh(profile):
            self.result.finds_fresh += 1
            return
        label = ", ".join(profile.languages) or "all languages"
        label += " (Hacktoberfest)" if profile.hacktoberfest else ""
        if self.dry_run:
            self.say(f"would search {label}")
            self.result.finds_run += 1
            return
        if starter.module() is None:
            return
        await self.check_budget()
        params = {"languages": list(profile.languages), "topics": [],
                  "hacktoberfest": profile.hacktoberfest, "days": profile.days,
                  "limit": FIND_LIMIT}
        done = await self.run_job(Job(
            kind="find", mode="rules", days=profile.days, params=params,
            priority=BADGE_PRIORITY, dedupe_key=f"find:{profile.key}"))
        if done is None:
            self.result.failures.append(f"find {label}: timed out")
        elif done.status == "done":
            self.result.finds_run += 1
            self.say(f"find {label}: {len((done.result or {}).get('results') or [])} repos")
        else:
            code = (done.error or {}).get("code", "error")
            self.result.failures.append(f"find {label}: {code}")
            if code == "rate_limited":
                raise OutOfBudget("GitHub rate limit reached")

    async def run(self, seeds: list[str], *, reports: bool = True, starter: bool = True,
                  meta: bool = True, finds: bool = True,
                  max_profiles: int | None = None, stale_only: bool = False,
                  tier: str | None = None) -> Result:
        """`stale_only`: only re-run seeds whose report an older engine made;
        `tier`: only the reports of that refresh tier, oldest first. Either
        way the other passes are skipped."""
        if stale_only or tier:
            starter = meta = finds = False
        if tier:
            seeds = await oldest_first(self.svc, await tier_repos(self.svc, tier, seeds))
            self.say(f"{tier} tier: {len(seeds)} repos")
        if stale_only:
            self._weekly = {repos.key(r) for r in await tier_repos(self.svc, "weekly", seeds)}
        if reports:
            seeds, self.result.quiet_last = await quiet_last(self.svc, seeds)
            if self.parallel > 1:
                self.say(f"{self.parallel} reports at a time")
        try:
            # Reports first: finds screen repositories through the report
            # cache, so a warm report cache makes every search cheaper.
            if reports or starter:
                await self.each_seed(seeds, lambda repo: self.warm_seed(
                    repo, reports=reports, starter=starter, stale_only=stale_only))
            if meta:
                await self.warm_meta(seeds)
            if finds:
                for profile in profiles()[:max_profiles]:
                    await self.warm_find(profile)
        except OutOfBudget as stop:
            self.result.stopped = str(stop)
            self.say(f"stopping: {stop}")
        return self.result

    async def warm_seed(self, repo: str, *, reports: bool, starter: bool,
                        stale_only: bool) -> None:
        if reports:
            await self.warm_report(repo, stale_only)
        if starter:
            await self.warm_starter(repo)

    async def each_seed(self, seeds: list[str], work) -> None:
        """`await work(repo)` for each seed, taken in order, `parallel` at a
        time. The first OutOfBudget stops new seeds; the ones under way
        finish, then it is raised."""
        todo = iter(seeds)
        stops: list[OutOfBudget] = []

        async def worker() -> None:
            for repo in todo:
                try:
                    await work(repo)
                except OutOfBudget as stop:
                    stops.append(stop)
                if stops:
                    return

        async with asyncio.TaskGroup() as group:
            for _ in range(min(self.parallel, len(seeds))):
                group.create_task(worker())
        if stops:
            raise stops[0]


async def tier_repos(svc, tier: str, seeds: list[str]) -> list[str]:
    """The repos of refresh tier `tier`: "weekly", every repo someone saved,
    viewed in the last INTEREST_DAYS, or has an open pull request on with
    alerts turned on (PR watch needs the report's timing), seed or not;
    "monthly", the seeds that aren't weekly."""
    if tier not in TIERS:
        raise ValueError(f"no refresh tier {tier!r}; one of {', '.join(TIERS)}")
    since = now() - timedelta(days=INTEREST_DAYS)
    async with svc.db.session() as s:
        rows = [*(await s.execute(select(SavedRepo.repo_key, SavedRepo.repo))).all(),
                *(await s.execute(select(RepoView.repo_key, RepoView.repo)
                                  .where(RepoView.last_viewed_at >= since))).all(),
                *(await s.execute(
                    select(Contribution.repo_key, Contribution.repo)
                    .join(AlertSettings, AlertSettings.user_id == Contribution.user_id)
                    .where(AlertSettings.enabled.is_(True), Contribution.state == "open")
                    .distinct())).all()]
    weekly: dict[str, str] = {}
    for key, repo in rows:
        weekly.setdefault(key, repo)
    if tier == "weekly":
        return list(weekly.values())
    return [r for r in seeds if repos.key(r) not in weekly]


async def oldest_first(svc, names: list[str]) -> list[str]:
    """`names` by their newest 7-day rules report, oldest first; never
    reported ones first of all, in the order given."""
    async with svc.db.session() as s:
        made = dict((await s.execute(
            select(Report.repo_key, func.max(Report.created_at))
            .where(Report.mode == "rules", Report.days == DAYS,
                   Report.repo_key.in_([repos.key(r) for r in names]))
            .group_by(Report.repo_key))).all())

    def order(item: tuple[int, str]):
        i, repo = item
        when = made.get(repos.key(repo))
        return (0, i, None) if when is None else (1, utc(when), i)

    return [repo for _, repo in sorted(enumerate(names), key=order)]


async def quiet_last(svc, names: list[str]) -> tuple[list[str], int]:
    """`names` in their order, but those that can't take outside work now at
    the back, and how many that is: the last report was decided by a
    QUIET_RULES rule (archived, pull requests closed to outsiders in GitHub's
    settings, inactive), or repo_meta says archived or no push in
    DORMANT_DAYS. Only what Holt already has; nothing is read from GitHub."""
    keys = [repos.key(r) for r in names]
    latest = (select(func.max(Report.id).label("id"))
              .where(Report.mode == "rules", Report.days == DAYS, Report.repo_key.in_(keys))
              .group_by(Report.repo_key).subquery())
    async with svc.db.session() as s:
        codes = (await s.execute(select(Report.repo_key, Report.report["rule_codes"])
                                 .join(latest, Report.id == latest.c.id))).all()
        meta = (await s.execute(select(RepoMeta.repo_key, RepoMeta.archived, RepoMeta.pushed_at)
                                .where(RepoMeta.repo_key.in_(keys)))).all()
    since = now() - timedelta(days=DORMANT_DAYS)
    quiet = {key for key, rules in codes if QUIET_RULES & set(rules or [])}
    quiet |= {key for key, archived, pushed in meta
              if archived or (pushed is not None and utc(pushed) < since)}
    front = [r for r in names if repos.key(r) not in quiet]
    return front + [r for r in names if repos.key(r) in quiet], len(names) - len(front)


async def warm_once(svc, *, seeds: list[str] | None = None, dry_run: bool = False,
                    say: Callable[[str], None] = log.info, parallel: int | None = None,
                    wait_for_budget: bool = False, **passes) -> Result | None:
    """One pass. On Postgres, only one process warms at a time (advisory lock);
    returns None if another holds it."""
    seeds = seeds if seeds is not None else load_seeds(svc.settings.warm_seeds_file or None)

    def warmer() -> Warmer:
        return Warmer(svc, say, dry_run, parallel=parallel, wait_for_budget=wait_for_budget)

    if svc.db.engine.dialect.name != "postgresql":
        return await warmer().run(seeds, **passes)
    async with svc.db.engine.connect() as conn:
        got = (await conn.execute(text("SELECT pg_try_advisory_lock(:id)"),
                                  {"id": LOCK_ID})).scalar()
        if not got:
            say("another process is warming; skipped")
            return None
        try:
            return await warmer().run(seeds, **passes)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


async def schedule(svc, first_delay_s: float = 60.0) -> None:
    """Warm every HOLT_WARM_INTERVAL_HOURS, in the API process, until cancelled."""
    hours = svc.settings.warm_interval_hours
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            result = await warm_once(svc)
            if result is not None:
                log.info("warm pass: %s", result.summary())
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- try again next time
            log.exception("warm pass failed")
        await asyncio.sleep(hours * 3600)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m holt_server.warm",
                                     description=__doc__.split("\n\n")[0])
    parser.add_argument("--seeds", help="seed list (default: the one shipped in the package)")
    parser.add_argument("--limit", type=int, help="only the first N seed repositories")
    parser.add_argument("--no-reports", action="store_true")
    parser.add_argument("--no-starter", action="store_true")
    parser.add_argument("--no-meta", action="store_true",
                        help="don't read repository details (Discover)")
    parser.add_argument("--no-find", action="store_true")
    parser.add_argument("--profiles", type=int, help="only the first N find profiles")
    parser.add_argument("--dry-run", action="store_true",
                        help="list what would run; no GitHub calls, no jobs")
    parser.add_argument("--tier", choices=TIERS,
                        help="only the reports of this refresh tier, oldest first: weekly "
                             "(saved or recently viewed repos) or monthly (the other seeds)")
    parser.add_argument("--parallel", type=int,
                        help="report jobs in flight at once (default HOLT_WARM_PARALLEL, 3)")
    parser.add_argument("--wait-for-budget", action="store_true",
                        help="when GitHub points run low, wait for them to come back "
                             "instead of stopping")
    parser.add_argument("--stale-only", action="store_true",
                        help="only re-run seeds whose report an older engine version "
                             "made, however young (after a deploy); nothing else")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from holt_server.services import Services
    from holt_server.settings import get_settings

    async def run() -> int:
        svc = Services(get_settings())
        await svc.db.migrate()
        # Reports and finds are jobs, which this process works too. Starter
        # issues and details are read directly, so a details-only pass
        # never picks up anyone's job.
        works_queue = not args.dry_run and not (args.no_reports and args.no_find)
        if works_queue:
            await svc.runner.start()
        try:
            seeds = load_seeds(args.seeds or svc.settings.warm_seeds_file or None)
            if args.limit:
                seeds = seeds[: args.limit]
            result = await warm_once(svc, seeds=seeds, dry_run=args.dry_run, say=print,
                                     reports=not args.no_reports,
                                     starter=not args.no_starter, meta=not args.no_meta,
                                     finds=not args.no_find,
                                     max_profiles=args.profiles, parallel=args.parallel,
                                     wait_for_budget=args.wait_for_budget,
                                     stale_only=args.stale_only, tier=args.tier)
            if result is None:
                return BUSY
            print(result.summary())
            for failure in result.failures:
                print(f"  failed: {failure}")
            return 0
        finally:
            if works_queue:
                await svc.runner.stop()
            svc.http.close()
            await svc.db.dispose()

    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())
