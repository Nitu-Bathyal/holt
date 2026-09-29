"""contribution_choices: a repository a user chose to count, or not, in their
contribution numbers (contributions.py).

A new table only; the release before this one never reads it.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0019'
down_revision: str | Sequence[str] | None = '0018'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('contribution_choices',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('counted', sa.Boolean(), nullable=False),
    sa.Column('chosen_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key')
    )


def downgrade() -> None:
    op.drop_table('contribution_choices')
