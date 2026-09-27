"""github_connections and repo_views: Connect GitHub (connections.py).

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0005'
down_revision: str | Sequence[str] | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('github_connections',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('github_id', sa.BigInteger(), nullable=False),
    sa.Column('login', sa.String(length=100), nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('adult_confirmed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('stats_opt_out', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('github_id')
    )
    op.create_table('repo_views',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('first_viewed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_viewed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('views', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key')
    )


def downgrade() -> None:
    op.drop_table('repo_views')
    op.drop_table('github_connections')
