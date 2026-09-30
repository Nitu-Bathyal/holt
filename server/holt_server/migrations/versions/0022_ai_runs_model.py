"""ai_runs.model: which model each AI run used, so models can be compared
offline. Internal only; no API field reads it.

Nullable: the release before this one neither reads nor writes it, and runs
settled before it stay NULL.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0022'
down_revision: str | Sequence[str] | None = '0021'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('ai_runs') as batch:
        batch.add_column(sa.Column('model', sa.String(length=200), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ai_runs') as batch:
        batch.drop_column('model')
