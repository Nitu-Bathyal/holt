"""playbooks and playbook_unlocks: the paid "How to get merged here" playbook (playbook.py).

New tables only, so the release before this one keeps working after the
migration runs.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0011'
down_revision: str | Sequence[str] | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('playbooks',
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('repo', sa.String(length=200), nullable=False),
    sa.Column('playbook', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('repo_key')
    )
    op.create_table('playbook_unlocks',
    sa.Column('user_id', sa.String(length=200), nullable=False),
    sa.Column('repo_key', sa.String(length=200), nullable=False),
    sa.Column('paid', sa.JSON(), nullable=False),
    sa.Column('job_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id', 'repo_key')
    )
    op.create_index('ix_playbook_unlocks_job', 'playbook_unlocks', ['job_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_playbook_unlocks_job', table_name='playbook_unlocks')
    op.drop_table('playbook_unlocks')
    op.drop_table('playbooks')
