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
    "https://raw.githubusercontent.com/datasets/commodity-prices/main/data/commodity-prices.csv"
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
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y-%m",
    "%Y",
    "%m/%d/%Y",
    "%Y/%m/%d",
)


def _parse_date(value: str) -> str | None:
    value = value.strip()
    if not any(pattern.match(value) for pattern in _DATE_PATTERNS):
        return None
    for date_format in _DATE_FORMATS:
        try:
            dt = datetime.strptime(value, date_format)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


async def _load_csv_content(csv_path: str | None) -> tuple[str, str]:
    if csv_path and Path(csv_path).exists():
        return Path(csv_path).read_text(encoding="utf-8"), csv_path
    print(f"Downloading UNCTAD commodity prices from {UNCTAD_COMMODITY_URL} ...")
    async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
        response = await client.get(UNCTAD_COMMODITY_URL)
        response.raise_for_status()
        return response.text, "remote"


def _prepare_batch_params(
    batch: list[dict[str, str]], column_map: dict[str, str]
) -> list[dict[str, object]]:
    source_column = column_map.get("source")
    return [
        params
        for row in batch
        if (params := _prepare_row_params(row, column_map, source_column)) is not None
    ]


def _required_row_values(
    row: dict[str, str], column_map: dict[str, str]
) -> tuple[str, str, str] | None:
    commodity = row.get(column_map.get("commodity", ""), "").strip()
    price = row.get(column_map.get("price", ""), "").strip()
    date_value = row.get(column_map.get("date", ""), "").strip()
    if not all((commodity, price, date_value)):
        return None
    return commodity, price, date_value


def _source_value(row: dict[str, str], source_column: str | None) -> str:
    if source_column is None:
        return "UNCTAD"
    return row.get(source_column, "").strip() or "UNCTAD"


def _prepare_row_params(
    row: dict[str, str], column_map: dict[str, str], source_column: str | None
) -> dict[str, object] | None:
    try:
        values = _required_row_values(row, column_map)
        if values is None:
            return None
        commodity, price, date_value = values
        parsed_date = _parse_date(date_value)
        if parsed_date is None:
            return None
        return {
            "commodity": commodity[:255],
            "price": float(price),
            "date_val": parsed_date,
            "source_val": _source_value(row, source_column),
        }
    except (ValueError, KeyError):
        return None


async def _insert_batch(
    session: AsyncSession, params_list: list[dict[str, object]], batch_number: int
) -> tuple[int, bool]:
    rows_inserted = 0
    for params in params_list:
        try:
            result = await session.execute(text(_DUPLICATE_FILTER_SQL), params)
            rows_inserted += max(result.rowcount or 0, 0)
        except Exception:
            continue
    try:
        await session.commit()
    except Exception as error:
        await session.rollback()
        print(f"  Batch {batch_number} commit failed: {error}")
        return 0, False
    return rows_inserted, True


def _print_batch_progress(
    batch_number: int, batch_count: int, rows_inserted: int, total_rows: int
) -> None:
    pct = min(100, round(rows_inserted / total_rows * 100, 1)) if total_rows else 0
    print(f"  Batch {batch_number}/{batch_count}: {rows_inserted:,} / {total_rows:,} rows ({pct}%)")


async def _insert_csv_batches(
    session: AsyncSession,
    batches: list[list[dict[str, str]]],
    column_map: dict[str, str],
    total_rows: int,
) -> int:
    rows_inserted = 0
    for batch_idx, batch in enumerate(batches):
        params_list = _prepare_batch_params(batch, column_map)
        if not params_list:
            continue
        inserted, committed = await _insert_batch(session, params_list, batch_idx + 1)
        if not committed:
            continue
        rows_inserted += inserted
        _print_batch_progress(batch_idx + 1, len(batches), rows_inserted, total_rows)
    return rows_inserted


async def import_csv(
    csv_path: str | None = None, chunk_size: int = CHUNK_SIZE
) -> dict[str, object]:
    content, source_used = await _load_csv_content(csv_path)

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    total_rows = len(rows)
    print(f"Parsed {total_rows} rows from {source_used}")

    column_map = _infer_columns(reader.fieldnames or [])

    batches = [rows[i : i + chunk_size] for i in range(0, len(rows), chunk_size)]

    async with await _get_session() as session:
        rows_inserted = await _insert_csv_batches(session, batches, column_map, total_rows)

    return {"rows_inserted": rows_inserted, "source": source_used}


_COLUMN_ALIASES = {
    "commodity": {"commodity", "commodity_name", "commodityname", "name", "series"},
    "price": {"price", "price_usd", "value", "close", "index"},
    "date": {"date", "observation_date", "period", "month", "year"},
    "source": {"source", "provider"},
}


def _first_matching_field(fieldnames: list[str], fragment: str) -> str | None:
    return next((field for field in fieldnames if fragment in field.lower()), None)


def _find_exact_columns(fieldnames: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for field in fieldnames:
        normalized = field.lower().strip()
        for name, aliases in _COLUMN_ALIASES.items():
            if normalized in aliases:
                result[name] = field
                break
    return result


def _fill_named_fallbacks(fieldnames: list[str], result: dict[str, str]) -> None:
    for name, fragments in (
        ("commodity", ("commodity",)),
        ("price", ("price", "value")),
        ("date", ("date", "year", "period")),
    ):
        if name in result:
            continue
        for fragment in fragments:
            match = _first_matching_field(fieldnames, fragment)
            if match is not None:
                result[name] = match
                break


def _fill_position_fallbacks(fieldnames: list[str], result: dict[str, str]) -> None:
    for name, index in (("commodity", 0), ("price", 1), ("date", 2)):
        if name not in result and len(fieldnames) > index:
            result[name] = fieldnames[index]


def _infer_columns(fieldnames: list[str]) -> dict[str, str]:
    result = _find_exact_columns(fieldnames)
    _fill_named_fallbacks(fieldnames, result)
    _fill_position_fallbacks(fieldnames, result)
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
