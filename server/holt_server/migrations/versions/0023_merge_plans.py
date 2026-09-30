"""merge_plans: each user's latest merge plan per repository (merge_plan.py).

A new table only, so the release before this one keeps working after the
migration runs. The free merge plans need no schema: they are counted in
`plan_usage` under the period `total`.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0023'
down_revision: str | Sequence[str] | None = '0022'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('merge_plans',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('plan', sa.JSON(), nullable=False),
    sa.Column('job_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key')
    )


def downgrade() -> None:
    op.drop_table('merge_plans')
