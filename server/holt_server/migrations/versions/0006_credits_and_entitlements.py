"""Credits and entitlements: purchased credit lots, ledger sources, plans.

Adds `source` (and lot, feature, reason, actor) to the `credit_events`
ledger; every existing row is a free credit, which the server default says.
Adds `credit_lots` (purchased credits), `plan_events` (plan changes),
`plan_usage` (monthly plan allowances) and `users.plan_expires_at`.

Only additions, each nullable or with a server default: the release before
this one keeps inserting users and ledger rows as it did.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0006'
down_revision: str | Sequence[str] | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('credit_lots',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('origin', sa.String(length=20), nullable=False),
    sa.Column('pack_id', sa.String(length=40), nullable=True),
    sa.Column('reference', sa.String(length=200), nullable=True),
    sa.Column('granted', sa.Integer(), nullable=False),
    sa.Column('remaining', sa.Integer(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('reference')
    )
    op.create_index('ix_credit_lots_user', 'credit_lots', ['user_id', 'remaining'],
                    unique=False)
    op.create_table('plan_events',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('plan', sa.String(length=40), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('actor', sa.String(length=200), nullable=True),
    sa.Column('reference', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_plan_events_user', 'plan_events', ['user_id', 'created_at'],
                    unique=False)
    op.create_table('plan_usage',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('feature', sa.String(length=40), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('used', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'feature', 'period')
    )
    with op.batch_alter_table('credit_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source', sa.String(length=20),
                                      server_default=sa.text("'free'"), nullable=False))
        batch_op.add_column(sa.Column('lot_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('feature', sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column('reason', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('actor', sa.String(length=200), nullable=True))
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_expires_at', sa.DateTime(timezone=True),
                                      nullable=True))
    # Every spend so far paid for an AI report.
    op.execute("UPDATE credit_events SET feature = 'ai_report' WHERE kind IN ('spend', 'refund')")


def downgrade() -> None:
    # Loses purchased credits, plan history and allowances. Nothing is on sale
    # yet; once it is, don't downgrade past this revision.
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('plan_expires_at')
    with op.batch_alter_table('credit_events', schema=None) as batch_op:
        batch_op.drop_column('actor')
        batch_op.drop_column('reason')
        batch_op.drop_column('feature')
        batch_op.drop_column('lot_id')
        batch_op.drop_column('source')
    op.drop_table('plan_usage')
    op.drop_index('ix_plan_events_user', table_name='plan_events')
    op.drop_table('plan_events')
    op.drop_index('ix_credit_lots_user', table_name='credit_lots')
    op.drop_table('credit_lots')
