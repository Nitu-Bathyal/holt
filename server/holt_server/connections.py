"""Connect GitHub: `/v1/me/github` and `/v1/me/activity` (API.md, "Connect GitHub").

Connecting is free and optional. `web/` knows the user's numeric GitHub id
(from the GitHub account they signed in or linked with); we look up the login
with the server's own tokens, because who an id belongs to is public. Holt
never holds the user's GitHub token.

Connecting needs an "I'm 18 or older" confirmation, stored with its time. A
connected user's public contributions may count, anonymously, in repo
statistics unless they turn on `stats_opt_out`. While connected, the report
pages they open are recorded in `repo_views`, and their public pull requests
are fetched for My Contributions (contributions.py); disconnecting deletes the
connection and all of those rows.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import IntegrityError

from holt_server import contributions, repo_stats, repos, schema
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.db import GitHubConnection, RepoView, iso, now
from holt_server.errors import ApiError, github_rate_limited, upstream
from holt_server.services import Services

log = logging.getLogger("holt_server.connections")

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

USER_URL = "https://api.github.com/user/{id}"
LOOKUP_TIMEOUT_S = 15.0


class ConnectIn(BaseModel):
    github_id: int = Field(gt=0, lt=2**53)
    adult_confirmed: bool
    stats_opt_out: bool = False


class GitHubSettingsIn(BaseModel):
    stats_opt_out: bool


class ActivityIn(BaseModel):
    repo: str = Field(min_length=3, max_length=200)


# --- the id -> login lookup -----------------------------------------------------


async def github_login(svc: Services, github_id: int) -> str:
    """The current login for a numeric GitHub account id (public data)."""
    return await asyncio.to_thread(_github_login, svc, github_id)


def _github_login(svc: Services, github_id: int) -> str:
    index, token = svc.pool.lease()
    try:
        res = svc.http.get(
            USER_URL.format(id=github_id),
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28"},
            timeout=LOOKUP_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        log.warning("GitHub user lookup failed: %s", type(exc).__name__)
        raise upstream() from exc
    if res.status_code == 404:
        raise ApiError("invalid_request", "We couldn't find that GitHub account. "
                       "It may have been deleted or renamed; try connecting again.")
    if res.status_code == 401:
        svc.pool.note_refused(index, "401")
        raise upstream()
    if res.status_code == 429 or (res.status_code == 403
                                  and res.headers.get("x-ratelimit-remaining") == "0"):
        raise github_rate_limited()
    login = (res.json() or {}).get("login") if res.status_code == 200 else None
    if not isinstance(login, str) or not login:
        log.warning("GitHub user lookup answered %d", res.status_code)
        raise upstream()
    return login


# --- endpoints ------------------------------------------------------------------------


def body(conn: GitHubConnection | None) -> schema.GitHubConnection:
    if conn is None:
        return schema.GitHubConnection(connected=False, account=None)
    return schema.GitHubConnection(connected=True, account=schema.GitHubAccount(
        id=conn.github_id,
        login=conn.login,
        connected_at=iso(conn.connected_at),
        adult_confirmed_at=iso(conn.adult_confirmed_at),
        stats_opt_out=conn.stats_opt_out,
    ))


def taken() -> ApiError:
    return ApiError("invalid_request", "That GitHub account is already connected to "
                    "another Holt account. Sign in with that account instead.", status=409)


@router.get("/me/github")
async def get_github(request: Request, who: Caller = Depends(caller)) -> schema.GitHubConnection:
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        return body(await s.get(GitHubConnection, user_id))


@router.post("/me/github")
async def connect_github(data: ConnectIn, request: Request,
                         who: Caller = Depends(caller)) -> schema.GitHubConnection:
    svc = services(request)
    user_id = signed_in(who)
    if not data.adult_confirmed:
        raise ApiError("invalid_request", "Please confirm you're 18 or older to connect GitHub.")
    async with svc.db.session() as s:
        other = (await s.execute(select(GitHubConnection.user_id).where(
            GitHubConnection.github_id == data.github_id))).scalar()
    if other is not None and other != user_id:
        raise taken()
    login = await github_login(svc, data.github_id)
    at = now()
    async with svc.db.session() as s:
        conn = await s.get(GitHubConnection, user_id)
        if conn is None:
            conn = GitHubConnection(user_id=user_id, github_id=data.github_id,
                                    connected_at=at, adult_confirmed_at=at)
            s.add(conn)
        elif conn.github_id != data.github_id:
            conn.github_id, conn.connected_at = data.github_id, at
        conn.login = login
        conn.adult_confirmed_at = at
        if conn.stats_opt_out != data.stats_opt_out:
            conn.stats_opt_out = data.stats_opt_out
            await repo_stats.rebuild(s, await repo_stats.user_repos(s, user_id))
        try:
            await s.commit()
        except IntegrityError as exc:
            # Someone else connected this GitHub account a moment ago, or this
            # user connected twice at once.
            raise taken() if other is None else ApiError(
                "internal", "Something went wrong on our side. Try again.") from exc
    contributions.fetch_soon(svc, user_id, login)
    return body(conn)


@router.patch("/me/github")
async def github_settings(data: GitHubSettingsIn, request: Request,
                          who: Caller = Depends(caller)) -> schema.GitHubConnection:
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        conn = await s.get(GitHubConnection, user_id)
        if conn is None:
            raise ApiError("not_found", "Your GitHub account isn't connected.")
        changed = conn.stats_opt_out != data.stats_opt_out
        conn.stats_opt_out = data.stats_opt_out
        if changed:  # in or out of every repository's numbers, now
            await repo_stats.rebuild(s, await repo_stats.user_repos(s, user_id))
        await s.commit()
        return body(conn)


@router.delete("/me/github")
async def disconnect_github(request: Request,
                            who: Caller = Depends(caller)) -> schema.GitHubConnection:
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        # The connection first: a pull-request fetch holding its row finishes
        # before this goes on, so the deletes below also catch what it stored.
        await s.execute(delete(GitHubConnection).where(GitHubConnection.user_id == user_id))
        await s.execute(delete(RepoView).where(RepoView.user_id == user_id))
        counted = await repo_stats.user_repos(s, user_id)
        await contributions.forget(s, user_id)
        await repo_stats.rebuild(s, counted)
        await s.commit()
    return body(None)


@router.post("/me/activity", status_code=204, response_class=Response)
async def record_view(data: ActivityIn, request: Request,
                      who: Caller = Depends(caller)) -> Response:
    """A signed-in user opened a report page. Kept only while GitHub is connected."""
    svc = services(request)
    user_id = signed_in(who)
    repo = repos.normalize(data.repo)
    at = now()
    async with svc.db.session() as s:
        if await s.get(GitHubConnection, user_id) is None:
            return Response(status_code=204)
        dialect = postgresql if s.bind.dialect.name == "postgresql" else sqlite
        stmt = dialect.insert(RepoView).values(
            user_id=user_id, repo_key=repos.key(repo), repo=repo,
            first_viewed_at=at, last_viewed_at=at, views=1)
        stmt = stmt.on_conflict_do_update(
            index_elements=[RepoView.user_id, RepoView.repo_key],
            set_={"repo": repo, "last_viewed_at": at, "views": RepoView.views + 1})
        await s.execute(stmt)
        await s.commit()
    return Response(status_code=204)
