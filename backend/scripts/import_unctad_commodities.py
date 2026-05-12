"""
Import UNCTADstat commodity price data into commodity_prices table.

Downloads UNCTADstat free market commodity price indices as CSV,
parses date columns, and inserts into commodity_prices.
Handles deduplication via (commodity_name, date) unique constraint.

Usage:
    cd backend && uv run python scripts/import_unctad_commodities.py [--csv-path /path/to/data.csv] [--chunk-size 5000]
"""

import argparse
import asyncio
import csv
import io
import os
import sys
import re
from datetime import datetime
from pathlib import Path
from typing import cast

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

UNCTAD_COMMODITY_URL = (
    "https://raw.githubusercontent.com/datasets/commodity-prices/main/data/"
    "commodity-prices.csv"
)

CHUNK_SIZE = 5000

_DUPLICATE_FILTER_SQL = """
INSERT INTO commodity_prices (commodity_name, price_usd, date, source)
VALUES (
    :commodity, :price, :date_val, :source_val
) ON CONFLICT DO NOTHING
"""


async def _get_session() -> AsyncSession:
    from app.database import AsyncSessionLocal

    if AsyncSessionLocal is None:
        raise RuntimeError("Database disabled")
    factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
    return factory()


_DATE_PATTERNS = [
    re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    re.compile(r"^\d{4}-\d{2}$"),
    re.compile(r"^\d{4}$"),
    re.compile(r"^\d{2}/\d{2}/\d{4}$"),
    re.compile(r"^\d{4}/\d{2}/\d{2}$"),
]


def _parse_date(value: str) -> str | None:
    value = value.strip()
    for pat in _DATE_PATTERNS:
        if pat.match(value):
            try:
                for fmt in (
                    "%Y-%m-%d",
                    "%Y-%m",
                    "%Y",
                    "%m/%d/%Y",
                    "%Y/%m/%d",
                ):
                    try:
                        dt = datetime.strptime(value, fmt)
                        return dt.strftime("%Y-%m-%d")
                    except ValueError:
                        continue
            except Exception:
                pass
    return None


async def import_csv(csv_path: str | None = None, chunk_size: int = CHUNK_SIZE) -> dict:
    rows_inserted = 0
    source_used = "csv"

    if csv_path and os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8") as f:
            content = f.read()
        source_used = csv_path
    else:
        print(f"Downloading UNCTAD commodity prices from {UNCTAD_COMMODITY_URL} ...")
        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            response = await client.get(UNCTAD_COMMODITY_URL)
            response.raise_for_status()
            content = response.text
        source_used = "remote"

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    total_rows = len(rows)
    print(f"Parsed {total_rows} rows from {source_used}")

    column_map = _infer_columns(reader.fieldnames or [])

    batches = [rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)]

    async with await _get_session() as session:
        for batch_idx, batch in enumerate(batches):
            params_list: list[dict[str, object]] = []
            for row in batch:
                try:
                    commodity = row.get(column_map.get("commodity", ""), "").strip()
                    price = row.get(column_map.get("price", ""), "").strip()
                    date_val = row.get(column_map.get("date", ""), "").strip()

                    if not commodity or not price or not date_val:
                        continue

                    price_f = float(price)
                    parsed_date = _parse_date(date_val)
                    if not parsed_date:
                        continue

                    source = "UNCTAD"
                    if len(column_map) > 3:
                        source_col = row.get(column_map.get("source", ""), "")
                        if source_col:
                            source = source_col.strip()

                    params_list.append(
                        {
                            "commodity": commodity[:255],
                            "price": price_f,
                            "date_val": parsed_date,
                            "source_val": source,
                        }
                    )
                except (ValueError, KeyError):
                    continue

            if not params_list:
                continue

            for params in params_list:
                try:
                    await session.execute(text(_DUPLICATE_FILTER_SQL), params)
                except Exception:
                    continue

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                print(f"  Batch {batch_idx + 1} commit failed: {e}")
                continue

            rows_inserted += len(params_list)
            pct = (
                min(100, round(rows_inserted / total_rows * 100, 1))
                if total_rows
                else 0
            )
            print(
                f"  Batch {batch_idx + 1}/{len(batches)}: "
                f"{rows_inserted:,} / {total_rows:,} rows ({pct}%)"
            )

    return {"rows_inserted": rows_inserted, "source": source_used}


def _infer_columns(fieldnames: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for fn in fieldnames:
        lower = fn.lower().strip()
        if lower in ("commodity", "commodity_name", "commodityname", "name", "series"):
            result["commodity"] = fn
        elif lower in ("price", "price_usd", "value", "close", "index"):
            result["price"] = fn
        elif lower in ("date", "observation_date", "period", "month", "year"):
            result["date"] = fn
        elif lower in ("source", "provider"):
            result["source"] = fn
    if "commodity" not in result:
        for fn in fieldnames:
            if "commodity" in fn.lower():
                result["commodity"] = fn
                break
    if "price" not in result:
        for fn in fieldnames:
            if "price" in fn.lower() or "value" in fn.lower():
                result["price"] = fn
                break
    if "date" not in result:
        for fn in fieldnames:
            if "date" in fn.lower() or "year" in fn.lower() or "period" in fn.lower():
                result["date"] = fn
                break
    if "commodity" not in result and fieldnames:
        result["commodity"] = fieldnames[0]
    if "price" not in result and len(fieldnames) > 1:
        result["price"] = fieldnames[1]
    if "date" not in result and len(fieldnames) > 2:
        result["date"] = fieldnames[2]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Import UNCTAD commodity prices")
    parser.add_argument("--csv-path", type=str, help="Path to local CSV file")
    parser.add_argument("--chunk-size", type=int, default=CHUNK_SIZE)
    args = parser.parse_args()

    result = asyncio.run(import_csv(csv_path=args.csv_path, chunk_size=args.chunk_size))
    print(f"Done. Inserted {result['rows_inserted']:,} rows from {result['source']}.")


if __name__ == "__main__":
    main()
