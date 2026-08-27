"""Multi-author byline splitting (audit rec 2)."""

from __future__ import annotations

import pytest

from app.services.reporter_name_splitter import split_byline


@pytest.mark.parametrize(
    "raw, expected_authors, expected_agency",
    [
        (
            "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press",
            ["ALANNA DURKIN RICHER", "GENE JOHNSON"],
            "Associated Press",
        ),
        ("A and B", ["A", "B"], None),
        ("X, Y and Z", ["X", "Y", "Z"], None),
        ("John Smith and Jane Doe", ["John Smith", "Jane Doe"], None),
        (
            "STEVE PEOPLES and MATT BROWN, Associated Press",
            ["STEVE PEOPLES", "MATT BROWN"],
            "Associated Press",
        ),
        (
            "JENNIFER PELTZ and ED WHITE, Associated Press",
            ["JENNIFER PELTZ", "ED WHITE"],
            "Associated Press",
        ),
        ("Oliver Holmes, Anna Betts and agencies", ["Oliver Holmes", "Anna Betts"], "agencies"),
        ("Jane Reporter", ["Jane Reporter"], None),
    ],
)
def test_split_byline_multi_author_specimens(raw, expected_authors, expected_agency) -> None:
    result = split_byline(raw)
    assert result.authors == expected_authors
    assert result.agency_context == expected_agency


@pytest.mark.parametrize(
    "raw, expected_author, expected_agency",
    [
        ("Gene Johnson, Associated Press", "Gene Johnson", "Associated Press"),
        ("CHRISTOPHER RUGABER, Associated Press", "CHRISTOPHER RUGABER", "Associated Press"),
        ("Deborah Cole and agencies", "Deborah Cole", "agencies"),
    ],
)
def test_split_byline_single_author_with_agency_context_is_not_split(
    raw, expected_author, expected_agency
) -> None:
    result = split_byline(raw)
    assert result.authors == [expected_author]
    assert result.agency_context == expected_agency
    assert result.was_split is False


def test_split_byline_keeps_name_comma_title_intact() -> None:
    """'Name, Title' must not be treated as a second author."""
    result = split_byline("John Smith, Senior Correspondent")
    assert result.authors == ["John Smith, Senior Correspondent"]
    assert result.was_split is False


def test_split_byline_empty_and_blank_input() -> None:
    assert split_byline("").authors == []
    assert split_byline("   ").authors == []


def test_split_byline_no_delimiter_is_not_split() -> None:
    result = split_byline("Jane Reporter")
    assert result.was_split is False
    assert result.authors == ["Jane Reporter"]
