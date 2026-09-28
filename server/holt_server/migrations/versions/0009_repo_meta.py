"""repo_meta: repository details for Discover (discover.py), filled by the warm pass.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0009'
down_revision: str | Sequence[str] | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('repo_meta',
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('language', sa.String(length=80), nullable=True),
    sa.Column('stars', sa.Integer(), nullable=False),
    sa.Column('topics', sa.JSON(), nullable=False),
    sa.Column('pushed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('fork', sa.Boolean(), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('repo_key')
    )


def downgrade() -> None:
    op.drop_table('repo_meta')
