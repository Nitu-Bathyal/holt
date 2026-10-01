"""contributions: where each open pull request stands (pr_state.py): its node
ID, whose turn it is, the project's first reply, the last activity and the
review decision.

Nullable columns only (turn has a server default): the release before this one
neither reads nor writes them, and its fetches leave them empty until the next.

Idempotent: staging's database got these columns under an earlier revision
number, so each is added only when missing and dropped only when present.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0026'
down_revision: str | Sequence[str] | None = '0025'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    sa.Column('node_id', sa.String(length=100), nullable=True),
    sa.Column('turn', sa.String(length=10), server_default='unknown', nullable=False),
    sa.Column('turn_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('first_reply_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('review_decision', sa.String(length=20), nullable=True),
)


def _existing() -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns('contributions')}


def upgrade() -> None:
    have = _existing()
    missing = [c for c in COLUMNS if c.name not in have]
    if not missing:
        return
    with op.batch_alter_table('contributions') as batch:
        for column in missing:
            batch.add_column(column)


def downgrade() -> None:
    have = _existing()
    present = [c.name for c in reversed(COLUMNS) if c.name in have]
    if not present:
        return
    with op.batch_alter_table('contributions') as batch:
        for name in present:
            batch.drop_column(name)
