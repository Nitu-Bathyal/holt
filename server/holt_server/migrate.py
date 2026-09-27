"""Schema migrations (Alembic), run at deploy and at startup.

    python -m holt_server.migrate            # upgrade $DATABASE_URL to the latest schema
    python -m holt_server.migrate check      # exit 1 if the models and migrations disagree

The migration scripts live in `holt_server/migrations/` so they ship inside the
package (and the server image). `server/alembic.ini` points the `alembic` CLI
at the same place for writing new ones; see `server/README.md`.

A database made before migrations existed (by `create_all`) has the baseline
tables but no `alembic_version` table. `upgrade` stamps it at the baseline
first, without touching its tables, then applies whatever came after.
"""

from __future__ import annotations

import asyncio
import logging
import sys

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

log = logging.getLogger("holt_server.migrate")

BASELINE = "0001"
# Every table the baseline creates. A database with all of them and no
# alembic_version was made by create_all and is stamped; with only some of
# them it is in a state nobody planned for, and upgrade refuses to guess.
BASELINE_TABLES = frozenset({"users", "jobs", "reports", "find_cache", "starter_cache"})
# Held for the migration's transaction, so two processes starting at once
# (the API and a warm pass, say) take turns instead of racing.
LOCK_ID = 0x686F6C74  # "holt"


def config(connection: Connection | None = None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", "holt_server:migrations")
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def upgrade(connection: Connection) -> None:
    """Bring the schema to head. Sync: call it through `AsyncConnection.run_sync`."""
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": LOCK_ID})
    tables = set(inspect(connection).get_table_names())
    if "alembic_version" not in tables:
        found = tables & BASELINE_TABLES
        if found == BASELINE_TABLES:
            log.info("existing schema without migration history: stamping baseline %s", BASELINE)
            command.stamp(config(connection), BASELINE)
        elif found:
            raise RuntimeError(
                "the database has some of the baseline tables but not all "
                f"(missing: {', '.join(sorted(BASELINE_TABLES - found))}) and no "
                "migration history; fix it by hand before migrating"
            )
    before = MigrationContext.configure(connection).get_current_revision()
    head = ScriptDirectory.from_config(config()).get_current_head()
    if before != head:
        log.info("migrating the schema from %s to %s", before or "empty", head)
    command.upgrade(config(connection), "head")


def differences(connection: Connection) -> list:
    """What the models declare that the database lacks, or the reverse. Empty is good."""
    from holt_server.db import Base

    ctx = MigrationContext.configure(connection)
    return compare_metadata(ctx, Base.metadata)


async def _run(url: str, action: str) -> int:
    from holt_server.db import Database

    db = Database(url)
    try:
        async with db.engine.begin() as conn:
            if action == "upgrade":
                await conn.run_sync(upgrade)
                log.info("schema is up to date")
                return 0
            diff = await conn.run_sync(differences)
    finally:
        await db.dispose()
    for d in diff:
        print(d)
    return 1 if diff else 0


def main(argv: list[str] | None = None) -> int:
    from holt_server.settings import get_settings

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("alembic").setLevel(logging.WARNING)
    args = sys.argv[1:] if argv is None else argv
    action = args[0] if args else "upgrade"
    if action not in ("upgrade", "check"):
        print("usage: python -m holt_server.migrate [upgrade|check]", file=sys.stderr)
        return 2
    return asyncio.run(_run(get_settings().database_url, action))


if __name__ == "__main__":
    sys.exit(main())
