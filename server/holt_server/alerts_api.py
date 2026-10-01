"""PR watch's routes (API.md, "PR watch"): the bell, the alert settings,
muting a pull request, and the email unsubscribe link.

    GET    /v1/me/alerts                     the bell's list
    GET    /v1/me/alerts/count               the unread count, for every page
    POST   /v1/me/alerts/read                mark some, or all, read
    GET    /v1/me/alerts/settings
    PUT    /v1/me/alerts/settings            turning alerts on starts the free taste
    PUT    /v1/me/contributions/{owner}/{name}/{number}/mute     (DELETE unmutes)
    POST   /v1/alerts/unsubscribe?t=…        the email's one-click link (DELETE undoes it)

The rules are in alerts.py, the checker in watch.py, the emails in mailer.py.
"""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from holt_server import alerts, credits, mailer, repos, schema, watch
from holt_server.db import AlertSettings as SettingsRow
from holt_server.db import (
    Alert,
    Contribution,
    GitHubConnection,
    User,
    WatchMute,
    iso,
    now,
)
from holt_server.deps import Caller, caller, services, signed_in
from holt_server.errors import ApiError
from holt_server.schema import Model
from holt_server.services import Services

router = APIRouter(prefix="/v1", responses={"default": {"model": schema.ErrorBody}})

MAX_PAGE = 50
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

AlertKind = Literal["changes", "reply", "approved", "late_reply", "late_merge", "stale_soon",
                    "merged", "closed"]
EmailMode = Literal["turn", "daily", "all"]


class AlertAccess(Model):
    # unavailable: PR watch is switched off on this server. off: never turned
    # on (turning it on starts the free taste). trial: the free taste is
    # running. pro: a pass covers it. ended: the taste is over.
    state: alerts.AccessState
    # When it ends (or ended). Null for `off`, and for a plan with no expiry.
    until: str | None = None


class AlertItem(Model):
    id: int
    kind: AlertKind
    # The alert in one line, ready to show.
    text: str
    repo: str
    number: int
    title: str
    pr_url: str
    # Holt's report on the repository: "/owner/name".
    report_path: str
    created_at: str
    read_at: str | None = None


class AlertList(Model):
    # Alerts not opened yet (all of them, not only this page). 0 without access.
    unread: int
    access: AlertAccess
    # The person's own switch (settings). With access and this off, the bell
    # offers to turn alerts on.
    enabled: bool
    # Open pull requests Holt is watching for this user now.
    watching: int
    # Newest first.
    items: list[AlertItem]
    # Pass as `before` for the next page; null when this is the last.
    next_before: int | None = None


class AlertCount(Model):
    unread: int


class AlertReadBody(Model):
    """POST /v1/me/alerts/read: some alerts, or all of them."""

    ids: list[int] = Field(default_factory=list, max_length=200)
    all: bool = False


class AlertSettings(Model):
    # The top switch: Holt watches this person's pull requests.
    enabled: bool
    # Where alert emails go; null: the bell only.
    email: str | None
    # The Email switch. The unsubscribe link turns it off.
    email_on: bool
    email_mode: EmailMode
    # IANA time zone, for the 8:00 email and the quiet hours.
    tz: str
    access: AlertAccess
    watching: int
    # False while this server sends no email at all (no provider key).
    email_available: bool


class AlertSettingsBody(Model):
    """PUT /v1/me/alerts/settings: only the fields sent are changed."""

    enabled: bool | None = None
    # The signed-in account's verified address, or null to clear it.
    email: str | None = Field(None, max_length=320)
    email_on: bool | None = None
    email_mode: EmailMode | None = None
    tz: str | None = Field(None, max_length=64)


class Unsubscribed(Model):
    email_on: bool


def access_body(access: alerts.Access) -> AlertAccess:
    return AlertAccess(state=access.state, until=iso(access.until))


async def _watching(s, svc: Services, user_id: str) -> int:
    """How many open pull requests Holt is watching for this user now."""
    if not await alerts.watching(s, svc, user_id):
        return 0
    return len(await watch.watched(s, [user_id]))


def _item(a: Alert) -> AlertItem:
    return AlertItem(
        id=a.id, kind=a.kind, text=alerts.line(a.kind, a.repo, a.number, a.facts),
        repo=a.repo, number=a.number, title=a.pr_title, pr_url=a.pr_url,
        report_path=f"/{a.repo}", created_at=iso(a.created_at), read_at=iso(a.read_at))


# --- the bell ---------------------------------------------------------------------------


@router.get("/me/alerts")
async def get_alerts(request: Request, limit: int = Query(20, ge=1, le=MAX_PAGE),
                     before: int | None = Query(None, ge=1),
                     who: Caller = Depends(caller)) -> AlertList:
    """The latest alerts. They stay listed after access ends; none are made
    then, and the unread count goes to 0."""
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        access = alerts.access_for(svc, await s.get(User, user_id))
        row = await s.get(SettingsRow, user_id)
        q = select(Alert).where(Alert.user_id == user_id)
        if before is not None:
            q = q.where(Alert.id < before)
        rows = (await s.execute(q.order_by(Alert.id.desc()).limit(limit + 1))).scalars().all()
        unread = await alerts.unread(s, user_id) if access.on else 0
        watching = await _watching(s, svc, user_id)
    more = len(rows) > limit
    rows = rows[:limit]
    return AlertList(unread=unread, access=access_body(access),
                     enabled=bool(row and row.enabled), watching=watching,
                     items=[_item(a) for a in rows],
                     next_before=rows[-1].id if more else None)


@router.get("/me/alerts/count")
async def get_alert_count(request: Request, who: Caller = Depends(caller)) -> AlertCount:
    """Cheap: the top bar asks on every page."""
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        if not alerts.access_for(svc, await s.get(User, user_id)).on:
            return AlertCount(unread=0)
        return AlertCount(unread=await alerts.unread(s, user_id))


@router.post("/me/alerts/read", status_code=204, response_class=Response)
async def read_alerts(body: AlertReadBody, request: Request,
                      who: Caller = Depends(caller)) -> Response:
    svc = services(request)
    user_id = signed_in(who)
    if not body.all and not body.ids:
        raise ApiError("invalid_request", "Say which alerts to mark read: `ids`, or `all`.")
    mark = update(Alert).where(Alert.user_id == user_id, Alert.read_at.is_(None))
    if not body.all:
        mark = mark.where(Alert.id.in_(body.ids))
    async with svc.db.session() as s:
        await s.execute(mark.values(read_at=now()))
        await s.commit()
    return Response(status_code=204)


# --- settings ---------------------------------------------------------------------------


def _settings_body(svc: Services, row: SettingsRow | None, access: alerts.Access,
                   watching: int) -> AlertSettings:
    return AlertSettings(
        enabled=bool(row and row.enabled), email=row.email if row else None,
        email_on=row.email_on if row else True,
        email_mode=row.email_mode if row else "turn", tz=row.tz if row else "UTC",
        access=access_body(access), watching=watching,
        email_available=svc.mailer is not None)


@router.get("/me/alerts/settings")
async def get_alert_settings(request: Request,
                             who: Caller = Depends(caller)) -> AlertSettings:
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        row = await s.get(SettingsRow, user_id)
        access = alerts.access_for(svc, await s.get(User, user_id))
        return _settings_body(svc, row, access, await _watching(s, svc, user_id))


def _zone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ApiError("invalid_request", "That time zone isn't one Holt knows.") from None
    return name


@router.put("/me/alerts/settings")
async def put_alert_settings(body: AlertSettingsBody, request: Request,
                             who: Caller = Depends(caller)) -> AlertSettings:
    """Change the fields sent. The first `enabled: true` starts the free
    taste (`alerts.TRIAL_DAYS` days, once per account) for someone without a
    pass that covers alerts."""
    svc = services(request)
    user_id = signed_in(who)
    sent = body.model_fields_set
    email = body.email.strip() if body.email else None
    if email is not None and not _EMAIL.fullmatch(email):
        raise ApiError("invalid_request", "That doesn't look like an email address.")
    tz = _zone(body.tz) if body.tz else None
    await credits.ensure_user(svc, user_id)
    at = now()
    async with svc.db.session() as s:
        user = (await s.execute(select(User).where(User.id == user_id)
                                .with_for_update())).scalar_one()
        row = await s.get(SettingsRow, user_id)
        if row is None:
            row = alerts.new_settings(svc, user_id)
            s.add(row)
        access = alerts.access_for(svc, user, at)
        if body.enabled:
            if access.state == "unavailable":
                raise ApiError("not_implemented", "Alerts aren't switched on yet.", status=501)
            if await s.get(GitHubConnection, user_id) is None:
                raise ApiError("not_found", "Connect your GitHub account to get alerts.")
            if access.state == "ended":
                raise ApiError("needs_plan", f"Your {alerts.TRIAL_DAYS} days of alerts have "
                               "ended. Alerts come with Holt Pro.")
            if access.state == "off":
                user.alerts_trial_ends_at = at + timedelta(days=alerts.TRIAL_DAYS)
                access = alerts.access_for(svc, user, at)
        if body.enabled is not None:
            row.enabled = body.enabled
        if "email" in sent and email != row.email:
            # The old inbox's unsubscribe links mustn't reach the new address.
            row.email = email
            alerts.rotate_token(svc, row)
        if body.email_on is not None:
            row.email_on = body.email_on
        if body.email_mode is not None:
            row.email_mode = body.email_mode
        if tz is not None:
            row.tz = tz
        if row.last_daily_on is None:
            # The first daily email is the next 8:00, not the moment alerts
            # are turned on.
            local = at.astimezone(mailer.zone(row.tz))
            if local.time() >= mailer.DAILY_AT:
                row.last_daily_on = local.date()
        row.updated_at = at
        try:
            await s.commit()
        except IntegrityError:  # two first saves at once
            raise ApiError("internal", "Something went wrong on our side. Try again.") from None
        return _settings_body(svc, row, access, await _watching(s, svc, user_id))


# --- muting one pull request -------------------------------------------------------------


async def _pull(s, user_id: str, owner: str, name: str, number: int) -> Contribution:
    key = repos.key(repos.normalize(f"{owner}/{name}"))
    row = await s.get(Contribution, (user_id, key, number))
    if row is None:
        raise ApiError("not_found", "That isn't one of your pull requests.")
    return row


@router.put("/me/contributions/{owner}/{name}/{number}/mute", status_code=204,
            response_class=Response)
async def mute(owner: str, name: str, number: int, request: Request,
               who: Caller = Depends(caller)) -> Response:
    """No alerts for this pull request. Its row on My PRs stays as it is."""
    svc = services(request)
    user_id = signed_in(who)
    async with svc.db.session() as s:
        row = await _pull(s, user_id, owner, name, number)
        if await s.get(WatchMute, (user_id, row.repo_key, number)) is None:
            s.add(WatchMute(user_id=user_id, repo_key=row.repo_key, number=number))
            try:
                await s.commit()
            except IntegrityError:  # muted twice at once
                await s.rollback()
    return Response(status_code=204)


@router.delete("/me/contributions/{owner}/{name}/{number}/mute", status_code=204,
               response_class=Response)
async def unmute(owner: str, name: str, number: int, request: Request,
                 who: Caller = Depends(caller)) -> Response:
    svc = services(request)
    user_id = signed_in(who)
    key = repos.key(repos.normalize(f"{owner}/{name}"))
    async with svc.db.session() as s:
        await s.execute(delete(WatchMute).where(
            WatchMute.user_id == user_id, WatchMute.repo_key == key,
            WatchMute.number == number))
        await s.commit()
    return Response(status_code=204)


# --- the unsubscribe link ----------------------------------------------------------------


async def _set_email(svc: Services, token: str, on: bool) -> Unsubscribed:
    async with svc.db.session() as s:
        row = (await s.execute(select(SettingsRow).where(
            SettingsRow.unsubscribe_hash == alerts.token_hash(token)))).scalar_one_or_none()
        if row is None:
            raise ApiError("not_found", "That link doesn't work any more. You can change "
                           "your alert emails in your settings.")
        row.email_on, row.updated_at = on, now()
        await s.commit()
    return Unsubscribed(email_on=on)


@router.post("/alerts/unsubscribe")
async def unsubscribe(request: Request, t: str = Query(min_length=16, max_length=200),
                      _: Caller = Depends(caller)) -> Unsubscribed:
    """The email's "Stop these emails" link and its one-click
    `List-Unsubscribe` header: turns email off, with no sign-in. The bell
    stays. `web/` calls it for whoever holds the link."""
    return await _set_email(services(request), t, False)


@router.delete("/alerts/unsubscribe")
async def resubscribe(request: Request, t: str = Query(min_length=16, max_length=200),
                      _: Caller = Depends(caller)) -> Unsubscribed:
    """The unsubscribe page's "undo": email back on, with the same link."""
    return await _set_email(services(request), t, True)
