"""Regression tests for UNCTAD commodity-row parsing."""

from scripts.import_unctad_commodities import _parse_date, _prepare_batch_params


def test_parse_date_accepts_supported_formats_and_rejects_invalid_values() -> None:
    """Normalize supported source dates and reject unsupported values."""
    assert _parse_date("2024-02") == "2024-02-01"
    assert _parse_date("02/29/2024") == "2024-02-29"
    assert _parse_date("not-a-date") is None


def test_prepare_batch_params_keeps_valid_rows_and_defaults_source() -> None:
    """Convert valid CSV rows while skipping incomplete or invalid rows."""
    column_map = {
        "commodity": "Commodity",
        "price": "Price",
        "date": "Date",
    }
    rows = [
        {"Commodity": "Wheat", "Price": "123.4", "Date": "2024-02"},
        {"Commodity": "", "Price": "9.0", "Date": "2024-02-01"},
        {"Commodity": "Oil", "Price": "invalid", "Date": "2024-02-01"},
    ]

    assert _prepare_batch_params(rows, column_map) == [
        {
            "commodity": "Wheat",
            "price": 123.4,
            "date_val": "2024-02-01",
            "source_val": "UNCTAD",
        }
    ]
