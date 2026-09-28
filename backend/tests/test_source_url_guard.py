import string

from hypothesis import given
from hypothesis import strategies as st

from app.services.rss_parser_rust_bindings import RUST
from app.services.source_url_guard import (
    build_source_url_guard,
    extract_domain,
    hosts_match,
    normalize_host,
)

_HOST_CHARS = string.ascii_lowercase + string.digits


def _python_reference_normalize_host(host: str) -> str:
    return host.strip().lower().replace("www.", "")


def _python_reference_hosts_match(expected: str, actual: str) -> bool:
    families = (
        ("asiaplustj.info", "asiaplus.news", "old.asiaplustj.info"),
        ("bbc.com", "bbc.co.uk", "bbci.co.uk"),
    )

    def family(host: str) -> int | None:
        for index, members in enumerate(families):
            if any(host == root or host.endswith(f".{root}") for root in members):
                return index
        return None

    expected_norm = _python_reference_normalize_host(expected)
    actual_norm = _python_reference_normalize_host(actual)
    if not expected_norm or not actual_norm:
        return False
    if expected_norm == actual_norm:
        return True
    if expected_norm.endswith(f".{actual_norm}") or actual_norm.endswith(f".{expected_norm}"):
        return True
    expected_family = family(expected_norm)
    return expected_family is not None and expected_family == family(actual_norm)


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
    feed_url = f"https://news.google.com/rss/search?q=site:{site_host}&hl=en-US&gl=US&ceid=US:en"
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
    assert extract_domain(feed_url) == normalize_host(site_host)


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


def test_hosts_match_accepts_asia_plus_current_and_legacy_domains() -> None:
    assert hosts_match("asiaplustj.info", "asiaplus.news")
    assert hosts_match("old.asiaplustj.info", "asiaplus.news")


@given(st.text(max_size=100))
def test_rust_host_normalization_matches_python_reference(host: str) -> None:
    assert RUST.rust_normalize_host(host) == _python_reference_normalize_host(host)


@given(
    st.text(max_size=100),
    st.text(max_size=100),
)
def test_rust_host_matching_matches_python_reference(expected: str, actual: str) -> None:
    assert RUST.rust_hosts_match(expected, actual) == _python_reference_hosts_match(
        expected, actual
    )
    assert hosts_match(expected, actual) == _python_reference_hosts_match(expected, actual)


def test_hosts_match_rejects_suffix_lookalikes() -> None:
    assert not hosts_match("notbbc.com", "bbc.com")
    assert not hosts_match("bbc.com.example", "bbc.com")
    assert not hosts_match("", "example.com.")
    assert not hosts_match("example.com.", "")
