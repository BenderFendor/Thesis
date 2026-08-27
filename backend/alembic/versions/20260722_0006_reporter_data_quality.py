"""Reporter data-quality columns: raw name, merge/split retirement, collective flag.

Adds the schema needed by the reporter coverage-quality audit fixes
(docs/agents/traces/reporter-coverage-quality-audit.md, recs 2-5):

- `raw_name`: the original, uncleaned name captured before Fix 5's
  normalization strips titles/emails/prefixes -- nothing is lost.
- `merged_into` / `retirement_reason` / `split_into`: reversible soft
  retirement. A losing duplicate-name row (Fix 3) gets `retirement_reason=
  'merged'` and `merged_into=<winner id>`. A composite multi-author row
  (Fix 2) gets `retirement_reason='split'` and `split_into=[<child ids>]`
  (one row can split 1 -> N, so `merged_into` alone doesn't fit). Retired
  rows are never deleted; FKs are re-pointed, not removed.
- `is_collective`: flags pure wire/agency rows (Fix 4: AP, Reuters, AFP,
  ...) so the Atlas projection and coverage denominator can exclude them
  without deleting anything.

Revision ID: 20260722_0006
Revises: 20260721_0005
Create Date: 2026-07-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260722_0006"
down_revision = "20260721_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add reporter data-quality columns, idempotent against a partial prior run.

    `reporters` is not one of the alembic-owned evidence-spine tables (see
    `app/models/evidence.py::EVIDENCE_SPINE_TABLES`) -- it is created ad hoc
    by `app.database`'s startup path, so disposable test databases that only
    run the evidence-spine migrations (e.g. the corpus-replay smoke test)
    never have it. Skip cleanly rather than erroring in that case; the ad
    hoc startup path adds any missing columns/tables itself once the app
    that owns `reporters` boots against that database.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "reporters" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("reporters")}

    if "raw_name" not in columns:
        op.add_column("reporters", sa.Column("raw_name", sa.Text(), nullable=True))
    if "merged_into" not in columns:
        op.add_column(
            "reporters",
            sa.Column(
                "merged_into",
                sa.Integer(),
                sa.ForeignKey("reporters.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index("ix_reporters_merged_into", "reporters", ["merged_into"])
    if "retirement_reason" not in columns:
        op.add_column("reporters", sa.Column("retirement_reason", sa.String(16), nullable=True))
        op.create_check_constraint(
            "ck_reporters_retirement_reason",
            "reporters",
            "retirement_reason IS NULL OR retirement_reason IN ('merged','split')",
        )
    if "split_into" not in columns:
        op.add_column("reporters", sa.Column("split_into", sa.JSON(), nullable=True))
    if "is_collective" not in columns:
        op.add_column(
            "reporters",
            sa.Column("is_collective", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("ix_reporters_is_collective", "reporters", ["is_collective"])
        op.alter_column("reporters", "is_collective", server_default=None)


def downgrade() -> None:
    """Drop the reporter data-quality columns."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "reporters" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("reporters")}

    if "is_collective" in columns:
        op.drop_index("ix_reporters_is_collective", table_name="reporters")
        op.drop_column("reporters", "is_collective")
    if "split_into" in columns:
        op.drop_column("reporters", "split_into")
    if "retirement_reason" in columns:
        op.drop_constraint("ck_reporters_retirement_reason", "reporters", type_="check")
        op.drop_column("reporters", "retirement_reason")
    if "merged_into" in columns:
        op.drop_index("ix_reporters_merged_into", table_name="reporters")
        op.drop_column("reporters", "merged_into")
    if "raw_name" in columns:
        op.drop_column("reporters", "raw_name")
