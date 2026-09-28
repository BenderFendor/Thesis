from datetime import UTC, datetime

from app.services.rss_parser_rust_bindings import filter_gdelt_by_domain, parse_gdelt_csv

HEADER = (
    "GlobalEventID\tSQLDATE\tSOURCEURL\tDocumentIdentifier\tEventCode\t"
    "EventRootCode\tActor1Name\tActor1CountryCode\tActor2Name\t"
    "Actor2CountryCode\tAvgTone\tGoldsteinScale\n"
)


def test_parse_gdelt_csv_keeps_valid_rows_in_limit() -> None:
    content = HEADER + (
        "1\t20240923\thttps://www.example.org/a\tTitle A\t010\t01\tA\tUS\tB\tGB\t1.2\t2.0\n"
        "\t20240923\thttps://example.org/missing-id\tInvalid\t010\t01\tA\tUS\tB\tGB\t1.2\t2.0\n"
        "2\t20240924\thttps://example.org/b\tTitle B\t020\t02\tC\tFR\tD\tDE\t-1.0\t-2.0\n"
    )

    rows = parse_gdelt_csv(content, 1)

    assert len(rows) == 1
    assert rows[0]["gdelt_id"] == "1"
    assert rows[0]["source"] == "example.org"
    assert rows[0]["title"] == "Title A"
    assert rows[0]["published_at"] == datetime(2024, 9, 23, tzinfo=UTC)


def test_parse_gdelt_csv_uses_epoch_for_invalid_unicode_date() -> None:
    row = "1\tabcédef\thttps://example.org/a\tTitle A\t010\t01\tA\tUS\tB\tGB\t1.2\t2.0\n"

    rows = parse_gdelt_csv(HEADER + row, 1)

    assert rows[0]["published_at"] == datetime(1970, 1, 1, tzinfo=UTC)


def test_filter_gdelt_by_domain_is_case_insensitive() -> None:
    events = [
        {"gdelt_id": "1", "url": "https://www.Example.org/a", "title": "A"},
        {"gdelt_id": "2", "url": "https://other.org/b", "title": "B"},
    ]

    rows = filter_gdelt_by_domain(events, "EXAMPLE.ORG")

    assert rows == [
        {
            "gdelt_id": "1",
            "url": "https://www.Example.org/a",
            "title": "A",
            "domain": "Example.org",
        }
    ]
