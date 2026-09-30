"""Saved repos: `/v1/me/saved` (API.md, "Saved repos").

A signed-in user keeps a repository to come back to later. Only the name and
when it was saved are stored; the card shown with it (verdict, description,
language, stars) is read fresh from the latest rules report and `repo_meta`,
exactly as Discover shows it, so a saved repo never shows a stale verdict.

Saving and unsaving are idempotent: saving again keeps the first `saved_at`,
and unsaving something that isn't saved is not an error. Nothing here calls
GitHub. `forget` deletes a user's rows when their data is deleted.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from holt_server import discover, repos, schema
from holt_server.db import RepoMeta, Report, SavedRepo, iso, now
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.discover import DiscoverRepo
from holt_server.errors import ApiError
from holt_server.schema import Model
from holt_server.services import Services

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

# The most repositories one person can keep saved.
MAX_SAVED = 500
# Saves and unsaves per hour per user, counted apart from analyses and reads.
WRITES_PER_HOUR = 300


class SavedState(Model):
    repo: str
    saved: bool
    saved_at: str | None = None


class SavedItem(Model):
    repo: str
    saved_at: str
    # What Discover shows for it; null until Holt has a current rules report.
    card: DiscoverRepo | None = None


class SavedList(Model):
    # Newest first.
    saved: list[SavedItem]
    max_saved: int = MAX_SAVED


def limit(svc: Services, user_id: str) -> None:
    try:
        svc.read_limiter.hit(f"saved:user:{user_id}", WRITES_PER_HOUR)
    except ApiError as exc:
        raise ApiError("rate_limited", "That's a lot of saving for one hour. "
                       "Please try again a little later.", retry_after=exc.retry_after) from exc


async def _canonical(s, repo: str) -> str:
    """GitHub's casing when Holt already knows the repository; else as given."""
    key = repos.key(repo)
    meta = await s.get(RepoMeta, key)
    if meta is not None:
        return meta.repo
    known = (await s.execute(select(Report.repo).where(Report.repo_key == key)
                             .order_by(Report.id.desc()).limit(1))).scalar_one_or_none()
    return known or repo


async def forget(s, user_id: str) -> None:
    """Delete every repository a user saved (their data is being deleted).
    Caller commits."""
    await s.execute(delete(SavedRepo).where(SavedRepo.user_id == user_id))


async def list_body(svc: Services, user_id: str) -> SavedList:
    async with svc.db.session() as s:
        rows = (await s.execute(
            select(SavedRepo).where(SavedRepo.user_id == user_id)
            .order_by(SavedRepo.saved_at.desc(), SavedRepo.repo_key))).scalars().all()
    cards = await discover.cards(svc, [r.repo_key for r in rows])
    return SavedList(saved=[
        SavedItem(repo=cards[r.repo_key].repo if r.repo_key in cards else r.repo,
                  saved_at=iso(r.saved_at), card=cards.get(r.repo_key))
        for r in rows])


@router.get("/me/saved")
async def get_saved(request: Request, who: Caller = Depends(caller)) -> SavedList:
    return await list_body(services(request), signed_in(who))


@router.delete("/me/saved")
async def delete_saved(request: Request, who: Caller = Depends(caller)) -> SavedList:
    user_id = signed_in(who)
    svc = services(request)
    limit(svc, user_id)
    async with svc.db.session() as s:
        await forget(s, user_id)
        await s.commit()
    return SavedList(saved=[])


@router.get("/me/saved/{owner}/{name}")
async def get_saved_repo(owner: str, name: str, request: Request,
                         who: Caller = Depends(caller)) -> SavedState:
    user_id = signed_in(who)
    repo = repos.normalize(f"{owner}/{name}")
    async with services(request).db.session() as s:
        row = await s.get(SavedRepo, (user_id, repos.key(repo)))
    if row is None:
        return SavedState(repo=repo, saved=False)
    return SavedState(repo=row.repo, saved=True, saved_at=iso(row.saved_at))


@router.put("/me/saved/{owner}/{name}")
async def put_saved_repo(owner: str, name: str, request: Request,
                         who: Caller = Depends(caller)) -> SavedState:
    user_id = signed_in(who)
    repo = repos.normalize(f"{owner}/{name}")
    svc = services(request)
    limit(svc, user_id)
    key = repos.key(repo)
    async with svc.db.session() as s:
        row = await s.get(SavedRepo, (user_id, key))
        if row is None:
            count = (await s.execute(select(func.count()).select_from(SavedRepo)
                                     .where(SavedRepo.user_id == user_id))).scalar_one()
            if count >= MAX_SAVED:
                raise ApiError("invalid_request",
                               f"You've saved {MAX_SAVED} repositories, the most Holt keeps. "
                               "Remove a few to save more.")
            row = SavedRepo(user_id=user_id, repo_key=key,
                            repo=await _canonical(s, repo), saved_at=now())
            s.add(row)
            try:
                await s.commit()
            except IntegrityError:
                # Saved by a request racing this one: theirs stands.
                await s.rollback()
                row = await s.get(SavedRepo, (user_id, key))
        return SavedState(repo=row.repo, saved=True, saved_at=iso(row.saved_at))


@router.delete("/me/saved/{owner}/{name}")
async def delete_saved_repo(owner: str, name: str, request: Request,
                            who: Caller = Depends(caller)) -> SavedState:
    user_id = signed_in(who)
    repo = repos.normalize(f"{owner}/{name}")
    svc = services(request)
    limit(svc, user_id)
    async with svc.db.session() as s:
        await s.execute(delete(SavedRepo).where(SavedRepo.user_id == user_id,
                                                SavedRepo.repo_key == repos.key(repo)))
        await s.commit()
    return SavedState(repo=repo, saved=False)
