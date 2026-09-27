"""usage_events: one row per report request or search, for the product numbers.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | Sequence[str] | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('usage_events',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('day', sa.String(length=10), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('who', sa.String(length=32), nullable=False),
    sa.Column('signed_in', sa.Boolean(), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=True),
    sa.Column('mode', sa.String(length=10), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_usage_day_kind', 'usage_events', ['day', 'kind'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_usage_day_kind', table_name='usage_events')
    op.drop_table('usage_events')
