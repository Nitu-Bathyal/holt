"""preflights: finished PR pre-flight checks per user, target and head commit (preflight.py).

A new table only, so the release before this one keeps working after the
migration runs.

Revision ID: 0012
Revises: 0010
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0012'
down_revision: str | Sequence[str] | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('preflights',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('target', sa.String(length=300), nullable=False),
    sa.Column('head_sha', sa.String(length=64), nullable=False),
    sa.Column('result', sa.JSON(), nullable=False),
    sa.Column('job_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_preflights_target', 'preflights',
                    ['user_id', 'repo_key', 'target', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_preflights_target', table_name='preflights')
    op.drop_table('preflights')
