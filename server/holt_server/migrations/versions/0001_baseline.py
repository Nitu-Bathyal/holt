"""Baseline: the schema production had when migrations started.

It is exactly what `create_all` made from the models at that point, which is
how production's tables were created. Databases made that way are stamped at
this revision by `holt_server.migrate` instead of running it.

Revision ID: 0001
Revises:
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0001'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('find_cache',
    sa.Column('key', sa.String(length=300), nullable=False),
    sa.Column('params', sa.JSON(), nullable=False),
    sa.Column('results', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('jobs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=True),
    sa.Column('repo_key', sa.String(length=200), nullable=True),
    sa.Column('mode', sa.String(length=10), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('params', sa.JSON(), nullable=False),
    sa.Column('user_id', sa.String(length=200), nullable=True),
    sa.Column('key_source', sa.String(length=10), nullable=True),
    sa.Column('charged', sa.Boolean(), nullable=False),
    sa.Column('dedupe_key', sa.String(length=260), nullable=True),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('worker_id', sa.String(length=40), nullable=True),
    sa.Column('heartbeat_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('stage', sa.String(length=80), nullable=False),
    sa.Column('progress', sa.Float(), nullable=False),
    sa.Column('result', sa.JSON(), nullable=True),
    sa.Column('error', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_jobs_status_priority', 'jobs', ['status', 'priority', 'created_at'], unique=False)
    op.create_index('ix_jobs_user_created', 'jobs', ['user_id', 'created_at'], unique=False)
    op.create_index('ux_jobs_active_dedupe', 'jobs', ['dedupe_key'], unique=True, postgresql_where=sa.text("status IN ('queued', 'running')"), sqlite_where=sa.text("status IN ('queued', 'running')"))
    op.create_table('reports',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('mode', sa.String(length=10), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('report', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_reports_lookup', 'reports', ['repo_key', 'mode', 'days', 'created_at'], unique=False)
    op.create_table('starter_cache',
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('issues', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('repo_key')
    )
    op.create_table('users',
    sa.Column('id', sa.String(length=200), nullable=False),
    sa.Column('plan', sa.String(length=40), nullable=False),
    sa.Column('ai_used', sa.Integer(), nullable=False),
    sa.Column('ai_period', sa.String(length=7), nullable=False),
    sa.Column('byok_provider', sa.String(length=40), nullable=True),
    sa.Column('byok_model', sa.String(length=200), nullable=True),
    sa.Column('byok_cipher', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('users')
    op.drop_table('starter_cache')
    op.drop_index('ix_reports_lookup', table_name='reports')
    op.drop_table('reports')
    op.drop_index('ux_jobs_active_dedupe', table_name='jobs', postgresql_where=sa.text("status IN ('queued', 'running')"), sqlite_where=sa.text("status IN ('queued', 'running')"))
    op.drop_index('ix_jobs_user_created', table_name='jobs')
    op.drop_index('ix_jobs_status_priority', table_name='jobs')
    op.drop_table('jobs')
    op.drop_table('find_cache')
