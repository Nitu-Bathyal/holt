"""PR pre-flight: one public pull request (or a branch not opened as one yet)
compared with what gets merged in its repository.

The paid-features service (pro.py, `POST /v1/preflight`) reads the pull
request and runs the checks; each check's verdict (looks fine / worth fixing /
can't tell yet) is computed there by rules. This module sells and keeps them:

* `GET /v1/preflight`: whether pre-flight is on, and what a check would cost
  this user. Given a pull request or branch, also this user's latest result
  for it and the job still checking it.
* `POST /v1/me/preflight`: check one. `entitlements.charge` (feature
  `preflight`) pays for it in the transaction that queues the `preflight`
  job; a job that fails is refunded by the job runner (`refund_job`).
* Results are kept per user, target and **head commit**. Checking a commit
  the user already had checked again (to see a finished CI run, say) is free:
  the job gives the charge back when it finishes.

With no service configured (`HOLT_PRO_URL` empty) the GET says
`available: false` and the web hides pre-flight. Guidance only: Holt never
posts to GitHub and never writes code.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from holt_server import budget, entitlements, pro, repos, schema
from holt_server.api import job_body, load_job, queued, rate_limit, sse
from holt_server.credits import get_user
from holt_server.db import ACTIVE, Job, Preflight, iso, now
from holt_server.deps import Caller, caller, internal, services, signed_in
from holt_server.errors import ApiError

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from holt_server.services import Services

log = logging.getLogger("holt_server.preflight")

FEATURE = "preflight"
KIND = "preflight"
VERDICTS = ("ok", "worth_fixing", "unknown")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})


# --- what to check ------------------------------------------------------------------


class PreflightIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # A pull request link (https://github.com/o/r/pull/12) or `o/r#12`.
    pr_url: str | None = Field(None, max_length=500)
    # Or a repository and a branch in it (`owner:branch` for one in a fork).
    repo: str | None = Field(None, max_length=500)
    branch: str | None = Field(None, max_length=250)
    # What to compare the branch with; the default branch when left out.
    base: str | None = Field(None, max_length=250)
    # Also have a model write a short summary of the checks (checked like the playbook).
    summary: bool = False


PR_LINK = re.compile(r"^/([^/]+/[^/]+)/pulls?/(\d{1,9})(?:[/?#].*)?$")
PR_SHORT = re.compile(r"^([A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100})#(\d{1,9})$")
# Git allows more, but nothing a person would type into this box.
BRANCH = re.compile(r"^(?:[A-Za-z0-9-]{1,39}:)?[A-Za-z0-9._/+-]{1,200}$")
BAD_BRANCH = "That doesn't look like a branch name. Use `my-branch`, or `your-name:my-branch` for one in your fork."
BAD_PR = ("That doesn't look like a pull request link. Paste one like "
          "https://github.com/owner/repo/pull/123, or pick a repository and a branch.")


class Target:
    """A parsed pull request or branch: `repo` as typed (normalised),
    `key` the per-repository cache identity, `body` what the service takes."""

    def __init__(self, repo: str, *, number: int | None = None, branch: str | None = None,
                 base: str | None = None) -> None:
        self.repo, self.number, self.branch, self.base = repo, number, branch, base

    @property
    def repo_key(self) -> str:
        return repos.key(self.repo)

    @property
    def key(self) -> str:
        """Unique per repository: `pr:12`, or `branch:me:fix` (`...main` with a base)."""
        if self.number is not None:
            return f"pr:{self.number}"
        return f"branch:{self.branch}" + (f"...{self.base}" if self.base else "")

    def body(self, repo: str) -> dict[str, str]:
        if self.number is not None:
            return {"pr": f"{repo}#{self.number}"}
        out = {"repo": repo, "branch": self.branch or ""}
        if self.base:
            out["base"] = self.base
        return out

    def public(self) -> schema.PreflightFor:
        return schema.PreflightFor(repo=self.repo, number=self.number, branch=self.branch,
                                   base=self.base)


def parse_pr(raw: str) -> Target:
    text = raw.strip()
    if m := PR_SHORT.match(text):
        return Target(repos.normalize(m.group(1)), number=int(m.group(2)))
    if "://" not in text:
        text = "https://" + text
    parts = urlsplit(text)
    host = (parts.hostname or "").lower().removeprefix("www.")
    m = PR_LINK.match(parts.path)
    if host not in ("github.com", "githolt.com") or m is None or int(m.group(2)) < 1:
        raise ApiError("invalid_request", BAD_PR)
    return Target(repos.normalize(m.group(1)), number=int(m.group(2)))


def branch_name(raw: str, *, fork: bool) -> str:
    b = raw.strip()
    ok = (BRANCH.match(b) is not None and ".." not in b and not b.endswith((".", "/", ".lock"))
          and not b.split(":")[-1].startswith(("-", "/", ".")) and (fork or ":" not in b))
    if not ok:
        raise ApiError("invalid_request", BAD_BRANCH)
    return b


def parse(pr_url: str | None, repo: str | None, branch: str | None,
          base: str | None) -> Target:
    pr_url, repo, branch, base = (x.strip() if x else None for x in (pr_url, repo, branch, base))
    if pr_url and (repo or branch):
        raise ApiError("invalid_request", "Paste a pull request link, or pick a repository "
                       "and a branch, not both.")
    if pr_url:
        return parse_pr(pr_url)
    if not (repo and branch):
        raise ApiError("invalid_request", "Paste a pull request link, or pick a repository "
                       "and a branch.")
    return Target(repos.normalize(repo), branch=branch_name(branch, fork=True),
                  base=branch_name(base, fork=False) if base else None)


# --- the service's answer -----------------------------------------------------------------


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _links(raw: Any) -> list[str]:
    return [str(u) for u in raw or [] if isinstance(u, str)][:8]


def _check(c: dict[str, Any]) -> dict[str, Any]:
    quote = c.get("quote") if isinstance(c.get("quote"), dict) else None
    verdict = c.get("verdict")
    return {
        "id": str(c.get("id") or ""),
        "title": str(c.get("title") or c.get("id") or ""),
        # A verdict this server doesn't know yet reads as "can't tell".
        "verdict": verdict if verdict in VERDICTS else "unknown",
        "statement": str(c.get("statement") or ""),
        "links": _links(c.get("links")),
        "quote": {"text": str(quote.get("text") or ""), "path": quote.get("path"),
                  "url": quote.get("url")} if quote and quote.get("text") else None,
    }


def from_pro(repo: str, body: dict[str, Any]) -> dict[str, Any]:
    """The public shape (`schema.Preflight`) of the service's answer. Its
    internal fields (fact ids, raw check data, rule versions) stay behind."""
    t = body.get("target")
    if not isinstance(t, dict) or not t.get("url") or not isinstance(body.get("checks"), list):
        raise ValueError("no target or checks")
    checks = [_check(c) for c in body.get("checks") or [] if isinstance(c, dict) and c.get("id")]
    similar = body.get("similar") if isinstance(body.get("similar"), dict) else None
    summary = body.get("summary") if isinstance(body.get("summary"), dict) else None
    window = (body.get("evidence") or {}).get("window") or {}
    out = {
        "repo": str(body.get("repo") or repo),
        "checked_at": str(body.get("checked_at") or iso(now())),
        "window_days": _int(window.get("days")),
        "archived": bool(body.get("archived")),
        "note": body.get("note") or None,
        "target": {
            "kind": "branch" if t.get("kind") == "branch" else "pull_request",
            "number": t.get("number"), "url": str(t["url"]),
            "title": t.get("title"), "author": t.get("author"), "outside": t.get("outside"),
            "state": t.get("state"), "draft": bool(t.get("draft")),
            "head": t.get("head"), "base": t.get("base"),
            "head_sha": str(t.get("head_sha") or ""),
            "additions": t.get("additions"), "deletions": t.get("deletions"),
            "lines": t.get("lines"), "files": t.get("files"),
        },
        "checks": checks,
        # Counted here from the checks shown, so the two can't disagree.
        "counts": {v: sum(c["verdict"] == v for c in checks) for v in VERDICTS},
        "similar": {
            "number": similar.get("number"), "url": str(similar["url"]),
            "title": str(similar.get("title") or ""), "author": similar.get("author"),
            "outside": bool(similar.get("outside")), "lines": similar.get("lines"),
            "files": similar.get("files"), "touched_tests": similar.get("touched_tests"),
            "why": str(similar.get("why") or ""),
        } if similar and similar.get("url") else None,
        "summary": {
            "model": summary.get("model"),
            "sentences": [{"text": str(x.get("text")), "checks": [str(i) for i in x.get("checks") or []]}
                          for x in summary.get("sentences") or []
                          if isinstance(x, dict) and x.get("text")][:3],
        } if summary else None,
        "free_recheck": False,
    }
    # Checked here, once, so stored results only ever hold what the schema promises.
    return schema.Preflight.model_validate(out).model_dump(mode="json")


def pro_failure(err: pro.ProError, repo: str) -> ApiError:
    """What a person reads when the check couldn't run. Every failure is
    refunded, so each message says so."""
    back = " You weren't charged for it."
    if err.pro_code == "not_found":
        return ApiError("not_found", "We couldn't find that pull request or branch on GitHub. "
                        f"Check the link: {repo} must be public, and a branch needs at least "
                        "one commit its base doesn't have." + back)
    if err.pro_code == "upstream":
        return ApiError("upstream", "GitHub didn't answer properly, so the check couldn't "
                        "run. Please try again in a few minutes." + back)
    if err.pro_code == "invalid_request":
        return ApiError("upstream", "We couldn't check that pull request or branch. "
                        "Check the link and try again." + back)
    return ApiError("upstream", "Pre-flight checks are unavailable right now. Please try "
                    "again later." + back)


async def latest(s: AsyncSession, user_id: str, repo_key: str, target: str,
                 head_sha: str | None = None) -> Preflight | None:
    q = select(Preflight).where(Preflight.user_id == user_id, Preflight.repo_key == repo_key,
                                Preflight.target == target)
    if head_sha is not None:
        q = q.where(Preflight.head_sha == head_sha)
    return (await s.execute(q.order_by(Preflight.created_at.desc(), Preflight.id.desc())
                            .limit(1))).scalar_one_or_none()


async def run(svc: Services, job: Job, emit) -> dict[str, Any]:
    """The job: ask the service for the checks (the job runner times it)."""
    client = svc.require_pro()
    params = job.params or {}
    emit("Reading the pull request and what gets merged here", 0.1)
    try:
        body = await client.preflight(params.get("request") or {}, days=job.days,
                                      summary=bool(params.get("summary")),
                                      user_id=job.user_id, request_id=job.id)
    except pro.ProError as err:
        raise pro_failure(err, job.repo) from None
    svc.ai_costs[job.id] = budget.pro_cost(body)
    try:
        result = from_pro(job.repo, body)
    except ValueError:  # pydantic's ValidationError included
        log.exception("holt-pro sent pre-flight checks for %s that don't fit the schema",
                      job.repo)
        raise pro_failure(pro.ProError("internal", "upstream", ""), job.repo) from None
    sha = result["target"]["head_sha"]
    if sha and job.user_id:
        async with svc.db.session() as s:
            seen = await latest(s, job.user_id, job.repo_key, params.get("target", ""), sha)
        # This user already paid for this commit: `store` gives this charge back.
        result["free_recheck"] = seen is not None
    return result


async def store(s: AsyncSession, job: Job, result: dict[str, Any]) -> None:
    """Keep a finished check, in the job's finishing transaction: the row for
    this user, target and head commit is added or replaced. A free re-check
    gives back what the job was charged."""
    params = job.params or {}
    if not job.user_id:
        return
    target, sha = params.get("target", ""), result["target"]["head_sha"]
    row = await latest(s, job.user_id, job.repo_key, target, sha) if sha else None
    if row is None:
        s.add(Preflight(user_id=job.user_id, repo_key=job.repo_key, repo=job.repo,
                        target=target, head_sha=sha, result=result, job_id=job.id))
    else:
        row.result, row.job_id, row.created_at = result, job.id, now()
    if result.get("free_recheck") and job.charged and "charge" in params:
        await entitlements.refund(s, job.user_id, params["charge"], job.id)
        # So a later `refund_job` (there shouldn't be one) can't give it back twice.
        await s.execute(update(Job).where(Job.id == job.id).values(charged=False))


# --- reads -------------------------------------------------------------------------------


def dedupe(user_id: str, t: Target) -> str:
    return f"preflight:{user_id}:{t.repo_key}:{t.key}"[:260]


async def active(svc: Services, key: str) -> Job | None:
    async with svc.db.session() as s:
        return (await s.execute(select(Job).where(
            Job.dedupe_key == key, Job.status.in_(ACTIVE)).limit(1))).scalar_one_or_none()


def on_sale(svc: Services) -> bool:
    cat = entitlements.catalogue(svc)
    spec = cat.features[FEATURE]
    plan = any(p.on_sale and FEATURE in p.features for p in cat.plans.values())
    pack = spec.credits is not None and any(p.on_sale for p in cat.packs.values())
    return plan or pack


async def job_state(svc: Services, job: Job) -> schema.PreflightJob:
    stage = await svc.runner.stage_event(job)
    return schema.PreflightJob(job_id=job.id, status=job.status, stage=stage["stage"],
                               progress=stage["progress"])


@router.get("/preflight")
async def get_preflight(request: Request, who: Caller = Depends(caller),
                        pr: str | None = Query(None, max_length=500),
                        repo: str | None = Query(None, max_length=500),
                        branch: str | None = Query(None, max_length=250),
                        base: str | None = Query(None, max_length=250)) -> schema.PreflightState:
    svc = services(request)
    target = parse(pr, repo, branch, base) if (pr or repo or branch) else None
    if svc.pro is None:
        return schema.PreflightState(available=False, on_sale=False, access=None,
                                     target=target.public() if target else None,
                                     result=None, job=None)
    access = result = job = None
    if who.user_id:
        await get_user(svc, who.user_id)
        access = schema.Access(**(await entitlements.check(svc, who.user_id, FEATURE)).__dict__)
        if target is not None:
            async with svc.db.session() as s:
                row = await latest(s, who.user_id, target.repo_key, target.key)
            if row is not None:
                result = schema.Preflight.model_validate(row.result)
            if (running := await active(svc, dedupe(who.user_id, target))) is not None:
                job = await job_state(svc, running)
    return schema.PreflightState(available=True, on_sale=on_sale(svc), access=access,
                                 target=target.public() if target else None,
                                 result=result, job=job)


# --- checking ----------------------------------------------------------------------------


@router.post("/me/preflight", status_code=202, response_model=schema.Queued)
async def start_preflight(body: PreflightIn, request: Request,
                          who: Caller = Depends(caller)) -> JSONResponse:
    svc = services(request)
    user_id = signed_in(who)
    svc.require_pro()
    target = parse(body.pr_url, body.repo, body.branch, body.base)
    await get_user(svc, user_id)

    key = dedupe(user_id, target)
    if (running := await active(svc, key)) is not None:
        return queued(running.id)  # already checking it: no second charge

    rate_limit(svc, who)
    canonical = await svc.canonical(target.repo)  # an unknown repository costs nothing
    job = Job(kind=KIND, repo=canonical, repo_key=target.repo_key, mode="ai",
              days=pro.PREFLIGHT_DAYS, user_id=user_id, charged=True, dedupe_key=key,
              params={"target": target.key, "request": target.body(canonical),
                      "summary": body.summary})
    async with svc.db.session() as s:
        try:
            s.add(job)
            await s.flush()
            if body.summary:  # the summary is the model's part; the checks cost nothing
                await budget.reserve(s, svc.settings, job.id, budget.PREFLIGHT)
            paid = await entitlements.charge(s, svc, user_id, FEATURE, job_id=job.id)
            job.params = {**job.params, "charge": paid}
            await s.commit()
        except IntegrityError:  # a second click raced this one: wait on the first
            await s.rollback()
            if (running := await active(svc, key)) is None:
                raise ApiError("internal", "Something went wrong on our side. "
                               "Please try again in a minute.") from None
            return queued(running.id)
    svc.runner.wake()
    return queued(job.id)


# --- following a job ------------------------------------------------------------------------


@router.get("/preflight-jobs/{job_id}", dependencies=[Depends(internal)])
async def get_preflight_job(job_id: str, request: Request) -> schema.PreflightJobStatus:
    return schema.PreflightJobStatus.model_validate(
        job_body(await load_job(services(request), job_id, KIND)))


@router.get("/preflight-jobs/{job_id}/events", dependencies=[Depends(internal)])
async def preflight_job_events(job_id: str, request: Request) -> StreamingResponse:
    svc = services(request)
    await load_job(svc, job_id, KIND)
    return sse(svc, job_id, KIND, request)
