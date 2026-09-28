"""Tables and sessions.

Postgres in production (asyncpg); the tests use SQLite (aiosqlite), so column
types stay portable: JSON, strings, integers, timestamps. The schema comes
from the Alembic migrations in `migrations/` (see `migrate.py`), applied at
deploy and again, as a no-op, at startup. A change to a model here needs a
migration too; `python -m holt_server.migrate check` and the tests catch one
that is missing.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now() -> datetime:
    return datetime.now(UTC)


def utc(value: datetime | None) -> datetime | None:
    """SQLite hands timestamps back naive; they were written as UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def iso(value: datetime | None) -> str | None:
    value = utc(value)
    return value.isoformat().replace("+00:00", "Z") if value else None


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSON, list: JSON}


class User(Base):
    """Keyed by the id `web/` (Auth.js) uses. Created the first time we see it."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    # A plan name from the pricing catalogue (pricing.py). It lapses back to
    # free at `plan_expires_at` (NULL: until changed). Every change also
    # writes a `PlanEvent`.
    plan: Mapped[str] = mapped_column(String(40), default="free")
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                             nullable=True)
    # Free credits (welcome grant, weekly claim, admin gifts) this user can
    # still spend; purchased ones are `CreditLot`s. Every change also writes a
    # `CreditEvent`; the balance lives here so a spend is one guarded UPDATE.
    ai_credits: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # When the one-off welcome credits were given; NULL until the first visit.
    credits_granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                                nullable=True)
    # Starts the weekly claim clock (the welcome grant starts it too).
    last_claim_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                           nullable=True)
    # Retired: the monthly quota and the website's bring-your-own-key. Nothing
    # reads them; migration 0003 emptied the BYOK columns. They are dropped in a
    # later release, once no deployed release selects them.
    ai_used: Mapped[int] = mapped_column(Integer, default=0)
    ai_period: Mapped[str] = mapped_column(String(7), default="")
    byok_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    byok_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    byok_cipher: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CreditEvent(Base):
    """The credit ledger: one row per change to a balance. `amount` is signed.

    source: `free` (a change to `User.ai_credits`) or `purchased` (a change to
    the `CreditLot` in `lot_id`). Per user, the `free` rows sum to
    `ai_credits` and the `purchased` rows to the lots' `remaining`.

    kind: `grant` (welcome), `claim` (weekly), `purchase` (a pack), `adjust`
    (an admin, with `reason`), `spend` (a feature used, `feature` and usually
    `job_id` say which), `refund` (that use failed), `expire` (a lot's
    leftover at its expiry).
    """

    __tablename__ = "credit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The server default covers rows the release before sources inserts.
    source: Mapped[str] = mapped_column(String(20), default="free",
                                        server_default=text("'free'"))
    lot_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feature: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Who made an `adjust`, e.g. `cli`.
    actor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_credit_events_user", "user_id", "created_at"),)


class CreditLot(Base):
    """Purchased credits: one row per pack bought (or admin grant to the
    purchased pool). Spent soonest-expiring first, after free credits; an
    expired lot can't be spent and its leftover is written off as `expire`."""

    __tablename__ = "credit_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(200))
    # `pack` (bought) or `admin`.
    origin: Mapped[str] = mapped_column(String(20))
    pack_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The payment's id: the same payment can never add a second lot.
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)
    granted: Mapped[int] = mapped_column(Integer)
    remaining: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_credit_lots_user", "user_id", "remaining"),)


class PlanEvent(Base):
    """Every change to `User.plan` / `plan_expires_at`, and why."""

    __tablename__ = "plan_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(200))
    plan: Mapped[str] = mapped_column(String(40))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                        nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_plan_events_user", "user_id", "created_at"),)


class PlanUsage(Base):
    """Uses of a plan's monthly allowance: one counter per user, feature and
    UTC month ("YYYY-MM"), raised by a guarded UPDATE."""

    __tablename__ = "plan_usage"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    feature: Mapped[str] = mapped_column(String(40), primary_key=True)
    period: Mapped[str] = mapped_column(String(7), primary_key=True)
    used: Mapped[int] = mapped_column(Integer, default=0)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True,
                                    default=lambda: uuid.uuid4().hex)
    kind: Mapped[str] = mapped_column(String(20), default="analysis")  # analysis | find
    repo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    repo_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode: Mapped[str] = mapped_column(String(10), default="rules")
    days: Mapped[int] = mapped_column(Integer, default=7)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    user_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Where the model key came from: "server" (retired: "byok").
    key_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # An AI credit was spent on this job (refunded if it fails).
    charged: Mapped[bool] = mapped_column(Boolean, default=False)
    # Identical questions share a job: at most one queued/running job per key,
    # enforced by the partial unique index below, not by a read-then-insert.
    dedupe_key: Mapped[str | None] = mapped_column(String(260), nullable=True)
    # Lower runs first. User requests are 0; badge refreshes are BADGE_PRIORITY.
    priority: Mapped[int] = mapped_column(Integer, default=0)
    # The runner that claimed the job, and when it last said it was alive. A
    # `running` job whose heartbeat is stale belonged to a dead process.
    worker_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                          nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="queued")
    stage: Mapped[str] = mapped_column(String(80), default="Waiting to start")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_jobs_status_priority", "status", "priority", "created_at"),
        Index("ix_jobs_user_created", "user_id", "created_at"),
        Index("ux_jobs_active_dedupe", "dedupe_key", unique=True,
              postgresql_where=text("status IN ('queued', 'running')"),
              sqlite_where=text("status IN ('queued', 'running')")),
    )


BADGE_PRIORITY = 10
ACTIVE = ("queued", "running")


def dedupe_key(repo_key: str, mode: str, days: int) -> str:
    return f"analysis:{repo_key}:{mode}:{days}"


class Report(Base):
    """Every finished report, newest wins. The 24h cache and the public pages."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo: Mapped[str] = mapped_column(String(200))
    repo_key: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(10))
    days: Mapped[int] = mapped_column(Integer)
    report: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_reports_lookup", "repo_key", "mode", "days", "created_at"),)


class Database:
    def __init__(self, url: str) -> None:
        kwargs = {}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            kwargs.update(pool_size=5, max_overflow=5, pool_pre_ping=True)
        self.engine: AsyncEngine = create_async_engine(url, **kwargs)
        self.session = async_sessionmaker(self.engine, expire_on_commit=False)

    async def migrate(self) -> None:
        """Bring the schema up to date (see `holt_server.migrate`)."""
        from holt_server.migrate import upgrade

        async with self.engine.begin() as conn:
            await conn.run_sync(upgrade)

    async def ping(self) -> bool:
        try:
            async with self.engine.connect() as conn:
                await conn.execute(text("select 1"))
            return True
        except Exception:
            return False

    async def dispose(self) -> None:
        await self.engine.dispose()


class FindCache(Base):
    """Finished `/v1/find` results by profile, so a repeated search is instant."""

    __tablename__ = "find_cache"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    params: Mapped[dict] = mapped_column(JSON)
    results: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def find_key(languages: list[str], topics: list[str], hacktoberfest: bool, days: int) -> str:
    """Same search, same key: case, order and duplicates don't matter."""
    langs = ",".join(sorted({x.strip().lower() for x in languages if x.strip()}))
    tops = ",".join(sorted({x.strip().lower() for x in topics if x.strip()}))
    return f"l={langs};t={tops};h={int(bool(hacktoberfest))};d={days}"[:300]


class StarterCache(Base):
    """Starter issues per repository, so a report page view costs no GitHub call."""

    __tablename__ = "starter_cache"

    repo_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    repo: Mapped[str] = mapped_column(String(200))
    issues: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    """"Was this verdict right?" answers: one per person per report version.

    `report_id` is the report row the person was shown, so the answer stays
    tied to that exact version (and its verdict) after the repo is re-checked.
    `voter` is `user:<id>` when signed in, else `ip:<salted hash>`; the raw IP
    is never stored. See `holt_server.feedback`.
    """

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(Integer)
    repo: Mapped[str] = mapped_column(String(200))
    repo_key: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(10))
    days: Mapped[int] = mapped_column(Integer)
    # The report's own `generated_at`, and the verdict it showed.
    generated_at: Mapped[str] = mapped_column(String(40))
    verdict: Mapped[str] = mapped_column(String(40))
    vote: Mapped[str] = mapped_column(String(10))  # up | down
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voter: Mapped[str] = mapped_column(String(210))
    user_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (
        Index("ux_feedback_report_voter", "report_id", "voter", unique=True),
        Index("ix_feedback_updated", "updated_at"),
    )


class Usage(Base):
    """One row per analysis or search someone asked for, cached or not: the
    product numbers (deploy/prod/stats.sh). `who` is a hash of the user id or
    IP that changes every UTC day (usage.py), so it counts distinct people per
    day but can't be traced back or linked across days. Nothing else about
    the person is kept."""

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day: Mapped[str] = mapped_column(String(10))  # "YYYY-MM-DD", UTC
    kind: Mapped[str] = mapped_column(String(10))  # analysis | find
    who: Mapped[str] = mapped_column(String(32))
    signed_in: Mapped[bool] = mapped_column(Boolean, default=False)
    repo_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_usage_day_kind", "day", "kind"),)


class GitHubConnection(Base):
    """A Holt user's connected GitHub account (connections.py). Only public
    data about it is ever read, with the server's tokens, never the user's.
    Deleting the row (disconnect) also deletes the user's `repo_views`."""

    __tablename__ = "github_connections"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    login: Mapped[str] = mapped_column(String(100))
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # When they ticked "I'm 18 or older". Required to connect.
    adult_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # "Don't include me in statistics": leave them out of cross-user repo stats.
    stats_opt_out: Mapped[bool] = mapped_column(Boolean, default=False,
                                                server_default=text("false"))


class RepoView(Base):
    """Which report pages a connected user opened on Holt, one row per repo,
    so My Contributions can tell a PR opened soon after checking the repo here."""

    __tablename__ = "repo_views"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    repo_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    repo: Mapped[str] = mapped_column(String(200))
    first_viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    views: Mapped[int] = mapped_column(Integer, default=1)


class ContributionSync(Base):
    """When a connected user's public pull requests were last fetched
    (contributions.py). The refresh cooldown reads `fetched_at`."""

    __tablename__ = "contribution_syncs"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    # The login the pull requests were searched for.
    login: Mapped[str] = mapped_column(String(100))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # GitHub had more than we keep (the fetch stops at a fixed number).
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)


class Contribution(Base):
    """One public pull request a connected user opened, as GitHub last showed
    it. Replaced wholesale on every fetch; deleted on disconnect."""

    __tablename__ = "contributions"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    repo_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    number: Mapped[int] = mapped_column(Integer, primary_key=True)
    repo: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(String(500))
    state: Mapped[str] = mapped_column(String(10))  # open | merged | closed
    draft: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RepoMeta(Base):
    """What GitHub says about a repository Holt has a report for: the details
    a Discover card shows and filters on (discover.py). Filled by the warm
    pass, many repositories per GraphQL query; missing until then."""

    __tablename__ = "repo_meta"

    repo_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    # GitHub's casing, as it answered.
    repo: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str | None] = mapped_column(String(80), nullable=True)
    stars: Mapped[int] = mapped_column(Integer, default=0)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    fork: Mapped[bool] = mapped_column(Boolean, default=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Profile(Base):
    """What a signed-in user told us about themselves (profiles.py), so /find
    and /hacktoberfest start from it. Stated, never inferred."""

    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    languages: Mapped[list] = mapped_column(JSON, default=list)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    days: Mapped[int] = mapped_column(Integer, default=7)
    # code | docs | tests | design | translations
    contributions: Mapped[list] = mapped_column(JSON, default=list)
    # newcomer | experienced
    level: Mapped[str] = mapped_column(String(20), default="newcomer")
    # When they ticked "I'm 18 or older" here. Null when they had already
    # confirmed it by connecting GitHub.
    adult_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                                nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RepoUserStats(Base):
    """What connected Holt users' pull requests to one repository came to
    (repo_stats.py): counts only, never who. A row exists only while at least
    `repo_stats.MIN_PEOPLE` people who didn't opt out make up the numbers.
    Rebuilt by the daily contributions refresh; a user's repositories are
    rebuilt at once when they opt out or disconnect."""

    __tablename__ = "repo_user_stats"

    repo_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    people: Mapped[int] = mapped_column(Integer)
    pull_requests: Mapped[int] = mapped_column(Integer)
    merged: Mapped[int] = mapped_column(Integer)
    closed: Mapped[int] = mapped_column(Integer)
    waiting: Mapped[int] = mapped_column(Integer)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
