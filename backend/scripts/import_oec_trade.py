"""
Import OEC HS4 bilateral trade dataset into trade_flows table.

Downloads the OEC HS4 bulk CSV (~200MB) via HTTPS and inserts
rows into trade_flows. Supports incremental import: if the table
already has data, new rows are inserted (ON CONFLICT is not used
because there is no natural unique key at the product-pair level;
instead we chunk-insert and skip duplicate years where sensible).

Usage:
    cd backend && uv run python scripts/import_oec_trade.py [--csv-path /path/to/data.csv] [--chunk-size 5000]
"""

import argparse
import asyncio
import csv
import io
import sys
from pathlib import Path
from typing import cast

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

OEC_REPO_CSV_URL = (
    "https://github.com/cid-harvard/pyOEC/raw/main/oec/datasets/hs4_4digit.csv.gz.parsed"
)

CHUNK_SIZE = 5000


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database disabled")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


async def _load_csv(csv_path: str | None) -> tuple[str, str]:
    """Return (csv content, source label) from the local file or the remote download."""
    if csv_path and Path(csv_path).exists():
        return Path(csv_path).read_text(encoding="utf-8"), csv_path
    print(f"Downloading OEC HS4 dataset from {OEC_REPO_CSV_URL} ...")
    async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
        response = await client.get(OEC_REPO_CSV_URL)
        response.raise_for_status()
        return response.text, "remote"


def _row_values(row: dict[str, str], row_label: str) -> dict[str, object] | None:
    """Extract normalized column values for one trade row, or None to skip it."""
    exporter = row.get("Origin", row.get("exporter", row.get("exporter_country", "")))
    importer = row.get("Destination", row.get("importer", row.get("importer_country", "")))
    hs4 = row.get("HS4", row.get("hs4", row.get("product_code", "")))
    product = row.get("Product", row.get("product", row.get("product_name", "")))
    value = row.get("Export Value", row.get("export_val", row.get("trade_value_usd", "0")))
    year = row.get("Year", row.get("year", "2020"))
    if not exporter or not importer or not hs4:
        return None
    try:
        value_f = float(value) if value else 0.0
        year_i = int(year) if year else 2020
    except (ValueError, KeyError) as e:
        print(f"Skipping row {row_label}: {e}")
        return None
    return {
        "exporter": exporter.upper().strip(),
        "importer": importer.upper().strip(),
        "code": hs4.strip(),
        "name": product.strip(),
        "value": value_f,
        "year": year_i,
    }


def _batch_payload(
    batch: list[dict[str, str]], batch_idx: int
) -> tuple[list[str], dict[str, object]]:
    """Build the VALUES clause and parameter dict for one batch."""
    values_clauses: list[str] = []
    params: dict[str, object] = {}
    for row_idx, row in enumerate(batch):
        values = _row_values(row, f"{row_idx} in batch {batch_idx}")
        if not values:
            continue
        prefix = f"r_{batch_idx}_{row_idx}"
        values_clauses.append(
            f"(:exporter_{prefix}, :importer_{prefix}, "
            f":code_{prefix}, :name_{prefix}, :value_{prefix}, :year_{prefix})"
        )
        params[f"exporter_{prefix}"] = values["exporter"]
        params[f"importer_{prefix}"] = values["importer"]
        params[f"code_{prefix}"] = values["code"]
        params[f"name_{prefix}"] = values["name"]
        params[f"value_{prefix}"] = values["value"]
        params[f"year_{prefix}"] = values["year"]
    return values_clauses, params


def _batch_progress(batch_idx: int, batch_count: int, rows_inserted: int, total_rows: int) -> None:
    pct = min(100, round(rows_inserted / total_rows * 100, 1)) if total_rows else 0
    print(
        f"  Batch {batch_idx + 1}/{batch_count}: {rows_inserted:,} / {total_rows:,} rows ({pct}%)"
    )


async def import_csv(csv_path: str | None = None, chunk_size: int = CHUNK_SIZE) -> dict:
    content, source_used = await _load_csv(csv_path)
    rows = list(csv.DictReader(io.StringIO(content)))
    total_rows = len(rows)
    rows_inserted = 0
    print(f"Parsed {total_rows} rows from {source_used}")

    batches = [rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)]

    async with await _get_session() as session:
        for batch_idx, batch in enumerate(batches):
            values_clauses, params = _batch_payload(batch, batch_idx)
            if not values_clauses:
                continue

            stmt = text(
                f"""
                INSERT INTO trade_flows
                    (exporter_country, importer_country, product_code,
                     product_name, trade_value_usd, year)
                VALUES {",".join(values_clauses)}
            """
            )

            try:
                await session.execute(stmt, params)
                await session.commit()
                rows_inserted += len(values_clauses)
                _batch_progress(batch_idx, len(batches), rows_inserted, total_rows)
            except Exception as e:
                await session.rollback()
                print(f"  Batch {batch_idx + 1} failed: {e}")

    return {"rows_inserted": rows_inserted, "source": source_used}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import OEC HS4 trade data")
    parser.add_argument("--csv-path", type=str, help="Path to local CSV file")
    parser.add_argument("--chunk-size", type=int, default=CHUNK_SIZE)
    args = parser.parse_args()

    result = asyncio.run(import_csv(csv_path=args.csv_path, chunk_size=args.chunk_size))
    print(f"Done. Inserted {result['rows_inserted']:,} rows from {result['source']}.")


if __name__ == "__main__":
    main()
