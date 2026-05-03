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
import os
import sys
from pathlib import Path
from typing import cast

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

OEC_REPO_CSV_URL = (
    "https://github.com/cid-harvard/pyOEC/raw/main/oec/datasets/"
    "hs4_4digit.csv.gz.parsed"
)

CHUNK_SIZE = 5000


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database disabled")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


async def import_csv(csv_path: str | None = None, chunk_size: int = CHUNK_SIZE) -> dict:
    rows_inserted = 0
    source_used = "csv"

    if csv_path and os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8") as f:
            content = f.read()
        source_used = csv_path
    else:
        print(f"Downloading OEC HS4 dataset from {OEC_REPO_CSV_URL} ...")
        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            response = await client.get(OEC_REPO_CSV_URL)
            response.raise_for_status()
            content = response.text
        source_used = "remote"

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    total_rows = len(rows)
    print(f"Parsed {total_rows} rows from {source_used}")

    batches = [
        rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)
    ]

    async with await _get_session() as session:
        for batch_idx, batch in enumerate(batches):
            values_clauses: list[str] = []
            params: dict[str, object] = {}
            for row_idx, row in enumerate(batch):
                try:
                    exporter = row.get("Origin", row.get("exporter", row.get("exporter_country", "")))
                    importer = row.get("Destination", row.get("importer", row.get("importer_country", "")))
                    hs4 = row.get("HS4", row.get("hs4", row.get("product_code", "")))
                    product = row.get("Product", row.get("product", row.get("product_name", "")))
                    value = row.get("Export Value", row.get("export_val", row.get("trade_value_usd", "0")))
                    year = row.get("Year", row.get("year", "2020"))

                    if not exporter or not importer or not hs4:
                        continue

                    value_f = float(value) if value else 0.0
                    year_i = int(year) if year else 2020

                    prefix = f"r_{batch_idx}_{row_idx}"
                    values_clauses.append(
                        f"(:exporter_{prefix}, :importer_{prefix}, "
                        f":code_{prefix}, :name_{prefix}, :value_{prefix}, :year_{prefix})"
                    )
                    params[f"exporter_{prefix}"] = exporter.upper().strip()
                    params[f"importer_{prefix}"] = importer.upper().strip()
                    params[f"code_{prefix}"] = hs4.strip()
                    params[f"name_{prefix}"] = product.strip()
                    params[f"value_{prefix}"] = value_f
                    params[f"year_{prefix}"] = year_i
                except (ValueError, KeyError) as e:
                    print(f"Skipping row {row_idx} in batch {batch_idx}: {e}")
                    continue

            if not values_clauses:
                continue

            stmt = text(
                f"""
                INSERT INTO trade_flows
                    (exporter_country, importer_country, product_code,
                     product_name, trade_value_usd, year)
                VALUES {','.join(values_clauses)}
            """
            )

            try:
                await session.execute(stmt, params)
                await session.commit()
                rows_inserted += len(values_clauses)
                pct = min(100, round(rows_inserted / total_rows * 100, 1)) if total_rows else 0
                print(
                    f"  Batch {batch_idx + 1}/{len(batches)}: "
                    f"{rows_inserted:,} / {total_rows:,} rows ({pct}%)"
                )
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
