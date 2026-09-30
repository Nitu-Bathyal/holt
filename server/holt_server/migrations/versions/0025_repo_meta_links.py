"""repo_meta: where a newcomer finds help (the contributing guide,
Discussions, the README's docs and chat links) and the latest release, for
the report's header.

Nullable columns only: the release before this one neither reads nor writes
them, and rows fill in as the warm pass reads each repository again.

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0025'
down_revision: str | Sequence[str] | None = '0024'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = ('links', 'latest_release')


def upgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name in COLUMNS:
            batch.add_column(sa.Column(name, sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name in reversed(COLUMNS):
            batch.drop_column(name)
