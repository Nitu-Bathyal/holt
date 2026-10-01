"""PR watch (alerts.py, watch.py, mailer.py): each user's alert settings, the
pull requests they muted, the alerts made for them and the emails sent; who
replied last on each open pull request; and when a user's free taste ends.

New tables, and nullable columns on `contributions` and `users`: the release
before this one neither reads nor writes any of them.

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0029'
down_revision: str | Sequence[str] | None = '0028'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('alert_settings',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('email_on', sa.Boolean(), nullable=False),
    sa.Column('email_mode', sa.String(length=10), nullable=False),
    sa.Column('last_daily_on', sa.Date(), nullable=True),
    sa.Column('tz', sa.String(length=64), nullable=False),
    sa.Column('unsubscribe_nonce', sa.String(length=32), nullable=False),
    sa.Column('unsubscribe_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('unsubscribe_hash')
    )
    op.create_table('watch_mutes',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('muted_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key', 'number')
    )
    op.create_table('alerts',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('pr_url', sa.String(length=500), nullable=False),
    sa.Column('pr_title', sa.Text(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('facts', sa.JSON(), nullable=False),
    sa.Column('dedupe_key', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('email_via', sa.String(length=10), nullable=True),
    sa.Column('emailed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key')
    )
    op.create_index('ix_alerts_user', 'alerts', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_alerts_unsent', 'alerts', ['emailed_at', 'created_at'], unique=False)
    op.create_table('alert_emails',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('alert_ids', sa.JSON(), nullable=False),
    sa.Column('provider_id', sa.String(length=200), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_alert_emails_sent', 'alert_emails', ['sent_at'], unique=False)
    op.create_index('ix_alert_emails_user', 'alert_emails', ['user_id', 'sent_at'], unique=False)
    with op.batch_alter_table('contributions') as batch:
        batch.add_column(sa.Column('reply_by', sa.String(length=100), nullable=True))
        batch.add_column(sa.Column('reply_kind', sa.String(length=10), nullable=True))
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('alerts_trial_ends_at', sa.DateTime(timezone=True),
                                   nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('alerts_trial_ends_at')
    with op.batch_alter_table('contributions') as batch:
        batch.drop_column('reply_kind')
        batch.drop_column('reply_by')
    op.drop_index('ix_alert_emails_user', table_name='alert_emails')
    op.drop_index('ix_alert_emails_sent', table_name='alert_emails')
    op.drop_table('alert_emails')
    op.drop_index('ix_alerts_unsent', table_name='alerts')
    op.drop_index('ix_alerts_user', table_name='alerts')
    op.drop_table('alerts')
    op.drop_table('watch_mutes')
    op.drop_table('alert_settings')
