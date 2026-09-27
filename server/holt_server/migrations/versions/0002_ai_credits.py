"""AI credits replace the monthly quota; the website's saved API keys are deleted.

Adds the credit balance and claim clock to `users` and the `credit_events`
ledger. Empties the BYOK columns (the encrypted keys are gone for good), but
keeps the columns: the release before this one still selects them, and a
deploy migrates before it swaps containers. A later migration drops them.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | Sequence[str] | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('credit_events',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('job_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_credit_events_user', 'credit_events', ['user_id', 'created_at'],
                    unique=False)
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ai_credits', sa.Integer(), server_default=sa.text('0'),
                                      nullable=False))
        batch_op.add_column(sa.Column('credits_granted_at', sa.DateTime(timezone=True),
                                      nullable=True))
        batch_op.add_column(sa.Column('last_claim_at', sa.DateTime(timezone=True),
                                      nullable=True))
    op.execute("UPDATE users SET byok_provider = NULL, byok_model = NULL, byok_cipher = NULL")


def downgrade() -> None:
    # The deleted keys do not come back.
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('last_claim_at')
        batch_op.drop_column('credits_granted_at')
        batch_op.drop_column('ai_credits')
    op.drop_index('ix_credit_events_user', table_name='credit_events')
    op.drop_table('credit_events')
