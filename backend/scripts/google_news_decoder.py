from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

HEADERS = {"User-Agent": "ScoopNewsReporterSourceVerifier/1.0"}
GOOGLE_NEWS_HOST = "news.google.com"


def decode_google_news_url(url: str) -> str | None:
    """Resolve a Google News article wrapper to the publisher URL."""
    article_id = _google_news_article_id(url)
    if not article_id:
        return None

    params = _fetch_decoding_params(article_id)
    if not params:
        return None

    payload = _build_decode_payload(
        article_id=article_id,
        timestamp=params["timestamp"],
        signature=params["signature"],
    )
    request = urllib.request.Request(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute",
        data=("f.req=" + urllib.parse.quote(payload)).encode("utf-8"),
        headers={
            **HEADERS,
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        text = response.read().decode("utf-8", errors="ignore")
    try:
        rows = json.loads(text.split("\n\n", 1)[1])
        decoded = json.loads(rows[0][2])
    except (IndexError, json.JSONDecodeError, TypeError):
        return None
    if (
        isinstance(decoded, list)
        and len(decoded) >= 2
        and decoded[0] == "garturlres"
        and isinstance(decoded[1], str)
    ):
        return decoded[1]
    return None


def _google_news_article_id(url: str) -> str | None:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc.lower() != GOOGLE_NEWS_HOST:
        return None
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) < 2 or path_parts[-2] not in {"articles", "read"}:
        return None
    return path_parts[-1] or None


def _fetch_decoding_params(article_id: str) -> dict[str, str] | None:
    for prefix in ("articles", "rss/articles"):
        request = urllib.request.Request(
            f"https://news.google.com/{prefix}/{article_id}",
            headers=HEADERS,
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                html = response.read().decode("utf-8", errors="ignore")
        except OSError:
            continue
        signature = _first_match(html, r'data-n-a-sg="([^"]+)"')
        timestamp = _first_match(html, r'data-n-a-ts="([^"]+)"')
        if signature and timestamp and timestamp.isdigit():
            return {"signature": signature, "timestamp": timestamp}
    return None


def _first_match(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text)
    return match.group(1) if match else None


def _build_decode_payload(article_id: str, timestamp: str, signature: str) -> str:
    request_body = [
        "garturlreq",
        [
            [
                "en-US",
                "US",
                ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"],
                None,
                None,
                1,
                1,
                "US:en",
                None,
                1,
                None,
                None,
                None,
                None,
                None,
                0,
                1,
            ],
            "en-US",
            "US",
            1,
            [1, 1, 1],
            1,
            1,
            None,
            0,
            0,
            None,
            0,
        ],
        article_id,
        int(timestamp),
        signature,
    ]
    return json.dumps(
        [
            [
                [
                    "Fbv4je",
                    json.dumps(request_body, separators=(",", ":")),
                    None,
                    "generic",
                ]
            ]
        ],
        separators=(",", ":"),
    )
