from __future__ import annotations

from typing import Any

import pytest

from app.api.routes import article_analysis
from app.models.article_analysis import ArticleAnalysisRequest
from app.services import article_extraction
from rss_parser_rust import extract_article_html


CAPTURED_ARTICLE_URL = "https://example.test/2026/captured-story"
CAPTURED_ARTICLE_HTML = """
<html>
  <head>
    <title>Fallback title</title>
    <meta property="og:title" content="Captured story">
    <meta name="author" content="Jane Doe">
    <meta name="author" content="Staff Desk">
    <meta property="article:published_time" content="2026-09-20T12:00:00Z">
    <meta name="description" content="A captured article fixture.">
  </head>
  <body>
    <article>
      <p>The first captured paragraph reports a confirmed event.</p>
      <p>The second captured paragraph records the response.</p>
    </article>
  </body>
</html>
"""

CAPTURED_ACCESS_CHALLENGE_HTML = """
<html><head><title>Publisher</title></head>
<body><p>Please enable JS and disable any ad blocker</p></body>
</html>
"""

CAPTURED_PAYWALL_HTML = """
<html><head><title>Subscriber exclusive</title></head>
<body><main><p>Subscribe to continue reading this article.</p></main></body>
</html>
"""

# This is the provider payload that exercises the known Python response-assembly
# bug. Python sees raw_response and incorrectly returns success; Rust deliberately
# rejects the marker so invalid provider output cannot become a successful analysis.
INVALID_PROVIDER_PAYLOAD = {
    "error": "Failed to parse analysis results",
    "raw_response": "not-json",
}


@pytest.mark.parametrize(
    ("html", "status_code", "expected_error"),
    [
        (
            CAPTURED_ACCESS_CHALLENGE_HTML,
            401,
            "Publisher blocked automated access with a verification page",
        ),
        (
            CAPTURED_PAYWALL_HTML,
            403,
            "Publisher requires a subscription or sign-in for full text",
        ),
    ],
)
def test_python_barrier_reference_uses_offline_captured_fixtures(
    monkeypatch: pytest.MonkeyPatch,
    html: str,
    status_code: int,
    expected_error: str,
) -> None:
    """Parity oracle for Rust's deterministic access-barrier classifier."""

    monkeypatch.setattr(
        article_extraction,
        "_fetch_article_response",
        lambda _url: (html, status_code),
    )
    rust_payload = dict(extract_article_html(html))
    result = article_extraction.extract_article_content(CAPTURED_ARTICLE_URL)

    # Rust's parser sees the captured marker as text; the reference service
    # then rejects it using status/content barrier policy.
    assert isinstance(rust_payload["text"], str)
    assert result == {
        "success": False,
        "error": expected_error,
        "text": None,
    }


def test_rust_html_boundary_matches_python_extraction_for_captured_article(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Compare the existing Rust parser boundary with FastAPI's extraction service."""

    monkeypatch.setattr(
        article_extraction,
        "_fetch_article_response",
        lambda _url: (CAPTURED_ARTICLE_HTML, 200),
    )
    python_payload = article_extraction.extract_article_content(CAPTURED_ARTICLE_URL)
    rust_payload = dict(extract_article_html(CAPTURED_ARTICLE_HTML))

    assert python_payload["success"] is True
    assert python_payload["extractor"] == "rust_html"
    for field in (
        "text",
        "title",
        "authors",
        "publish_date",
        "top_image",
        "images",
        "meta_description",
    ):
        assert python_payload[field] == rust_payload[field]
    assert rust_payload["text"] == (
        "The first captured paragraph reports a confirmed event.\n\n"
        "The second captured paragraph records the response."
    )


@pytest.mark.asyncio
async def test_analysis_failure_preserves_extraction_and_null_error_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Parity case for provider-unavailable responses with completed extraction."""

    extracted: dict[str, Any] = {
        "success": True,
        "text": "Captured article body.",
        "title": "Captured title",
        "authors": ["Jane Doe"],
        "publish_date": "2026-09-20",
    }

    async def extraction_for_test(_url: str) -> dict[str, Any]:
        return _completed_extraction(extracted)

    async def provider_for_test(
        _article_data: dict[str, Any], _source_name: str | None
    ) -> dict[str, str]:
        return _provider_error("OpenRouter API key not configured")

    monkeypatch.setattr(
        article_analysis,
        "extract_article_content",
        extraction_for_test,
    )
    monkeypatch.setattr(
        article_analysis,
        "analyze_with_gemini",
        provider_for_test,
    )

    response = await article_analysis.analyze_article(
        ArticleAnalysisRequest(url=CAPTURED_ARTICLE_URL, source_name=None)
    )
    payload = response.model_dump()

    assert payload["success"] is False
    assert payload["article_url"] == CAPTURED_ARTICLE_URL
    assert payload["full_text"] == "Captured article body."
    assert payload["title"] == "Captured title"
    assert payload["authors"] == ["Jane Doe"]
    assert payload["publish_date"] == "2026-09-20"
    assert payload["error"] == "OpenRouter API key not configured"
    assert payload["language_diagnostics"]["success"] is True
    for field in (
        "source_analysis",
        "reporter_analysis",
        "bias_analysis",
        "fact_check_suggestions",
        "fact_check_results",
        "grounding_metadata",
        "summary",
    ):
        assert payload[field] is None


@pytest.mark.asyncio
async def test_python_raw_response_bug_is_kept_as_a_divergence_oracle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Record the Python behavior that Rust intentionally strengthens."""

    extracted = {
        "success": True,
        "text": "Captured article body.",
        "title": "Captured title",
        "authors": ["Jane Doe"],
        "publish_date": "2026-09-20",
    }

    async def extraction_for_test(_url: str) -> dict[str, Any]:
        return _completed_extraction(extracted)

    async def provider_for_test(
        _article_data: dict[str, Any], _source_name: str | None
    ) -> dict[str, str]:
        return dict(INVALID_PROVIDER_PAYLOAD)

    monkeypatch.setattr(
        article_analysis,
        "extract_article_content",
        extraction_for_test,
    )
    monkeypatch.setattr(
        article_analysis,
        "analyze_with_gemini",
        provider_for_test,
    )

    response = await article_analysis.analyze_article(
        ArticleAnalysisRequest(url=CAPTURED_ARTICLE_URL, source_name="Captured")
    )
    payload = response.model_dump()

    # Rust's regression oracle is the opposite outcome: success=false, the
    # provider error is retained, and raw_response is never exposed.
    assert payload["success"] is True
    assert payload["error"] is None
    assert payload["summary"] is None


def _completed_extraction(payload: dict[str, Any]) -> dict[str, Any]:
    return dict(payload)


def _provider_error(message: str) -> dict[str, str]:
    return {"error": message}
