"""Add the feedback table ("Was this verdict right?" answers).

A new table only, so the previous release runs unchanged on this schema.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0004'
down_revision: str | Sequence[str] | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('feedback',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('report_id', sa.Integer(), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('mode', sa.String(length=10), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('generated_at', sa.String(length=40), nullable=False),
    sa.Column('verdict', sa.String(length=40), nullable=False),
    sa.Column('vote', sa.String(length=10), nullable=False),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('voter', sa.String(length=210), nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=True),
    sa.Column('ip_hash', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('feedback', schema=None) as batch_op:
        batch_op.create_index('ix_feedback_updated', ['updated_at'], unique=False)
        batch_op.create_index('ux_feedback_report_voter', ['report_id', 'voter'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('feedback', schema=None) as batch_op:
        batch_op.drop_index('ux_feedback_report_voter')
        batch_op.drop_index('ix_feedback_updated')
    op.drop_table('feedback')
