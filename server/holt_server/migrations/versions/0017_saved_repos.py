"""saved_repos: repositories a signed-in user saved for later (saved.py).

A new table only; the release before this one never reads it.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0017'
down_revision: str | Sequence[str] | None = '0016'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('saved_repos',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('saved_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key')
    )
    op.create_index('ix_saved_repos_user', 'saved_repos', ['user_id', 'saved_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_saved_repos_user', table_name='saved_repos')
    op.drop_table('saved_repos')
