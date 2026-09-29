"""repo_meta: the report's "About this repo" (forks, open issues, licence,
homepage, language shares, created, default branch, fork of, the README's line).

Nullable columns only: the release before this one neither reads nor writes
them, and rows fill in as the warm pass reads each repository again.

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0021'
down_revision: str | Sequence[str] | None = '0020'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ('forks', sa.Integer()),
    ('open_issues', sa.Integer()),
    ('license', sa.String(length=80)),
    ('homepage', sa.String(length=500)),
    ('language_shares', sa.JSON()),
    ('created_at', sa.DateTime(timezone=True)),
    ('default_branch', sa.String(length=200)),
    ('fork_of', sa.String(length=200)),
    ('readme_line', sa.Text()),
)


def upgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name, type_ in COLUMNS:
            batch.add_column(sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        for name, _ in reversed(COLUMNS):
            batch.drop_column(name)
