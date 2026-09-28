"""reports.engine_version: the engine version that made each report.

A nullable column only. The release before this one never writes it, so its
reports read as NULL, which counts as older than every version: the new
release re-runs them instead of serving them.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0015'
down_revision: str | Sequence[str] | None = '0014'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.add_column(sa.Column('engine_version', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.drop_column('engine_version')
