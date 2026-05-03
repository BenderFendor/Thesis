from __future__ import annotations

from typing import Any, Dict, List, Mapping, Protocol, cast

import rss_parser_rust


class RssParserRustProtocol(Protocol):
    def parse_feeds_parallel(
        self,
        sources: list[tuple[str, list[str]]],
        max_concurrent: int | None = None,
    ) -> Mapping[str, Any]: ...

    def extract_article_html(self, html: str) -> Mapping[str, Any]: ...

    def extract_og_image_html(self, html: str) -> Mapping[str, Any]: ...

    def text_similarity(self, text1: str, text2: str) -> float: ...

    def sentence_diff(self, text1: str, text2: str) -> Mapping[str, Any]: ...

    def deduplicate_article_groups(
        self,
        articles: list[tuple[str, str]],
        threshold: float | None = None,
        num_hashes: int | None = None,
    ) -> Mapping[str, List[str]]: ...

    def parse_gdelt_csv(
        self, content: str, limit: int
    ) -> list[dict[str, Any]]: ...

    def filter_gdelt_by_domain(
        self, events: list[dict[str, str]], domain: str
    ) -> list[dict[str, Any]]: ...

    def rank_articles(
        self,
        articles: list[dict[str, Any]],
        liked_article_ids: list[int],
        bookmarked_article_ids: list[int],
        favorite_source_ids: list[str],
    ) -> list[dict[str, Any]]: ...


RUST = cast(RssParserRustProtocol, rss_parser_rust)


def parse_feeds_parallel(
    sources: list[tuple[str, list[str]]],
    max_concurrent: int | None = None,
) -> Dict[str, Any]:
    return dict(RUST.parse_feeds_parallel(sources, max_concurrent))


def extract_article_html(html: str) -> Dict[str, Any]:
    return dict(RUST.extract_article_html(html))


def extract_og_image_html(html: str) -> Dict[str, Any]:
    return dict(RUST.extract_og_image_html(html))


def text_similarity(text1: str, text2: str) -> float:
    return float(RUST.text_similarity(text1, text2))


def sentence_diff(text1: str, text2: str) -> Dict[str, Any]:
    return dict(RUST.sentence_diff(text1, text2))


def deduplicate_article_groups(
    articles: list[tuple[str, str]],
    threshold: float | None = None,
    num_hashes: int | None = None,
) -> dict[str, set[str]]:
    payload = RUST.deduplicate_article_groups(articles, threshold, num_hashes)
    return {
        str(representative): {str(member) for member in members}
        for representative, members in payload.items()
    }


def parse_gdelt_csv(content: str, limit: int) -> list[dict[str, Any]]:
    return list(RUST.parse_gdelt_csv(content, limit))


def filter_gdelt_by_domain(
    events: list[dict[str, str]], domain: str
) -> list[dict[str, Any]]:
    return list(RUST.filter_gdelt_by_domain(events, domain))


def rank_articles(
    articles: list[dict[str, Any]],
    liked_article_ids: list[int] | None = None,
    bookmarked_article_ids: list[int] | None = None,
    favorite_source_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    return list(
        RUST.rank_articles(
            articles,
            liked_article_ids or [],
            bookmarked_article_ids or [],
            favorite_source_ids or [],
        )
    )
