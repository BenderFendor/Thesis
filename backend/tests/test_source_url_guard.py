import string

from hypothesis import given, strategies as st

from app.services.source_url_guard import (
    build_source_url_guard,
    extract_domain,
    hosts_match,
)

_HOST_CHARS = string.ascii_lowercase + string.digits


@st.composite
def _bbc_hosts(draw: st.DrawFn) -> str:
    root = draw(st.sampled_from(["bbc.com", "bbc.co.uk", "bbci.co.uk"]))
    labels = draw(
        st.lists(
            st.text(alphabet=_HOST_CHARS, min_size=1, max_size=8),
            min_size=0,
            max_size=2,
        )
    )
    return ".".join([*labels, root]) if labels else root


@st.composite
def _site_scoped_google_news_urls(draw: st.DrawFn) -> tuple[str, str]:
    root = draw(st.sampled_from(["cnn.com", "reuters.com"]))
    labels = draw(
        st.lists(
            st.text(alphabet=_HOST_CHARS, min_size=1, max_size=8),
            min_size=0,
            max_size=1,
        )
    )
    site_host = ".".join([*labels, root]) if labels else root
    feed_url = (
        "https://news.google.com/rss/search"
        f"?q=site:{site_host}&hl=en-US&gl=US&ceid=US:en"
    )
    return site_host, feed_url


@given(_bbc_hosts(), _bbc_hosts())
def test_hosts_match_accepts_bbc_family_aliases(left: str, right: str) -> None:
    assert hosts_match(left, right)
    assert hosts_match(right, left)


@given(_site_scoped_google_news_urls())
def test_extract_domain_uses_google_news_site_scope(
    site_and_feed: tuple[str, str],
) -> None:
    site_host, feed_url = site_and_feed
    assert extract_domain(feed_url) == site_host


def test_build_source_url_guard_accepts_site_scoped_google_news_feed() -> None:
    guard = build_source_url_guard(
        "https://news.google.com/rss/search?q=site:cnn.com&hl=en-US&gl=US&ceid=US:en",
        "https://www.cnn.com",
    )

    assert guard["status"] == "ok"
    assert guard["configured_host"] == "cnn.com"
    assert guard["website_host"] == "cnn.com"
    assert guard["reason"] == "site_scoped_aggregator_matches_inferred_website"


def test_build_source_url_guard_accepts_bbc_feed_family_match() -> None:
    guard = build_source_url_guard(
        "https://feeds.bbci.co.uk/news/rss.xml",
        "https://www.bbc.com",
    )

    assert guard["status"] == "ok"
    assert guard["configured_host"] == "bbci.co.uk"
    assert guard["website_host"] == "bbc.com"
    assert guard["reason"] == "configured_host_matches_inferred_website"
