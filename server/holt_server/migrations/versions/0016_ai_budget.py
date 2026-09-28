"""ai_budget and ai_runs: the environment's hard cap on AI spend (budget.py).

New tables only, and the one `ai_budget` row the budget is counted in, so
the release before this one keeps working after the migration runs.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0016'
down_revision: str | Sequence[str] | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    budget = op.create_table('ai_budget',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('committed_micros', sa.BigInteger(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.bulk_insert(budget, [{'id': 1, 'committed_micros': 0}])
    op.create_table('ai_runs',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('job_id', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('reserved_micros', sa.BigInteger(), nullable=False),
    sa.Column('cost_micros', sa.BigInteger(), nullable=True),
    sa.Column('estimated', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('settled_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ai_runs_job', 'ai_runs', ['job_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_ai_runs_job', table_name='ai_runs')
    op.drop_table('ai_runs')
    op.drop_table('ai_budget')
