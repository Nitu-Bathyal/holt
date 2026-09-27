"""Alembic environment.

`holt_server.migrate` hands in an open connection (`config.attributes`). The
`alembic` CLI (from `server/`, with `server/alembic.ini`) does not, so then
this connects to `$DATABASE_URL` itself.
"""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection

from holt_server.db import Base

config = context.config
target_metadata = Base.metadata


def run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Autogenerate writes `op.batch_alter_table`: plain ALTERs on
        # Postgres, a table copy on SQLite (the tests), which can't ALTER most things.
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_from_url() -> None:
    from holt_server.db import Database
    from holt_server.settings import get_settings

    db = Database(get_settings().database_url)
    try:
        async with db.engine.begin() as conn:
            await conn.run_sync(run)
    finally:
        await db.dispose()


if context.is_offline_mode():
    raise SystemExit("offline (--sql) migrations are not supported; run against a database")

connection = config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    asyncio.run(run_from_url())
