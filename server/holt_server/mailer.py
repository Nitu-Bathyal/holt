"""PR watch's emails: which alerts go out when, and sending them.

The bell is instant; email is a hybrid, per user (`email_mode`):

- `turn` (the default): "your turn" alerts (a maintainer replied or asked for
  changes) go out right away, everything else in one daily email;
- `daily`: only the daily email;
- `all`: everything right away.

Right away means the next run after the alert is `BATCH_WAIT` old, so the
alerts one check made go out in one email, and at most one such email per
pull request in `PER_PR`: a second alert on it that day waits for the daily
email. The daily email goes out at 8:00 in the user's time zone with
everything not emailed yet from the last `DAILY_WINDOW`, and is skipped when
there is nothing. No email at all between 22:00 and 8:00 their time: what
lands then waits for the daily email.

`plan` decides all of that and is pure. `run` reads the database, calls it,
renders (alert_email.py) and sends through `svc.mailer`: Resend's HTTP API
with `RESEND_API_KEY`, or nothing at all without the key (alerts still reach
the bell). The loop runs every `EVERY_S` in the API process under its own
advisory lock; it reads no GitHub.

    python -m holt_server.mailer        # one run now
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import func, select, update

from holt_server import alert_email, alerts
from holt_server.db import (
    AccountEmail,
    Alert,
    AlertEmail,
    AlertSettings,
    User,
    WatchMute,
    now,
    utc,
)

if TYPE_CHECKING:
    from holt_server.services import Services
    from holt_server.settings import Settings

log = logging.getLogger("holt_server.mailer")

EVERY_S = 300.0
LOCK_ID = 7_406_114
# An alert waits this long before a right-away email, so the alerts one check
# made go out together.
BATCH_WAIT = timedelta(minutes=5)
# At most one right-away email per pull request in this long.
PER_PR = timedelta(hours=24)
# The daily email holds what wasn't emailed from this long back; anything
# older stays on the bell.
DAILY_WINDOW = timedelta(hours=36)
DAILY_AT = time(8, 0)
QUIET_FROM = time(22, 0)
# Sends kept in hand under the provider's daily limit.
LIMIT_MARGIN = 5
# A run ends after this many emails the provider wouldn't take.
MAX_TROUBLE = 3
SEND_TIMEOUT_S = 20.0
RESEND_URL = "https://api.resend.com/emails"

MODES = ("turn", "daily", "all")
MODE_LINE = {"turn": "Your turn right away, the rest at 8:00.",
             "daily": "One email a day, at 8:00.",
             "all": "Everything as it happens."}


# --- the plan (pure) -------------------------------------------------------------------


@dataclass(frozen=True)
class Prefs:
    user_id: str
    email_on: bool = True
    email_mode: str = "turn"
    tz: str = "UTC"
    # The user's local date of the last daily run.
    last_daily_on: date | None = None


@dataclass(frozen=True)
class Pending:
    """An alert that hasn't been emailed."""

    id: int
    kind: str
    pr: tuple[str, int]  # repo key, number
    created_at: datetime


@dataclass(frozen=True)
class Queue:
    prefs: Prefs
    pending: tuple[Pending, ...] = ()
    # Pull requests that had a right-away email in the last PER_PR.
    emailed: frozenset[tuple[str, int]] = frozenset()


@dataclass(frozen=True)
class Email:
    user_id: str
    kind: str  # now | daily
    alert_ids: tuple[int, ...]
    # The user's local date (the daily email's "Wednesday 1 October", and
    # their `last_daily_on` once it is sent).
    local_date: date


@dataclass(frozen=True)
class Plan:
    # In sending order: right-away emails first, then daily ones.
    emails: tuple[Email, ...] = ()
    # Users whose daily email was due with nothing to send: (user id, local date).
    daily_empty: tuple[tuple[str, date], ...] = ()
    # Emails left out because the provider's daily limit is near.
    held: int = 0


def skip_today(row: AlertSettings, at: datetime, starting: bool) -> None:
    """Keep a user's daily email at 8:00 when their settings change. Someone
    who just turned alerts or email on after 8:00 gets their first daily
    email tomorrow, not at once; someone who moved to a time zone where the
    last one is dated tomorrow doesn't lose a day."""
    local = at.astimezone(zone(row.tz))
    today = local.date()
    if row.last_daily_on is not None and row.last_daily_on > today:
        row.last_daily_on = today
    elif (starting and local.time() >= DAILY_AT
          and (row.last_daily_on is None or row.last_daily_on < today)):
        row.last_daily_on = today


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return ZoneInfo("UTC")


def quiet(local: datetime) -> bool:
    """22:00-8:00 the user's time: no email."""
    return local.time() >= QUIET_FROM or local.time() < DAILY_AT


def right_away(mode: str) -> frozenset[str]:
    """The alert kinds a mode emails right away."""
    if mode == "all":
        return frozenset(alerts.KINDS)
    return alerts.YOUR_TURN if mode == "turn" else frozenset()


def plan_user(q: Queue, at: datetime) -> tuple[Email | None, date | None]:
    """(the email this user gets now, the local date a due daily run with
    nothing to send should be marked done on)."""
    p = q.prefs
    local = at.astimezone(zone(p.tz))
    if not p.email_on or quiet(local):
        return None, None
    today = local.date()
    if p.last_daily_on is None or p.last_daily_on < today:
        # The daily run. It takes the "your turn" alerts that waited through
        # the night with it, so 8:00 brings one email, not two.
        ids = tuple(a.id for a in q.pending if a.created_at >= at - DAILY_WINDOW)
        return (Email(p.user_id, "daily", ids, today), None) if ids else (None, today)
    kinds = right_away(p.email_mode)
    ids = tuple(a.id for a in q.pending
                if a.kind in kinds and a.created_at <= at - BATCH_WAIT
                and a.created_at >= at - DAILY_WINDOW and a.pr not in q.emailed)
    return (Email(p.user_id, "now", ids, today) if ids else None), None


def plan(queues: Iterable[Queue], at: datetime, budget: int) -> Plan:
    """The emails to send now, at most `budget` of them: right-away emails
    first, then daily ones. A daily email that doesn't fit isn't marked done,
    so it goes out on a later run, once there is room."""
    now_, daily, empty = [], [], []
    for q in queues:
        email, done = plan_user(q, at)
        if done is not None:
            empty.append((q.prefs.user_id, done))
        if email is not None:
            (now_ if email.kind == "now" else daily).append(email)
    wanted = [*now_, *daily]
    fit = wanted[:max(budget, 0)]
    return Plan(tuple(fit), tuple(empty), len(wanted) - len(fit))


# --- sending ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    html: str
    text: str
    headers: dict[str, str]
    # The same key twice within a day is sent once (a crash between sending
    # and recording can't send a second copy).
    idempotency_key: str


class MailRefused(Exception):
    """The provider says this one message is wrong (a bad address, say):
    asking again won't help."""

    def __init__(self, status: int) -> None:
        super().__init__(f"refused ({status})")
        self.status = status


class MailLater(Exception):
    """Anything else: the provider is busy or unreachable, or it refuses the
    key or the sending domain. The alerts stay unsent and a later run tries
    again, so fixing the setup loses nothing."""


class Mailer(Protocol):
    def send(self, message: Message) -> str:
        """Hand one message to the provider; its id for it. Blocking."""


class Resend:
    """Resend's HTTP API. Logs never carry the key, an address or a body."""

    def __init__(self, http: httpx.Client, api_key: str, sender: str, reply_to: str) -> None:
        self._http, self._key = http, api_key
        self._sender, self._reply_to = sender, reply_to

    def send(self, message: Message) -> str:
        body: dict[str, Any] = {
            "from": self._sender, "to": [message.to], "subject": message.subject,
            "html": message.html, "text": message.text, "headers": message.headers}
        if self._reply_to:
            body["reply_to"] = self._reply_to
        try:
            res = self._http.post(RESEND_URL, json=body, timeout=SEND_TIMEOUT_S, headers={
                "Authorization": f"Bearer {self._key}",
                "Idempotency-Key": message.idempotency_key})
        except httpx.HTTPError as exc:
            raise MailLater(type(exc).__name__) from exc
        if res.status_code in (400, 422):
            raise MailRefused(res.status_code)
        if res.status_code >= 300:
            raise MailLater(str(res.status_code))
        try:
            return str(res.json().get("id") or "")
        except ValueError:
            return ""


def build(settings: Settings, http: httpx.Client) -> Mailer | None:
    """The mailer, or None when email is off: no RESEND_API_KEY, or no
    HOLT_SECRET_KEY to make unsubscribe links with."""
    if not settings.resend_api_key or not settings.secret_key:
        return None
    return Resend(http, settings.resend_api_key, settings.alert_email_from,
                  settings.alert_email_reply_to)


# --- rendering --------------------------------------------------------------------------


def short_date(d: datetime | date) -> str:
    """"14 Oct"."""
    return f"{d.day} {d:%b}"


def status_line(access: alerts.Access, mode: str, at: datetime, tz: ZoneInfo) -> str:
    """The footer's first line: "Alerts until 14 Oct. Your turn right away,
    the rest at 8:00." Within a day of the end it says they stop."""
    how = MODE_LINE.get(mode, MODE_LINE["turn"])
    if access.until is None:
        return how
    day = short_date(access.until.astimezone(tz))
    if access.until - at <= timedelta(days=1):
        return f"Alerts stop on {day}. {how}"
    return f"Alerts until {day}. {how}"


def render(svc: Services, row: AlertSettings, access: alerts.Access, email: Email,
           found: list[Alert], at: datetime) -> Message:
    web = svc.settings.web_url.rstrip("/")
    tz = zone(row.tz)
    token = alerts.unsubscribe_token(svc.settings.secret_key, row.user_id,
                                     row.unsubscribe_nonce)
    frame = alert_email.EmailFrame(
        to=row.email or "", status=status_line(access, row.email_mode, at, tz),
        prs_url=f"{web}/me/contributions", settings_url=f"{web}/settings/alerts",
        unsubscribe_url=f"{web}/alerts/unsubscribe?t={token}", home_url=web)
    items = [alert_email.EmailAlert(
        line=alerts.line(a.kind, a.repo, a.number, a.facts), pr=f"{a.repo} #{a.number}",
        title=a.pr_title, pr_url=a.pr_url, report_url=f"{web}/{a.repo}",
        tone=alert_email.TONES.get(a.kind, "late")) for a in found]
    if all(a.kind in alerts.YOUR_TURN for a in found):
        out = alert_email.your_turn_email(items, frame)
    else:
        d = email.local_date
        out = alert_email.daily_email(items, frame, f"{d:%A} {d.day} {d:%B}")
    ids = ",".join(str(a.id) for a in found)
    return Message(
        to=row.email or "", subject=out.subject, html=out.html, text=out.text,
        headers={
            # One click, no sign-in (RFC 8058): the web app's route passes
            # the token on to POST /v1/alerts/unsubscribe.
            "List-Unsubscribe": f"<{web}/api/alerts/unsubscribe?t={token}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
        idempotency_key="holt-alerts-" + hashlib.sha256(
            f"{row.user_id}|{email.kind}|{ids}".encode()).hexdigest()[:40])


# --- one run ----------------------------------------------------------------------------


@dataclass
class Run:
    sent: int = 0
    failed: int = 0
    held: int = 0
    # Why nothing was tried: "off" (no mailer), or None.
    skipped: str | None = None


_said_off = False


async def sent_today(s, at: datetime) -> int:
    """Emails the provider took in the last 24 hours: alert emails and
    account emails (account_mail.py) share its daily limit."""
    since = at - timedelta(days=1)
    return sum([(await s.execute(select(func.count()).select_from(table).where(
        table.status == "sent", table.sent_at >= since))).scalar_one()
        for table in (AlertEmail, AccountEmail)])


async def _queues(s, svc: Services, at: datetime,
                  ) -> tuple[list[Queue], dict[str, tuple[AlertSettings, alerts.Access]]]:
    """Everyone who could get an email now, with what is waiting for them."""
    rows = (await s.execute(
        select(AlertSettings, User).select_from(AlertSettings)
        .join(User, User.id == AlertSettings.user_id)
        .where(AlertSettings.enabled.is_(True), AlertSettings.email_on.is_(True),
               AlertSettings.email.is_not(None)))).all()
    who: dict[str, tuple[AlertSettings, alerts.Access]] = {}
    for row, user in rows:
        access = alerts.access_for(svc, user, at)
        if access.on:
            who[row.user_id] = (row, access)
    if not who:
        return [], who
    ids = list(who)
    waiting: dict[str, list[Pending]] = {u: [] for u in who}
    muted = {(u, k, n) for u, k, n in await s.execute(
        select(WatchMute.user_id, WatchMute.repo_key, WatchMute.number)
        .where(WatchMute.user_id.in_(ids)))}
    for a in (await s.execute(
            select(Alert).where(Alert.user_id.in_(ids), Alert.emailed_at.is_(None),
                                Alert.created_at >= at - DAILY_WINDOW)
            .order_by(Alert.id))).scalars():
        if (a.user_id, a.repo_key, a.number) not in muted:
            waiting[a.user_id].append(
                Pending(a.id, a.kind, (a.repo_key, a.number), utc(a.created_at)))
    emailed: dict[str, set[tuple[str, int]]] = {u: set() for u in who}
    for user_id, key, number in await s.execute(
            select(Alert.user_id, Alert.repo_key, Alert.number)
            .where(Alert.user_id.in_(ids), Alert.email_via == "now",
                   Alert.emailed_at >= at - PER_PR)):
        emailed[user_id].add((key, number))
    queues = [Queue(Prefs(u, row.email_on, row.email_mode, row.tz, row.last_daily_on),
                    tuple(waiting[u]), frozenset(emailed[u]))
              for u, (row, _) in who.items()]
    return queues, who


async def run(svc: Services, at: datetime | None = None) -> Run:
    """One mailer run: plan, send, record. Without a mailer it does nothing,
    and says so in the log once."""
    global _said_off
    if svc.mailer is None:
        if not _said_off:
            _said_off = True
            log.info("alert emails are off: RESEND_API_KEY (or HOLT_SECRET_KEY) isn't set. "
                     "Alerts still reach the bell.")
        return Run(skipped="off")
    at = at or now()
    out = Run()
    async with svc.db.session() as s:
        queues, who = await _queues(s, svc, at)
        budget = (svc.settings.alert_email_daily_limit - LIMIT_MARGIN
                  - await sent_today(s, at))
        todo = plan(queues, at, budget)
        for user_id, day in todo.daily_empty:
            await s.execute(update(AlertSettings).where(AlertSettings.user_id == user_id)
                            .values(last_daily_on=day))
        await s.commit()
    out.held = todo.held
    if todo.held:
        log.warning("alert emails: %d held back, the provider's daily limit (%d) is near",
                    todo.held, svc.settings.alert_email_daily_limit)
    trouble = 0
    for email in todo.emails:
        row, access = who[email.user_id]
        try:
            ok = await _send(svc, row, access, email, at)
        except MailLater as exc:
            log.warning("alert emails: the provider didn't take one (%s); it is tried "
                        "again next run", exc)
            out.failed += 1
            trouble += 1
            if trouble >= MAX_TROUBLE:  # busy or down: the rest would go the same way
                break
            continue
        except Exception:  # noqa: BLE001 -- one person's email never blocks the others
            log.exception("alert emails: sending one failed")
            out.failed += 1
            continue
        out.sent += ok is True
        out.failed += ok is False
    return out


async def _send(svc: Services, row: AlertSettings, access: alerts.Access, email: Email,
                at: datetime) -> bool | None:
    """Send one email and record it. False when the provider refused it for
    good (its alerts are marked `failed` and stay on the bell); None when
    there was nothing left to send."""
    async with svc.db.session() as s:
        found = list((await s.execute(
            select(Alert).where(Alert.id.in_(email.alert_ids), Alert.emailed_at.is_(None))
            .order_by(Alert.id))).scalars())
        if not found:
            return None
        # The token comes from HOLT_SECRET_KEY: if that was rotated, the
        # stored hash is brought in step so this email's link works.
        current = alerts.token_hash(alerts.unsubscribe_token(
            svc.settings.secret_key, row.user_id, row.unsubscribe_nonce))
        if current != row.unsubscribe_hash:
            await s.execute(update(AlertSettings).where(AlertSettings.user_id == row.user_id)
                            .values(unsubscribe_hash=current))
            await s.commit()
            row.unsubscribe_hash = current
    message = render(svc, row, access, email, found, at)
    provider_id, status = None, "sent"
    try:
        provider_id = await asyncio.to_thread(svc.mailer.send, message)
    except MailRefused as exc:
        log.warning("alert emails: the provider refused one (%d)", exc.status)
        provider_id, status = str(exc.status), "failed"
    ids = [a.id for a in found]
    async with svc.db.session() as s:
        await s.execute(update(Alert).where(Alert.id.in_(ids), Alert.emailed_at.is_(None))
                        .values(emailed_at=at,
                                email_via=email.kind if status == "sent" else "failed"))
        s.add(AlertEmail(user_id=email.user_id, kind=email.kind, alert_ids=ids,
                         provider_id=provider_id, status=status, sent_at=at))
        if email.kind == "daily":
            await s.execute(update(AlertSettings).where(AlertSettings.user_id == email.user_id)
                            .values(last_daily_on=email.local_date))
        await s.commit()
    return status == "sent"


async def run_once(svc: Services) -> Run | None:
    """One run; on Postgres only one process does it (None if another is)."""
    async with svc.db.advisory_lock(LOCK_ID) as got:
        return await run(svc) if got else None


async def schedule(svc: Services, first_delay_s: float = 90.0) -> None:
    """Every EVERY_S, in the API process, until cancelled."""
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            got = await run_once(svc)
            if got is not None and (got.sent or got.failed):
                log.info("alert emails: %d sent, %d failed", got.sent, got.failed)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- try again next time
            log.exception("the alert mailer failed")
        await asyncio.sleep(EVERY_S)


def main() -> int:
    from holt_server.services import Services
    from holt_server.settings import get_settings

    logging.basicConfig(level="INFO")

    async def go() -> Run | None:
        svc = Services(get_settings())
        try:
            return await run_once(svc)
        finally:
            svc.http.close()
            await svc.db.dispose()

    got = asyncio.run(go())
    if got is None:
        print("another process is sending")
    elif got.skipped:
        print("alert emails are off (no RESEND_API_KEY)")
    else:
        print(f"sent {got.sent}, failed {got.failed}, held back {got.held}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
