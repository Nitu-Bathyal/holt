"""The merge plan: the paid AI report for one repository.

The paid-features service (pro.py, `POST /v1/merge-plan`) writes it from this
server's latest report and starter issues and its own counts of the
repository's pull requests: rules build it, a model words the call and the
steps, and every claim is checked against its sources. The verdict is the
report's; the model never picks it, and nothing here names the model. This
module sells and keeps them:

* `GET /v1/merge-plan/{owner}/{repo}`: whether merge plans can be made here,
  and, signed in, whether this user can have one made, their latest plan for
  the repository and the job still making it.
* `POST /v1/me/merge-plan/{owner}/{repo}`: make one. The AI budget is held
  and `entitlements.charge` (feature `merge_plan`: Pro's monthly allowance, or
  the free plan's merge plans in all) pays for it in the transaction that
  queues the `merge_plan` job; a job that fails is refunded by the job runner
  (`refund_job`).
* The job writes it from the repository's AI report, which fills the plan's
  "what the AI found": a fresh one (current engine, younger than
  `HOLT_CACHE_HOURS`, made by anyone) is reused; else the job runs the AI
  report's stages itself (the verdict is still the rules') and keeps the
  report for the next plan. The plan's hold covers both (budget.py), and it
  costs one merge plan either way, never an AI report credit. If the stages
  fail the plan is written from the rules report, with no "what the AI
  found" and a note saying so; only the service failing refunds it.
* A plan is kept per user and repository, replaced by their next one. When
  the service answers with the very plan this user already has (its cache:
  nothing changed since), the job gives the charge back: asking again for
  the same plan is free. A plan cached from someone else's request still
  costs a use.

With no service configured (`HOLT_PRO_URL` empty) or AI switched off (no AI
budget) the GET says `available: false` and the web shows no merge plan.
Holt stays read-only toward GitHub: a plan's comment to post is for the
person to post, if they want.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from holt_server import api, budget, entitlements, pro, repos, schema
from holt_server.api import job_body, load_job, queued, rate_limit, sse
from holt_server.credits import get_user
from holt_server.db import (
    ACTIVE,
    ENGINE_VERSION,
    Job,
    MergePlan,
    Report,
    current_engine,
    now,
)
from holt_server.deps import Caller, caller, internal, services, signed_in
from holt_server.errors import ApiError, not_found_repo
from holt_server.github import JobStopped
from holt_server.jobs import JobTimedOut, read_repo

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from holt_server.services import Services
    from holt_server.settings import Settings

log = logging.getLogger("holt_server.merge_plan")

FEATURE = "merge_plan"
KIND = "merge_plan"
# The budget of the reports a plan is written from: the report page's.
REPORT_DAYS = 7
# Time for reading the report and starter issues, beside the stages and the service.
SLACK_S = 30.0
# The service reads at most this many starter issues (CONTRACT.md).
MAX_ISSUES = 20

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})


def available(svc: Services) -> bool:
    """Plans can be made here: the service is configured and AI is on."""
    return svc.pro is not None and svc.ai_on()


def dedupe(user_id: str, repo_key: str) -> str:
    return f"merge_plan:{user_id}:{repo_key}"[:260]


# --- what the service is sent ------------------------------------------------------------


def _clip(value: Any, limit: int) -> Any:
    return value[:limit] if isinstance(value, str) else value


def report_for_pro(report: dict[str, Any]) -> dict[str, Any]:
    """The report as `GET /v1/reports` serves it, trimmed to what the
    service accepts (it refuses longer lists and strings with a 400)."""
    out = schema.Report.model_validate(report).model_dump(mode="json")
    out["landing"] = (out.get("landing") or [])[:50]
    out["evidence"] = [
        {**e, "text": _clip(e.get("text"), 2000), "quote": _clip(e.get("quote"), 2000),
         "value": _clip(e.get("value"), 200),
         "url": e.get("url") if len(e.get("url") or "") <= 1000 else None}
        for e in (out.get("evidence") or [])[:200]
    ]
    return out


def issues_for_pro(repo: str, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The starter issues as `GET .../starter-issues` serves them, best first:
    only this repository's (the service refuses others), at most 20."""
    prefix = f"https://github.com/{repo.lower()}/issues/"
    out = []
    for raw in issues:
        try:
            issue = schema.StarterIssue.model_validate(raw).model_dump(mode="json")
        except ValidationError:
            continue
        if str(issue.get("url") or "").lower().startswith(prefix):
            issue["title"] = _clip(issue.get("title"), 500)
            issue["labels"] = (issue.get("labels") or [])[:30]
            issue["why"] = (issue.get("why") or [])[:12]
            out.append(issue)
    return out[:MAX_ISSUES]


async def latest_ai_report(svc: Services, repo: str, *, fresh: bool = False
                           ) -> dict[str, Any] | None:
    """The newest AI report for `repo` from the current engine, made for
    anyone and any budget. `fresh`: only one younger than the report cache
    (`HOLT_CACHE_HOURS`), the age at which the report page reads GitHub again."""
    query = select(Report.report).where(Report.repo_key == repos.key(repo),
                                        Report.mode == "ai", current_engine())
    if fresh:
        query = query.where(
            Report.created_at >= now() - timedelta(hours=svc.settings.cache_hours))
    async with svc.db.session() as s:
        return (await s.execute(
            query.order_by(Report.created_at.desc(), Report.id.desc()).limit(1)
        )).scalar_one_or_none()


async def rules_report(svc: Services, repo: str) -> dict[str, Any] | None:
    """The rules report the report page shows."""
    rules = await api.latest_report(svc, repo, "rules", REPORT_DAYS)
    return rules.report if rules is not None else None


async def base_report(svc: Services, repo: str) -> dict[str, Any] | None:
    """A report a plan can be written from: the newest AI report, else the
    rules report the report page shows. None when there is neither."""
    if (ai := await latest_ai_report(svc, repo)) is not None:
        return ai
    return await rules_report(svc, repo)


async def starter_issues(svc: Services, repo: str) -> list[dict[str, Any]]:
    """The starter issues the report page shows. A plan can be written
    without them, so a failure to read them gives none."""
    if (hit := await api.cached_starter_issues(svc, repo)) is not None:
        return list(hit.issues)
    try:
        _, issues = await api.fetch_starter_issues(svc, repo)
    except Exception:  # noqa: BLE001 -- GitHub, or starter issues unavailable here
        log.warning("merge plan for %s: no starter issues", repo, exc_info=True)
        return []
    return issues


# --- the service's answer ----------------------------------------------------------------


def from_pro(body: dict[str, Any]) -> dict[str, Any]:
    """The public shape (`schema.MergePlan`) of the service's answer. Its
    extra fields (`version`, `cached`, `archived`, `usage`, sources'
    `fact_id`, any model id) are left behind."""
    # Checked here, once, so what is kept only ever holds what the schema promises.
    return schema.MergePlan.model_validate(body).model_dump(mode="json")


def pro_failure(err: pro.ProError, repo: str) -> ApiError:
    """What a person reads when the service couldn't write the plan. Every
    failure is refunded, so each message says so."""
    back = " It didn't count against your merge plans."
    if err.pro_code == "not_found":
        return not_found_repo(repo)
    if err.code == "internal":  # the service refused the request: a bug here
        return ApiError("internal", "Something went wrong on our side, so the merge plan "
                        "couldn't be made. Please try again in a minute." + back)
    if err.pro_code == "upstream":
        return ApiError("upstream", "GitHub or the AI didn't answer properly, so the merge "
                        "plan couldn't be made. Please try again later." + back)
    return ApiError("upstream", "Merge plans are unavailable right now. Please try again "
                    "later." + back)


# The engine's stages, as a merge plan's progress says them.
STAGES = {
    "Fetching pull requests": "Reading the recent pull requests",
    "Counting replies and merges": "Counting replies and merges",
    "Reading threads": "Reading the pull request threads",
    "Checking evidence": "Checking what the AI found",
    "Writing the report": "Checking what the AI found",
}
# The share of the progress bar the stages fill, after the first step.
STAGES_FROM, STAGES_TO = 0.1, 0.7
WRITING = "Reading a year of merged and closed pull requests"
# Added to the plan's note when the AI stages failed.
NO_AI = "The AI couldn't read the pull request threads this time, so “What the AI found” is missing."


def time_limit(settings: Settings) -> float:
    """The job's limit: the AI stages' (`HOLT_JOB_TIMEOUT_AI`), then the
    service's read timeout, and a little for reading the report and issues."""
    return settings.job_timeout_ai + pro.MERGE_PLAN_TIMEOUT_S + SLACK_S


@dataclass
class Stages:
    """What the AI stages gave: the report (None when they failed) and what
    they spent (their whole cap when that isn't known)."""

    report: dict[str, Any] | None = None
    usd: float = 0.0
    model: str | None = None


async def ai_stages(svc: Services, job: Job, emit) -> Stages:
    """Run an AI report's stages on the repository, as an AI report does
    (the verdict is still the rules'), keep the report for anyone's next
    plan, and say what they cost. Never raises: a plan is made without them."""
    cap = budget.run_max_usd(svc.settings, budget.ANALYSIS)
    try:
        spec = await svc.model_spec_for(job)
        model = budget.Capped(svc.model_factory(spec), spec.model, cap)
    except Exception as exc:  # noqa: BLE001 -- no server model here: a plan without them
        log.warning("merge plan for %s: the AI stages can't run here: %s", job.repo,
                    getattr(exc, "code", type(exc).__name__))
        return Stages()
    stop = threading.Event()

    def progress(stage: str, value: float) -> None:
        if stop.is_set():  # they timed out: the service's step is showing
            raise JobStopped
        emit(STAGES.get(stage, stage), STAGES_FROM + (STAGES_TO - STAGES_FROM) * value)

    def spent() -> tuple[float, str | None]:
        usage = getattr(model.inner, "usage", None)
        used = ", ".join(getattr(usage, "models", None) or []) or spec.model
        return float(getattr(usage, "cost_usd", 0.0) or 0.0), used

    try:
        report, evidence = await svc.runner.in_thread(
            stop, svc.settings.job_timeout_ai, read_repo, svc, job.repo, "ai", REPORT_DAYS,
            model, progress)
    except asyncio.CancelledError:  # the whole job timed out
        stop.set()
        raise
    except JobTimedOut:
        # Still running until its next stop check: count all it may spend.
        log.warning("merge plan for %s: the AI stages took too long", job.repo)
        return Stages(usd=cap, model=spec.model)
    except Exception as exc:  # noqa: BLE001 -- a plan is made without them
        log.warning("merge plan for %s: the AI stages failed: %s", job.repo,
                    getattr(exc, "code", type(exc).__name__))
        return Stages(None, *spent())
    usd, used = spent()
    async with svc.db.session() as s:
        s.add(Report(repo=job.repo, repo_key=job.repo_key, mode="ai", days=REPORT_DAYS,
                     report=report, engine_version=ENGINE_VERSION))
        await s.commit()
    if evidence.records:
        await svc.runner.keep_evidence(job.repo, evidence)
    return Stages(report, usd, used)


async def run(svc: Services, job: Job, emit) -> dict[str, Any]:
    """The job: the repository's AI report (a fresh one, anyone's, or made
    here by the AI stages), else its rules report, and the starter issues,
    sent to the service for the plan (the job runner times it)."""
    client = svc.require_pro()
    emit("Reading the report and starter issues", 0.05)
    stages = Stages()
    report = await latest_ai_report(svc, job.repo, fresh=True)
    if report is None and await base_report(svc, job.repo) is not None:
        stages = await ai_stages(svc, job, emit)
        report = stages.report
        if stages.model:
            svc.ai_models[job.id] = stages.model
    no_ai = report is None
    if no_ai:
        report = await rules_report(svc, job.repo) or await latest_ai_report(svc, job.repo)
    if report is None:
        svc.ai_costs[job.id] = 0.0
        raise ApiError("not_found", f"There's no report for {job.repo} yet. Check the "
                       "repository first. It didn't count against your merge plans.")
    issues = issues_for_pro(job.repo, await starter_issues(svc, job.repo))
    emit(WRITING, STAGES_TO if stages.model else STAGES_FROM)
    try:
        body = await client.merge_plan(job.repo, report_for_pro(report), issues, job.days,
                                       user_id=job.user_id, request_id=job.id)
    except pro.ProError as err:
        budget.note_pro_error(svc, job.id, err, stages.usd)
        raise pro_failure(err, job.repo) from None
    budget.note_pro(svc, job.id, body, stages.usd)
    try:
        plan = from_pro(body)
    except ValidationError:
        log.exception("holt-pro sent a merge plan for %s that doesn't fit the schema", job.repo)
        raise pro_failure(pro.ProError("internal", "upstream", ""), job.repo) from None
    if no_ai and plan.get("ai") is None:
        plan["note"] = f"{plan['note']} {NO_AI}" if plan.get("note") else NO_AI
    return plan


async def mine(s: AsyncSession, user_id: str, repo_key: str) -> MergePlan | None:
    return await s.get(MergePlan, (user_id, repo_key))


async def store(s: AsyncSession, job: Job, result: dict[str, Any]) -> None:
    """Keep a finished plan as this user's latest for the repository, in the
    job's finishing transaction. The same plan they already had (the
    service's cache: nothing changed) gives back what the job was charged."""
    if not job.user_id:
        return
    row = await mine(s, job.user_id, job.repo_key)
    same = row is not None and row.plan.get("generated_at") == result.get("generated_at")
    if row is None:
        s.add(MergePlan(user_id=job.user_id, repo_key=job.repo_key, repo=job.repo,
                        plan=result, job_id=job.id))
    else:
        row.repo, row.plan, row.job_id, row.created_at = job.repo, result, job.id, now()
    params = job.params or {}
    if same and job.charged and "charge" in params:
        await entitlements.refund(s, job.user_id, params["charge"], job.id)
        # So a later `refund_job` (there shouldn't be one) can't give it back twice.
        await s.execute(update(Job).where(Job.id == job.id).values(charged=False))


# --- reads -------------------------------------------------------------------------------


async def active(svc: Services, key: str) -> Job | None:
    async with svc.db.session() as s:
        return (await s.execute(select(Job).where(
            Job.dedupe_key == key, Job.status.in_(ACTIVE)).limit(1))).scalar_one_or_none()


async def job_state(svc: Services, job: Job) -> schema.MergePlanJob:
    stage = await svc.runner.stage_event(job)
    return schema.MergePlanJob(job_id=job.id, status=job.status, stage=stage["stage"],
                               progress=stage["progress"])


@router.get("/merge-plan/{owner}/{repo}")
async def get_merge_plan(owner: str, repo: str, request: Request,
                         who: Caller = Depends(caller)) -> schema.MergePlanState:
    svc = services(request)
    name = repos.normalize(f"{owner}/{repo}")
    key = repos.key(name)
    access = plan = job = None
    if who.user_id:
        await get_user(svc, who.user_id)
        async with svc.db.session() as s:
            row = await mine(s, who.user_id, key)
        if row is not None:  # a paid result: shown even while new ones can't be made
            name, plan = row.repo, schema.MergePlan.model_validate(row.plan)
        if available(svc):
            access = schema.Access(
                **(await entitlements.check(svc, who.user_id, FEATURE)).__dict__)
            if (running := await active(svc, dedupe(who.user_id, key))) is not None:
                job = await job_state(svc, running)
    return schema.MergePlanState(repo=name, available=available(svc), access=access,
                                 plan=plan, job=job)


# --- making one --------------------------------------------------------------------------


@router.post("/me/merge-plan/{owner}/{repo}", status_code=202, response_model=schema.Queued)
async def start_merge_plan(owner: str, repo: str, request: Request,
                           who: Caller = Depends(caller)) -> JSONResponse:
    svc = services(request)
    user_id = signed_in(who)
    svc.require_pro()
    if not svc.ai_on():
        raise budget.switched_off()
    name = repos.normalize(f"{owner}/{repo}")
    key = repos.key(name)
    await get_user(svc, user_id)

    dkey = dedupe(user_id, key)
    if (running := await active(svc, dkey)) is not None:
        return queued(running.id)  # already making it: no second charge

    rate_limit(svc, who)
    canonical = await svc.canonical(name)  # an unknown repository costs nothing
    if await base_report(svc, canonical) is None:
        raise ApiError("not_found", f"There's no report for {canonical} yet. "
                       "Check the repository first.")
    job = Job(kind=KIND, repo=canonical, repo_key=key, mode="ai", days=pro.MERGE_PLAN_DAYS,
              params={}, user_id=user_id, charged=True, dedupe_key=dkey)
    async with svc.db.session() as s:
        try:
            s.add(job)
            await s.flush()
            # Before the charge: a plan the AI budget can't cover costs nothing.
            await budget.reserve(s, svc.settings, job.id, budget.MERGE_PLAN)
            paid = await entitlements.charge(s, svc, user_id, FEATURE, job_id=job.id)
            job.params = {"charge": paid}
            await s.commit()
        except IntegrityError:  # a second click raced this one: wait on the first
            await s.rollback()
            if (running := await active(svc, dkey)) is None:
                raise ApiError("internal", "Something went wrong on our side. "
                               "Please try again in a minute.") from None
            return queued(running.id)
    svc.runner.wake()
    return queued(job.id)


# --- following a job ---------------------------------------------------------------------


@router.get("/merge-plan-jobs/{job_id}", dependencies=[Depends(internal)])
async def get_merge_plan_job(job_id: str, request: Request) -> schema.MergePlanJobStatus:
    return schema.MergePlanJobStatus.model_validate(
        job_body(await load_job(services(request), job_id, KIND)))


@router.get("/merge-plan-jobs/{job_id}/events", dependencies=[Depends(internal)])
async def merge_plan_job_events(job_id: str, request: Request) -> StreamingResponse:
    svc = services(request)
    await load_job(svc, job_id, KIND)
    return sse(svc, job_id, KIND, request)
