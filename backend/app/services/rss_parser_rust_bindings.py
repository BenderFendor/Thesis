from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Mapping, Protocol, Sequence, cast

os.environ.setdefault(
    "RSS_PARSER_DATA_DIR",
    str(Path(__file__).resolve().parents[1] / "data"),
)

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

    def parse_gdelt_csv(self, content: str, limit: int) -> list[dict[str, Any]]: ...

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

    # Topic clustering
    def rust_lexical_cluster(
        self, articles: list[tuple[int, str, int]]
    ) -> list[dict[str, Any]]: ...

    def rust_extract_keywords(self, title: str) -> list[str]: ...

    def rust_extract_keywords_from_titles(self, titles: list[str]) -> list[str]: ...

    def rust_generate_cluster_label(
        self, title_scores: list[tuple[str, float]]
    ) -> str: ...

    # Blindspot vector math
    def rust_mean_vector(self, vectors: list[list[float]]) -> list[float]: ...

    def rust_subtract_vectors(
        self, left: list[float], right: list[float]
    ) -> list[float]: ...

    def rust_normalize_vector(self, vector: list[float]) -> list[float]: ...

    def rust_dot_product(self, left: list[float], right: list[float]) -> float: ...

    def rust_cosine_similarity(
        self, left: list[float], right: list[float]
    ) -> float: ...

    def rust_quantile(self, values: list[float], percentile: float) -> float: ...

    def rust_build_semaxis(
        self,
        positive_vectors: list[list[float]],
        negative_vectors: list[list[float]],
    ) -> list[float] | None: ...

    def rust_score_against_axis(
        self,
        article_vectors: list[tuple[int, list[float]]],
        axis: list[float],
    ) -> list[tuple[int, float]]: ...

    # Country mentions
    def rust_extract_mentioned_countries(self, text: str) -> list[str]: ...

    def rust_build_article_text(
        self,
        title: str | None,
        summary: str | None,
        content: str | None,
    ) -> str: ...

    def rust_extract_article_mentioned_countries(
        self,
        title: str | None,
        summary: str | None,
        content: str | None,
    ) -> list[str]: ...

    def rust_reload_country_aliases(
        self,
    ) -> dict[str, Any]: ...


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


# --- Topic clustering helpers ---


def lexical_cluster(
    articles: list[tuple[int, str, int]],
) -> list[dict[str, Any]]:
    return list(RUST.rust_lexical_cluster(articles))


def extract_keywords_rust(title: str) -> list[str]:
    return list(RUST.rust_extract_keywords(title))


def extract_keywords_from_titles_rust(titles: list[str]) -> list[str]:
    return list(RUST.rust_extract_keywords_from_titles(titles))


def generate_cluster_label_rust(
    title_scores: list[tuple[str, float]],
) -> str:
    return str(RUST.rust_generate_cluster_label(title_scores))


# --- Blindspot vector math helpers ---


def mean_vector_rust(vectors: list[list[float]]) -> list[float]:
    result = RUST.rust_mean_vector(vectors)
    return list(cast(Sequence[float], result))


def subtract_vectors_rust(left: list[float], right: list[float]) -> list[float]:
    result = RUST.rust_subtract_vectors(left, right)
    return list(cast(Sequence[float], result))


def normalize_vector_rust(vector: list[float]) -> list[float]:
    result = RUST.rust_normalize_vector(vector)
    return list(cast(Sequence[float], result))


def dot_product_rust(left: list[float], right: list[float]) -> float:
    return float(RUST.rust_dot_product(left, right))


def cosine_similarity_rust(left: list[float], right: list[float]) -> float:
    return float(RUST.rust_cosine_similarity(left, right))


def quantile_rust(values: list[float], percentile: float) -> float:
    return float(RUST.rust_quantile(values, percentile))


def build_semaxis_rust(
    positive_vectors: list[list[float]],
    negative_vectors: list[list[float]],
) -> list[float] | None:
    result = RUST.rust_build_semaxis(positive_vectors, negative_vectors)
    if result is None:
        return None
    return list(cast(Sequence[float], result))


def score_against_axis_rust(
    article_vectors: list[tuple[int, list[float]]],
    axis: list[float],
) -> list[tuple[int, float]]:
    return list(RUST.rust_score_against_axis(article_vectors, axis))


# --- Country mentions helpers ---


def extract_mentioned_countries_rust(text: str) -> list[str]:
    return list(RUST.rust_extract_mentioned_countries(text))


def build_article_text_rust(
    title: str | None,
    summary: str | None,
    content: str | None,
) -> str:
    return str(RUST.rust_build_article_text(title, summary, content))


def extract_article_mentioned_countries_rust(
    title: str | None,
    summary: str | None,
    content: str | None,
) -> list[str]:
    return list(RUST.rust_extract_article_mentioned_countries(title, summary, content))
