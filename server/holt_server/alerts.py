"""PR watch: what Holt tells a contributor about their open pull requests.

Rules only, no model. An alert is one line of plain English about one pull
request: it's your turn, it has waited longer than most do in that repository,
a bot is about to close it, or it was approved, merged or closed.

- `events(old, new)`: what changed between two reads of a pull request.
- `overdue(pr, timing, now)`: what the wait says, against the repository's
  report (`stats.timing`). No GitHub read.
- `line(...)`: the sentence, built from the alert's `kind` and `facts` when it
  is shown, so the bell, the email and the extension say the same thing and a
  wording fix reaches old alerts.
- `access(...)`: who gets alerts: a plan that covers `pr_watch`, or the free
  taste, `TRIAL_DAYS` from the first time alerts are turned on.

The checker (watch.py) and every contributions fetch call these and store what
they find with `record`; an event has one `dedupe_key`, so whichever of them
sees it first makes the alert and the other adds nothing. The mailer
(mailer.py) emails them. The routes are in alerts_api.py.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import secrets
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from holt_server import entitlements, pricing, schema
from holt_server.db import (
    Alert,
    AlertEmail,
    AlertSettings,
    User,
    WatchMute,
    iso,
    now,
    utc,
)

if TYPE_CHECKING:
    from holt_server.services import Services

# The feature in the pricing catalogue (pricing.json) a plan must cover.
FEATURE = "pr_watch"
# The free taste: this many days of alerts from the first time they're turned on.
TRIAL_DAYS = 14
# Alerts are deleted after this many days.
KEEP_DAYS = 90
# "The bot closes soon" fires this many quiet days before the stale bot's
# close, and never before half its days have passed.
STALE_WARN_DAYS = 5

KINDS = ("changes", "reply", "approved", "late_reply", "late_merge", "stale_soon",
         "merged", "closed")
# A maintainer replied or asked for changes: the only kinds emailed right
# away by default (mailer.py).
YOUR_TURN = frozenset({"changes", "reply"})

AccessState = Literal["unavailable", "off", "trial", "pro", "ended"]


# --- the rules -------------------------------------------------------------------------


@dataclass(frozen=True)
class Pr:
    """One read of a pull request: a `contributions` row, or the values of
    one about to be stored."""

    repo: str
    repo_key: str
    number: int
    title: str
    url: str
    state: str
    created_at: datetime
    draft: bool = False
    closed_at: datetime | None = None
    merged_at: datetime | None = None
    turn: str = "unknown"
    turn_at: datetime | None = None
    first_reply_at: datetime | None = None
    last_activity_at: datetime | None = None
    review_decision: str | None = None
    reply_by: str | None = None
    reply_kind: str | None = None

    @classmethod
    def of(cls, row: Any) -> Pr:
        get = row.get if isinstance(row, dict) else lambda name, d=None: getattr(row, name, d)
        values = {name: get(name) for name in cls.__dataclass_fields__}
        for name in ("created_at", "closed_at", "merged_at", "turn_at", "first_reply_at",
                     "last_activity_at"):
            values[name] = utc(values[name])
        values["draft"] = bool(values["draft"])
        values["turn"] = values["turn"] or "unknown"
        return cls(**values)


@dataclass(frozen=True)
class Found:
    kind: str
    # The names and numbers the line is built from.
    facts: dict[str, Any] = field(default_factory=dict)
    # The event's time, part of the dedupe key. None: once per pull request.
    at: datetime | None = None


def events(old: Pr | None, new: Pr) -> list[Found]:
    """What happened to a pull request between two reads. Nothing for one
    seen for the first time, or already merged or closed last time: Holt
    doesn't alert on what it didn't watch happen."""
    if old is None or old.state != "open":
        return []
    if new.state == "merged":
        return [Found("merged", at=new.merged_at)]
    if new.state == "closed":
        return [Found("closed", at=new.closed_at)]
    # "unknown" on either side: one of the reads failed, so nothing is known
    # to have changed.
    if new.turn == "unknown" or old.turn == "unknown":
        return []
    out = []
    who = {"who": new.reply_by} if new.reply_by else {}
    spoke_again = (new.turn_at is not None
                   and (old.turn_at is None or new.turn_at > old.turn_at))
    if new.turn == "yours" and (old.turn != "yours" or spoke_again):
        out.append(Found("changes" if new.reply_kind == "changes" else "reply", who,
                         new.turn_at))
    approved = new.reply_kind == "approved" and old.reply_kind != "approved"
    decided = new.review_decision == "approved" and old.review_decision != "approved"
    if approved or decided:
        out.append(Found("approved", who if new.reply_kind == "approved" else {}, new.turn_at))
    return out


def overdue(pr: Pr, timing: schema.Timing | None, at: datetime) -> list[Found]:
    """What the wait on an open pull request says, against how long things
    take in its repository. Nothing without the report's numbers (each is
    null under the engine's minimums), for a draft (it isn't asking for
    review yet), or when Holt couldn't read where the pull request stands."""
    if pr.state != "open" or pr.draft or pr.turn == "unknown" or timing is None:
        return []
    out = []
    hours = max(0.0, (at - pr.created_at).total_seconds() / 3600)
    day = math.floor(hours / 24) + 1
    close = timing.stale_close_days
    if close and pr.last_activity_at is not None:
        quiet = (at - pr.last_activity_at).total_seconds() / 86400
        if max(close - STALE_WARN_DAYS, close / 2) <= quiet < close:
            out.append(Found("stale_soon", {"quiet": math.floor(quiet), "close": close},
                             pr.last_activity_at))
    # Only the slow mark, the wait within which 8 in 10 get a reply: half of
    # all pull requests pass the typical one, so that isn't news.
    slow = timing.first_reply_slow_hours
    if pr.first_reply_at is None:
        if slow is not None and hours > slow:
            out.append(Found("late_reply", {"days": day, "slow_hours": slow}))
    elif pr.turn == "theirs" and timing.merge_slow_days is not None:
        slow = timing.merge_slow_days * 24
        if hours > slow:
            out.append(Found("late_merge", {"days": day, "slow_hours": slow}))
    return out


def derive(old: Pr | None, new: Pr, timing: schema.Timing | None, at: datetime) -> list[Found]:
    """Every alert one read of a pull request gives."""
    return [*events(old, new), *overdue(new, timing, at)]


# --- the line ---------------------------------------------------------------------------


def short(repo: str, number: int) -> str:
    """"click #2811": the repository's name without its owner."""
    return f"{repo.rsplit('/', 1)[-1]} #{number}"


def line(kind: str, repo: str, number: int, facts: dict[str, Any] | None) -> str:
    """The alert in one line: "Day 6, no reply on p5.js #7120. Most get one
    within 4 days here." """
    f = facts or {}
    pr = short(repo, number)
    who = f"@{f['who']}" if f.get("who") else "a reviewer"
    if kind == "changes":
        return f"Your turn: {who} asked for changes on {pr}."
    if kind == "reply":
        return f"Your turn: {who} replied on {pr}."
    if kind == "approved":
        return f"Approved: {who} approved {pr}." if f.get("who") else f"Approved: {pr}."
    if kind == "late_reply":
        return (f"Day {f.get('days')}, no reply on {pr}. Most get one within "
                f"{schema.wait_phrase(float(f.get('slow_hours') or 0))} here.")
    if kind == "late_merge":
        return (f"Day {f.get('days')} on {pr}. Most merged ones land within "
                f"{schema.wait_phrase(float(f.get('slow_hours') or 0))} here.")
    if kind == "stale_soon":
        quiet = f.get("quiet")
        return (f"Quiet for {quiet} day{'' if quiet == 1 else 's'} on {pr}. "
                f"The bot here closes at {f.get('close')}.")
    if kind == "merged":
        return f"Merged: {pr}."
    if kind == "closed":
        return f"Closed without merging: {pr}."
    return f"Something changed on {pr}."


# --- access -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Access:
    state: AccessState
    # When it ends (trial, or a pass with an expiry) or ended.
    until: datetime | None = None

    @property
    def on(self) -> bool:
        return self.state in ("trial", "pro")


def access(cat: pricing.Catalogue, user: User | None, at: datetime,
           available: bool = True) -> Access:
    """Whether `user` gets alerts now: their plan covers PR watch, or the
    free taste is still running. `ended` once the taste is over; `off` when
    it was never started; `unavailable` while PR watch is switched off."""
    if not available:
        return Access("unavailable")
    plan = entitlements.effective_plan(cat, user, at)
    if FEATURE in cat.plans[plan].features:
        return Access("pro", utc(user.plan_expires_at) if user else None)
    trial = utc(user.alerts_trial_ends_at) if user else None
    if trial is None:
        return Access("off")
    if at < trial:
        return Access("trial", trial)
    # A pass bought after the taste and since lapsed ended later than it.
    lapsed = utc(user.plan_expires_at) if user and user.plan != pricing.FREE else None
    return Access("ended", max(trial, lapsed) if lapsed and lapsed <= at else trial)


def access_for(svc: Services, user: User | None, at: datetime | None = None) -> Access:
    return access(entitlements.catalogue(svc), user, at or now(), svc.settings.pr_watch)


# --- the unsubscribe token --------------------------------------------------------------


def new_nonce() -> str:
    return secrets.token_hex(16)


def unsubscribe_token(secret: str, user_id: str, nonce: str) -> str:
    """The token in an email's unsubscribe link. Never stored: it is worked
    out from the server's secret and the user's `unsubscribe_nonce`."""
    return hmac.new(f"alerts-unsubscribe|{secret}".encode(), f"{user_id}|{nonce}".encode(),
                    hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_settings(svc: Services, user_id: str) -> AlertSettings:
    nonce = new_nonce()
    return AlertSettings(
        user_id=user_id, enabled=False, email=None, email_on=True, email_mode="turn",
        tz="UTC", unsubscribe_nonce=nonce, created_at=now(), updated_at=now(),
        unsubscribe_hash=token_hash(unsubscribe_token(svc.settings.secret_key, user_id, nonce)))


def rotate_token(svc: Services, row: AlertSettings) -> None:
    """A new unsubscribe token: links in emails sent before stop working."""
    row.unsubscribe_nonce = new_nonce()
    row.unsubscribe_hash = token_hash(
        unsubscribe_token(svc.settings.secret_key, row.user_id, row.unsubscribe_nonce))


# --- storing ----------------------------------------------------------------------------


async def watching(s: AsyncSession, svc: Services, user_id: str,
                   at: datetime | None = None) -> bool:
    """Alerts are made for this user now: PR watch is switched on, they
    turned alerts on, and they have access."""
    if not svc.settings.pr_watch:
        return False
    row = await s.get(AlertSettings, user_id)
    if row is None or not row.enabled:
        return False
    return access_for(svc, await s.get(User, user_id), at).on


async def muted(s: AsyncSession, user_id: str) -> set[tuple[str, int]]:
    """The (repo key, number) of every pull request the user muted."""
    return {(key, number) for key, number in await s.execute(
        select(WatchMute.repo_key, WatchMute.number).where(WatchMute.user_id == user_id))}


async def unread_prs(s: AsyncSession, user_id: str) -> set[tuple[str, int]]:
    """The pull requests with an alert the user hasn't opened."""
    return {(key, number) for key, number in await s.execute(
        select(Alert.repo_key, Alert.number)
        .where(Alert.user_id == user_id, Alert.read_at.is_(None)).distinct())}


async def unread(s: AsyncSession, user_id: str) -> int:
    return (await s.execute(select(func.count()).select_from(Alert).where(
        Alert.user_id == user_id, Alert.read_at.is_(None)))).scalar_one()


def dedupe_key(user_id: str, pr: Pr, found: Found) -> str:
    return hashlib.sha256(
        f"{user_id}|{pr.repo_key}#{pr.number}|{found.kind}|{iso(found.at) or ''}".encode()
    ).hexdigest()


async def record(s: AsyncSession, user_id: str, pr: Pr, found: Iterable[Found],
                 at: datetime | None = None) -> int:
    """Store the alerts for one pull request, each event once. Returns how
    many were new. Caller commits."""
    insert = postgresql.insert if s.bind.dialect.name == "postgresql" else sqlite.insert
    made = 0
    for f in found:
        got = await s.execute(insert(Alert).values(
            user_id=user_id, repo=pr.repo, repo_key=pr.repo_key, number=pr.number,
            pr_url=pr.url, pr_title=pr.title, kind=f.kind, facts=f.facts,
            dedupe_key=dedupe_key(user_id, pr, f), created_at=at or now(),
        ).on_conflict_do_nothing(index_elements=[Alert.dedupe_key]))
        made += got.rowcount or 0
    return made


async def forget(s: AsyncSession, user_id: str) -> None:
    """Delete a user's alerts, mutes, sent-email records and alert settings
    (their email address with them), on disconnect. The used-up taste stays
    on `users`. Caller commits."""
    for table in (Alert, AlertEmail, WatchMute, AlertSettings):
        await s.execute(delete(table).where(table.user_id == user_id))


async def prune(s: AsyncSession, at: datetime | None = None) -> None:
    """Delete alerts and sent-email records older than KEEP_DAYS. Caller commits."""
    before = (at or now()) - timedelta(days=KEEP_DAYS)
    await s.execute(delete(Alert).where(Alert.created_at < before))
    await s.execute(delete(AlertEmail).where(AlertEmail.sent_at < before))
