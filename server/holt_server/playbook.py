"""The paid "How to get merged here" playbook for a repository.

The paid-features service (pro.py, `POST /v1/playbook`) writes it from counted
facts about the repository's recent pull requests and checks every claim
against them; this module sells it:

* `GET /v1/playbook/{owner}/{repo}`: anyone gets the teaser (which sections
  the playbook has, and its first must-do) once one has been written; a user
  who unlocked the repository gets the whole playbook.
* `POST /v1/me/playbook/{owner}/{repo}`: unlock it. `entitlements.charge`
  (feature `playbook`) pays for it in the same transaction that records the
  unlock. A fresh playbook in the cache is served at once; otherwise a
  `playbook` job asks the service for one. Several people unlocking the same
  repository share one job.
* If that job fails, every unlock waiting on it is deleted and its charge
  given back (`refund_unlocks`), in the transaction that marks the job failed.

Unlocks are per user and repository and don't expire: a user who unlocked a
repository gets newer playbooks for it free. With no service configured
(`HOLT_PRO_URL` empty) the GET says `available: false` and the web hides the
section. The playbook has no verdict; Holt stays read-only toward GitHub.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from holt_server import budget, entitlements, pro, repos, schema
from holt_server.api import job_body, load_job, rate_limit, sse
from holt_server.credits import get_user
from holt_server.db import ACTIVE, Job, Playbook, PlaybookUnlock, iso, now, utc
from holt_server.deps import Caller, caller, internal, services, signed_in
from holt_server.errors import ApiError, not_found_repo

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from holt_server.services import Services

log = logging.getLogger("holt_server.playbook")

FEATURE = "playbook"
KIND = "playbook"
SECTIONS = ("must_do", "size_and_scope", "reviewers", "closing_reasons", "checklist")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})


def dedupe(repo_key: str) -> str:
    return f"playbook:{repo_key}"


# --- the service's answer -------------------------------------------------------------


def _items(raw: Any) -> list[dict[str, Any]]:
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not str(item.get("text") or "").strip():
            continue
        sources = [
            {"statement": str(src.get("statement") or ""), "seen": src.get("seen"),
             "of": src.get("of"), "links": [str(u) for u in src.get("links") or []][:8]}
            for src in item.get("sources") or [] if isinstance(src, dict)
        ]
        out.append({"text": str(item["text"]), "sources": sources})
    return out


def from_pro(repo: str, body: dict[str, Any]) -> dict[str, Any]:
    """The public shape (`schema.Playbook`) of the service's answer. Its
    internal fields (fact ids, the evidence's own counts) are left behind."""
    sections = body.get("sections") or {}
    reasons = [r for r in sections.get("closing_reasons") or []
               if isinstance(r, dict) and r.get("reason")]
    window = (body.get("evidence") or {}).get("window") or {}
    out = {
        "repo": str(body.get("repo") or repo),
        "generated_at": str(body.get("generated_at") or iso(now())),
        "note": body.get("note"),
        "window_days": window.get("days"),
        "archived": bool(body.get("archived")),
        "sections": {
            "must_do": _items(sections.get("must_do")),
            "size_and_scope": _items(sections.get("size_and_scope")),
            "reviewers": _items(sections.get("reviewers")),
            "closing_reasons": [
                {"reason": r["reason"], "explanation": r.get("explanation") or "",
                 "seen": r.get("seen"), "of": r.get("of"),
                 "examples": [e for e in r.get("examples") or [] if isinstance(e, dict)][:5]}
                for r in reasons
            ],
            "checklist": _items(sections.get("checklist")),
        },
    }
    # Checked here, once, so the cache only ever holds what the schema promises.
    return schema.Playbook.model_validate(out).model_dump(mode="json")


def teaser(playbook: dict[str, Any]) -> schema.PlaybookTeaser:
    sections = playbook.get("sections") or {}
    must = sections.get("must_do") or []
    return schema.PlaybookTeaser(
        sections=[{"key": k, "count": len(sections.get(k) or [])} for k in SECTIONS
                  if sections.get(k)],
        first=must[0] if must else None,
        generated_at=playbook.get("generated_at") or "",
    )


def pro_failure(err: pro.ProError, repo: str) -> ApiError:
    """What a person reads when the service couldn't write the playbook.
    Every failure is refunded, so each message says so."""
    back = " You weren't charged for it."
    if err.pro_code == "not_found":
        return not_found_repo(repo)
    if err.pro_code == "upstream":
        return ApiError("upstream", "GitHub or the writing model didn't answer properly, so "
                        "the playbook couldn't be written. Please try again later." + back)
    return ApiError("upstream", "Playbooks are unavailable right now. Please try again "
                    "later." + back)


async def write(svc: Services, job: Job, emit) -> dict[str, Any]:
    """The job: ask the service for the playbook (the job runner times it)."""
    client = svc.require_pro()
    emit("Reading the project's pull requests and reviews", 0.1)
    try:
        body = await client.playbook(job.repo, job.days, user_id=job.user_id,
                                     request_id=job.id)
    except pro.ProError as err:
        raise pro_failure(err, job.repo) from None
    budget.note_pro(svc, job.id, body)
    try:
        return from_pro(job.repo, body)
    except ValidationError:
        log.exception("holt-pro sent a playbook for %s that doesn't fit the schema", job.repo)
        raise pro_failure(pro.ProError("internal", "upstream", ""), job.repo) from None


async def store(s: AsyncSession, job: Job, result: dict[str, Any]) -> None:
    """Keep a finished playbook as the repository's latest, in the job's
    finishing transaction."""
    row = await s.get(Playbook, job.repo_key)
    if row is None:
        s.add(Playbook(repo_key=job.repo_key, repo=job.repo, playbook=result))
    else:
        row.repo, row.playbook, row.created_at = job.repo, result, now()


async def refund_unlocks(s: AsyncSession, job_id: str) -> int:
    """Delete the unlocks that were waiting on a failed job and give back
    what each was charged. Safe to call twice: a row is refunded only by the
    call that deletes it."""
    rows = (await s.execute(select(PlaybookUnlock).where(
        PlaybookUnlock.job_id == job_id))).scalars().all()
    given = 0
    for row in rows:
        gone = await s.execute(delete(PlaybookUnlock).where(
            PlaybookUnlock.user_id == row.user_id, PlaybookUnlock.repo_key == row.repo_key,
            PlaybookUnlock.job_id == job_id))
        if gone.rowcount == 1:
            await entitlements.refund(s, row.user_id, row.paid or {}, job_id)
            given += 1
    return given


# --- reads -----------------------------------------------------------------------------


async def cached(svc: Services, key: str) -> Playbook | None:
    async with svc.db.session() as s:
        return await s.get(Playbook, key)


def is_fresh(svc: Services, row: Playbook) -> bool:
    return now() - utc(row.created_at) < timedelta(hours=svc.settings.playbook_cache_hours)


async def unlock_of(svc: Services, user_id: str, key: str) -> PlaybookUnlock | None:
    async with svc.db.session() as s:
        return await s.get(PlaybookUnlock, (user_id, key))


async def active(svc: Services, key: str) -> Job | None:
    async with svc.db.session() as s:
        return (await s.execute(select(Job).where(
            Job.dedupe_key == dedupe(key), Job.status.in_(ACTIVE)).limit(1))).scalar_one_or_none()


def on_sale(svc: Services) -> bool:
    cat = entitlements.catalogue(svc)
    spec = cat.features[FEATURE]
    plan = any(p.on_sale and FEATURE in p.features for p in cat.plans.values())
    pack = spec.credits is not None and any(p.on_sale for p in cat.packs.values())
    return plan or pack


@router.get("/playbook/{owner}/{repo}")
async def get_playbook(owner: str, repo: str, request: Request,
                       who: Caller = Depends(caller)) -> schema.PlaybookState:
    svc = services(request)
    name = repos.normalize(f"{owner}/{repo}")
    key = repos.key(name)
    if svc.pro is None:
        return schema.PlaybookState(repo=name, available=False, teaser=None, playbook=None,
                                    unlocked=False, access=None, on_sale=False, job=None)
    row = await cached(svc, key)
    unlocked, access, job = False, None, None
    if who.user_id:
        await get_user(svc, who.user_id)
        unlock = await unlock_of(svc, who.user_id, key)
        unlocked = unlock is not None
        access = schema.Access(**(await entitlements.check(svc, who.user_id, FEATURE)).__dict__)
        running = await active(svc, key) if unlocked else None
        if running is not None:
            job = await job_state(svc, running)
    return schema.PlaybookState(
        repo=row.repo if row else name, available=True,
        teaser=teaser(row.playbook) if row else None,
        playbook=schema.Playbook.model_validate(row.playbook) if row and unlocked else None,
        unlocked=unlocked, access=access, on_sale=on_sale(svc), job=job)


async def job_state(svc: Services, job: Job) -> schema.PlaybookJob:
    stage = await svc.runner.stage_event(job)
    return schema.PlaybookJob(job_id=job.id, status=job.status, stage=stage["stage"],
                              progress=stage["progress"])


# --- unlocking ---------------------------------------------------------------------------


def done(playbook: dict[str, Any]) -> JSONResponse:
    return JSONResponse(schema.PlaybookDone(
        playbook=schema.Playbook.model_validate(playbook)).model_dump(mode="json"))


def queued(job_id: str) -> JSONResponse:
    return JSONResponse({"status": "queued", "job_id": job_id}, status_code=202)


async def _pay(s: AsyncSession, svc: Services, user_id: str, key: str,
               job_id: str | None) -> None:
    paid = await entitlements.charge(s, svc, user_id, FEATURE, job_id=job_id)
    s.add(PlaybookUnlock(user_id=user_id, repo_key=key, paid=paid, job_id=job_id))


async def _join(svc: Services, user_id: str, key: str, job: Job, unlocked: bool) -> JSONResponse:
    """Wait on a job already writing this repository's playbook, paying for
    it first unless already unlocked."""
    if not unlocked:
        async with svc.db.session() as s:
            await _pay(s, svc, user_id, key, job.id)
            await s.commit()
        # It may have failed between reading it and paying; its refunds ran
        # before this unlock existed, so give this one back now.
        async with svc.db.session() as s:
            status = (await s.execute(select(Job.status).where(Job.id == job.id))).scalar()
            if status == "error":
                await refund_unlocks(s, job.id)
                await s.commit()
    return queued(job.id)


@router.post("/me/playbook/{owner}/{repo}", response_model=schema.PlaybookDone,
             responses={202: {"model": schema.Queued}})
async def unlock_playbook(owner: str, repo: str, request: Request,
                          who: Caller = Depends(caller)) -> JSONResponse:
    svc = services(request)
    user_id = signed_in(who)
    svc.require_pro()
    name = repos.normalize(f"{owner}/{repo}")
    key = repos.key(name)
    await get_user(svc, user_id)
    unlocked = await unlock_of(svc, user_id, key) is not None

    row = await cached(svc, key)
    if row is not None and is_fresh(svc, row):
        if not unlocked:
            async with svc.db.session() as s:
                try:
                    await _pay(s, svc, user_id, key, None)
                    await s.commit()
                except IntegrityError:  # a second click raced this one: paid once
                    await s.rollback()
        return done(row.playbook)

    if (running := await active(svc, key)) is not None:
        return await _join(svc, user_id, key, running, unlocked)

    rate_limit(svc, who)
    canonical = await svc.canonical(name)
    job = Job(kind=KIND, repo=canonical, repo_key=key, mode="ai", days=pro.PLAYBOOK_DAYS,
              params={}, user_id=user_id, dedupe_key=dedupe(key))
    async with svc.db.session() as s:
        try:
            s.add(job)
            await s.flush()
            # Before the charge: a playbook the AI budget can't cover costs nothing.
            await budget.reserve(s, svc.settings, job.id, budget.PLAYBOOK)
            if not unlocked:
                await _pay(s, svc, user_id, key, job.id)
            await s.commit()
        except IntegrityError:  # someone started one a moment ago: wait on theirs
            await s.rollback()
            if (running := await active(svc, key)) is None:
                raise ApiError("internal", "Something went wrong on our side. "
                               "Please try again in a minute.") from None
            return await _join(svc, user_id, key, running, unlocked)
    svc.runner.wake()
    return queued(job.id)


# --- following a job ------------------------------------------------------------------------


@router.get("/playbook-jobs/{job_id}", dependencies=[Depends(internal)])
async def get_playbook_job(job_id: str, request: Request) -> schema.PlaybookJobStatus:
    return schema.PlaybookJobStatus.model_validate(
        job_body(await load_job(services(request), job_id, KIND)))


@router.get("/playbook-jobs/{job_id}/events", dependencies=[Depends(internal)])
async def playbook_job_events(job_id: str, request: Request) -> StreamingResponse:
    svc = services(request)
    await load_job(svc, job_id, KIND)
    return sse(svc, job_id, KIND, request)
