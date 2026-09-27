"""Schema migrations: fresh databases, pre-migration databases, and drift.

Runs on SQLite, or on the Postgres in HOLT_TEST_DATABASE_URL (as CI does).
"""

from __future__ import annotations

import asyncio
import os

import pytest
from holt_server import migrate
from holt_server.db import Base, Database
from sqlalchemy import inspect, text


@pytest.fixture
def db(tmp_path, drop_everything):
    url = os.environ.get("HOLT_TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{tmp_path / 'm.db'}"
    database = Database(url)

    async def reset():
        await drop_everything(database.engine)
        await database.dispose()

    asyncio.run(reset())
    return database


# Each asyncio.run is its own event loop, and asyncpg connections can't move
# between loops: every step closes the pool it used.
def run(db: Database, fn):
    async def go():
        try:
            async with db.engine.begin() as conn:
                return await conn.run_sync(fn)
        finally:
            await db.dispose()
    return asyncio.run(go())


def upgrade(db: Database) -> None:
    async def go():
        try:
            await db.migrate()
        finally:
            await db.dispose()
    asyncio.run(go())


def revision(conn) -> str | None:
    return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def head() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(migrate.config()).get_current_head()


def test_fresh_database_migrates_to_head_matching_the_models(db):
    upgrade(db)
    assert run(db, revision) == head()
    assert run(db, migrate.differences) == []
    upgrade(db)  # a second run changes nothing
    assert run(db, revision) == head()


def test_create_all_database_is_stamped_and_keeps_its_rows(db):
    run(db, Base.metadata.create_all)
    run(db, lambda c: c.execute(text(
        "INSERT INTO users (id, plan, ai_used, ai_period, created_at) "
        "VALUES ('u1', 'free', 2, '2026-09', CURRENT_TIMESTAMP)")))
    upgrade(db)
    assert run(db, revision) == head()
    assert run(db, lambda c: c.execute(text("SELECT ai_used FROM users")).scalar()) == 2
    assert run(db, migrate.differences) == []


def test_partial_schema_without_history_is_refused(db):
    run(db, lambda c: Base.metadata.tables["users"].create(c))
    with pytest.raises(RuntimeError, match="some of the baseline tables"):
        upgrade(db)
    assert "alembic_version" not in run(db, lambda c: inspect(c).get_table_names())


def test_baseline_tables_are_the_models_tables():
    # A new model needs a new migration, not a bigger baseline.
    assert migrate.BASELINE_TABLES <= set(Base.metadata.tables)
