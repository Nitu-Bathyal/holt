"""repo_user_stats: repository statistics from Holt users (repo_stats.py).

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0008'
down_revision: str | Sequence[str] | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('repo_user_stats',
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('people', sa.Integer(), nullable=False),
    sa.Column('pull_requests', sa.Integer(), nullable=False),
    sa.Column('merged', sa.Integer(), nullable=False),
    sa.Column('closed', sa.Integer(), nullable=False),
    sa.Column('waiting', sa.Integer(), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('repo_key')
    )


def downgrade() -> None:
    op.drop_table('repo_user_stats')
