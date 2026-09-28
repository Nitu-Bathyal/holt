"""subscriptions and subscription_charges: monthly plans (subscriptions.py).

New tables only; the release before this one never reads them.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0012'
down_revision: str | Sequence[str] | None = '0011'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LIVE = "status IN ('created', 'authenticated', 'active', 'pending')"


def upgrade() -> None:
    op.create_table('subscriptions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('plan_id', sa.String(length=40), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('provider_subscription_id', sa.String(length=100), nullable=False),
    sa.Column('provider_plan_id', sa.String(length=100), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('current_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('current_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('charge_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_at_period_end', sa.Boolean(), server_default=sa.text('false'),
              nullable=False),
    sa.Column('granted_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('provider_subscription_id')
    )
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.create_index('ix_subscriptions_user', ['user_id', 'created_at'], unique=False)
        batch_op.create_index('ux_subscriptions_live_user', ['user_id'], unique=True,
                              postgresql_where=sa.text(LIVE), sqlite_where=sa.text(LIVE))

    op.create_table('subscription_charges',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('subscription_id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('provider_payment_id', sa.String(length=100), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('provider_payment_id')
    )
    with op.batch_alter_table('subscription_charges', schema=None) as batch_op:
        batch_op.create_index('ix_subscription_charges_user', ['user_id', 'created_at'],
                              unique=False)


def downgrade() -> None:
    # Loses billing history. Once subscriptions are on, don't downgrade past this.
    with op.batch_alter_table('subscription_charges', schema=None) as batch_op:
        batch_op.drop_index('ix_subscription_charges_user')
    op.drop_table('subscription_charges')
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.drop_index('ux_subscriptions_live_user', postgresql_where=sa.text(LIVE),
                            sqlite_where=sa.text(LIVE))
        batch_op.drop_index('ix_subscriptions_user')
    op.drop_table('subscriptions')
