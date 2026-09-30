"""contributions: where each open pull request stands (pr_state.py): its node
ID, whose turn it is, the project's first reply, the last activity and the
review decision.

Nullable columns only (turn has a server default): the release before this one
neither reads nor writes them, and its fetches leave them empty until the next.

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0024'
down_revision: str | Sequence[str] | None = '0023'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('contributions') as batch:
        batch.add_column(sa.Column('node_id', sa.String(length=100), nullable=True))
        batch.add_column(sa.Column('turn', sa.String(length=10), server_default='unknown',
                                   nullable=False))
        batch.add_column(sa.Column('turn_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('first_reply_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('last_activity_at', sa.DateTime(timezone=True),
                                   nullable=True))
        batch.add_column(sa.Column('review_decision', sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('contributions') as batch:
        for name in ('review_decision', 'last_activity_at', 'first_reply_at', 'turn_at',
                     'turn', 'node_id'):
            batch.drop_column(name)
