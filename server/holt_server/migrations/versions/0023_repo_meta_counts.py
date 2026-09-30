"""repo_meta: pull request and contributor counts, for the quick look on a
Discover card (open pull requests, all pull requests, people who committed).

Nullable columns only: the release before this one neither reads nor writes
them, and rows fill in as the warm pass reads each repository again.

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

COLUMNS = ('pull_requests', 'open_pull_requests', 'contributors')


def upgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name in COLUMNS:
            batch.add_column(sa.Column(name, sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name in reversed(COLUMNS):
            batch.drop_column(name)
