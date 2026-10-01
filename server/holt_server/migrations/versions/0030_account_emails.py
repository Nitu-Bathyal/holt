"""Account emails (account_mail.py): where each user's account emails go and
whether they want the optional ones, and the sent-log that makes each email
go out once.

Two new tables: the release before this one neither reads nor writes them.

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0030'
down_revision: str | Sequence[str] | None = '0029'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('account_mail',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('product_on', sa.Boolean(), nullable=False),
    sa.Column('welcome_due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('unsubscribe_nonce', sa.String(length=32), nullable=False),
    sa.Column('unsubscribe_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('unsubscribe_hash')
    )
    op.create_table('account_emails',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('key', sa.String(length=80), nullable=False),
    sa.Column('provider_id', sa.String(length=200), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'key', name='uq_account_emails_user_key')
    )
    op.create_index('ix_account_emails_sent', 'account_emails', ['sent_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_account_emails_sent', table_name='account_emails')
    op.drop_table('account_emails')
    op.drop_table('account_mail')
