"""repo_meta: the top of the repository's README (Markdown, at most about 6,000
characters), for the report's README section.

A nullable column only: the release before this one neither reads nor writes
it, and rows fill in as the warm pass reads each repository again.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0027'
down_revision: str | Sequence[str] | None = '0026'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        batch.add_column(sa.Column('readme', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        batch.drop_column('readme')
