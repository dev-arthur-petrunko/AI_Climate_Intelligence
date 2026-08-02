"""initial climate_snapshots table

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "climate_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("captured_at", sa.DateTime(), nullable=True),
        sa.Column("metric", sa.String(length=64), nullable=True),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
    )
    op.create_index("ix_climate_snapshots_captured_at", "climate_snapshots", ["captured_at"])
    op.create_index("ix_climate_snapshots_metric", "climate_snapshots", ["metric"])


def downgrade() -> None:
    op.drop_index("ix_climate_snapshots_metric", table_name="climate_snapshots")
    op.drop_index("ix_climate_snapshots_captured_at", table_name="climate_snapshots")
    op.drop_table("climate_snapshots")
