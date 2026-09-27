"""orders: credit-pack checkouts (payments.py).

A new table only; the release before this one never reads it.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0009'
down_revision: str | Sequence[str] | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('orders',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('pack_id', sa.String(length=40), nullable=False),
    sa.Column('credits', sa.Integer(), nullable=False),
    sa.Column('expires_days', sa.Integer(), nullable=True),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('provider_order_id', sa.String(length=100), nullable=False),
    sa.Column('provider_payment_id', sa.String(length=100), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('lot_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('provider_order_id'),
    sa.UniqueConstraint('provider_payment_id')
    )
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.create_index('ix_orders_user', ['user_id', 'created_at'], unique=False)


def downgrade() -> None:
    # Loses purchase history. Once payments are on, don't downgrade past this.
    with op.batch_alter_table('orders', schema=None) as batch_op:
        batch_op.drop_index('ix_orders_user')
    op.drop_table('orders')
