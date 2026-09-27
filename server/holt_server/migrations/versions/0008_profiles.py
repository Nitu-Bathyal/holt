"""profiles: stated preferences that pre-fill find (profiles.py).

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0008'
down_revision: str | Sequence[str] | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('profiles',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('languages', sa.JSON(), nullable=False),
    sa.Column('topics', sa.JSON(), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('contributions', sa.JSON(), nullable=False),
    sa.Column('level', sa.String(length=20), nullable=False),
    sa.Column('adult_confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id')
    )


def downgrade() -> None:
    op.drop_table('profiles')
