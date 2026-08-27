from types import SimpleNamespace

from app.services.image_extraction import (
    ImageErrorType,
    _extract_images_from_html,
    _resolve_url,
    extract_image_from_entry,
)


def test_extract_image_from_entry_preserves_source_priority_and_deduplication() -> None:
    entry = SimpleNamespace(
        media_content=[{"url": "/hero.jpg", "type": "image/jpeg"}],
        media_thumbnail=[{"url": "https://cdn.example/thumb.jpg"}],
        enclosures=[{"href": "https://cdn.example/enclosure.jpg", "type": "image/jpeg"}],
        content=[{"value": '<img src="https://cdn.example/content.jpg">'}],
        content_encoded=None,
        description=None,
        links=[{"href": "https://cdn.example/thumb.jpg", "type": "image/jpeg"}],
    )

    result = extract_image_from_entry(entry, article_url="https://news.example/story")

    assert result.image_url == "https://news.example/hero.jpg"
    assert result.selected_source == "media:content"
    assert [candidate.source for candidate in result.image_candidates] == [
        "media:content",
        "media:thumbnail",
        "enclosure",
        "content_html",
    ]


def test_extract_image_from_entry_returns_structured_empty_result() -> None:
    entry = SimpleNamespace()

    result = extract_image_from_entry(entry)

    assert result.image_url is None
    assert result.image_candidates == []
    assert result.image_error == ImageErrorType.NO_IMAGE_IN_FEED


def test_extract_images_from_html_normalizes_srcset_and_lazy_sources() -> None:
    html = """
    <img src="/primary.jpg">
    <img data-srcset="/lazy-1.jpg 1x, /lazy-2.jpg 2x">
    <img srcset="/wide-1.jpg 640w, /wide-2.jpg 1280w">
    """

    assert _extract_images_from_html(html) == [
        "/primary.jpg",
        "/lazy-1.jpg",
        "/wide-1.jpg",
    ]


def test_resolve_url_accepts_feedparser_shapes_and_protocol_relative_urls() -> None:
    assert _resolve_url({"href": "/image.jpg"}, "https://news.example/story") == (
        "https://news.example/image.jpg"
    )
    assert _resolve_url([{"url": "//cdn.example/image.jpg"}]) == "https://cdn.example/image.jpg"
    assert _resolve_url(42, "https://news.example/story") is None
