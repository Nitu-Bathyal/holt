"""contribution_syncs and contributions: My Contributions (contributions.py).

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0006'
down_revision: str | Sequence[str] | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('contribution_syncs',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('login', sa.String(length=100), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('truncated', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('contributions',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('state', sa.String(length=10), nullable=False),
    sa.Column('draft', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('merged_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('user_id', 'repo_key', 'number')
    )


def downgrade() -> None:
    op.drop_table('contributions')
    op.drop_table('contribution_syncs')
