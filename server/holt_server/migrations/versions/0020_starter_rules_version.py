"""starter_cache.rules_version: the starter rules that picked each cached list.

A nullable column only. The release before this one never writes it, so its
rows read as NULL, which no rules version matches: the new release fetches
them again instead of serving a list older rules picked.

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0020'
down_revision: str | Sequence[str] | None = '0019'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('starter_cache', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rules_version', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('starter_cache', schema=None) as batch_op:
        batch_op.drop_column('rules_version')
