"""repo_meta.languages: the main languages, primary first (github.main_languages).

A new column with a default; the release before this one never reads it and
its inserts get the default.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0018'
down_revision: str | Sequence[str] | None = '0017'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        batch.add_column(sa.Column('languages', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    with op.batch_alter_table('repo_meta') as batch:
        batch.drop_column('languages')
