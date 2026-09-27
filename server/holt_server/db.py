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
    plan: Mapped[str] = mapped_column(String(40), default="free")
    # AI reports this user can still run. Every change also writes a
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
    """The AI-credit ledger: one row per change to `User.ai_credits`.

    kind: `grant` (welcome), `claim` (weekly), `spend` (an AI report queued),
    `refund` (that report failed). `amount` is signed. Purchases can be new kinds.
    """

    __tablename__ = "credit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    __table_args__ = (Index("ix_credit_events_user", "user_id", "created_at"),)


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
