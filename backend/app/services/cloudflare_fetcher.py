"""Bounded Cloudflare/anti-bot fetch fallback helpers."""

from __future__ import annotations

import asyncio
import os
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.logging import get_logger

logger = get_logger("cloudflare_fetcher")

_CLOUDFLARE_MARKERS = (
    "/cdn-cgi/",
    "__cf_chl_",
    "checking your browser",
    "challenges.cloudflare.com",
    "just a moment",
    "needs to review the security of your connection",
    "verify you are human",
)
_DATADOME_MARKERS = ("datadome",)
_FALLBACK_STATUSES = {403, 429, 503}
_SCRAPER_LOCK = threading.Lock()
_CLOUDSCRAPER_SESSION: Any | None = None
_CLOUDSCRAPER_CREATED_AT = 0.0


@dataclass(frozen=True)
class FetchOutcome:
    """Minimal HTTP result shape shared by async httpx and sync fallback fetches."""

    url: str
    status_code: int | None = None
    headers: dict[str, str] | None = None
    text: str = ""
    access_path: str = "direct"
    error: str | None = None
    fallback_error: str | None = None

    @property
    def content_type(self) -> str:
        """Return the normalized response content type."""
        return (self.headers or {}).get("content-type", "")


def _env_enabled(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "no", ""}


def is_challenge_html(text: str, headers: dict[str, str] | None = None) -> bool:
    """Return True when the response body looks like an anti-bot challenge."""
    lowered = text[:8000].lower()
    return any(marker in lowered for marker in _CLOUDFLARE_MARKERS)


def _has_cloudflare_header(headers: dict[str, str] | None) -> bool:
    normalized_headers = {key.lower(): value.lower() for key, value in (headers or {}).items()}
    return "cf-ray" in normalized_headers or normalized_headers.get("server") == "cloudflare"


def classify_access_barrier(outcome: FetchOutcome) -> str | None:
    """Classify access barriers while keeping hard HTTP blocks distinct."""
    if outcome.error:
        lowered_error = outcome.error.lower()
        if "cloudscraper unavailable" in lowered_error:
            return "cloudscraper_unavailable"
        return "fetch_failed"

    text = outcome.text[:8000].lower()
    if any(marker in text for marker in _DATADOME_MARKERS):
        return "datadome"
    if is_challenge_html(outcome.text, outcome.headers) or (
        outcome.status_code in _FALLBACK_STATUSES and _has_cloudflare_header(outcome.headers)
    ):
        return "cloudflare"
    if outcome.status_code in {401, 403, 429, 503}:
        return f"http_{outcome.status_code}"
    return None


def _should_try_cloudscraper(outcome: FetchOutcome) -> bool:
    if not _env_enabled("THESIS_ENABLE_CLOUDSCRAPER", "1"):
        return False
    if outcome.status_code == 401:
        return False
    if is_challenge_html(outcome.text, outcome.headers):
        return True
    if outcome.status_code in _FALLBACK_STATUSES and _has_cloudflare_header(outcome.headers):
        return True
    return outcome.status_code in _FALLBACK_STATUSES and _env_enabled(
        "THESIS_CLOUDSCRAPER_GENERIC_BLOCKS",
        "0",
    )


def _redirected_to_site_root(requested_url: str, outcome_url: str) -> bool:
    requested = urlparse(requested_url)
    outcome = urlparse(outcome_url)
    if requested.netloc.lower().removeprefix("www.") != outcome.netloc.lower().removeprefix("www."):
        return False
    requested_path = requested.path.rstrip("/") or "/"
    outcome_path = outcome.path.rstrip("/") or "/"
    return requested_path != "/" and outcome_path == "/"


def _get_cloudscraper_session() -> Any:
    """Return a cached Cloudscraper session so Cloudflare cookies can persist."""
    global _CLOUDSCRAPER_CREATED_AT, _CLOUDSCRAPER_SESSION
    try:
        import cloudscraper  # type: ignore[import-untyped]
    except Exception as exc:
        raise RuntimeError(f"cloudscraper unavailable: {exc}") from exc

    now = time.monotonic()
    session_max_age = float(os.getenv("THESIS_CLOUDSCRAPER_SESSION_MAX_AGE_SECONDS", "1800"))
    if _CLOUDSCRAPER_SESSION is not None and now - _CLOUDSCRAPER_CREATED_AT < session_max_age:
        return _CLOUDSCRAPER_SESSION

    _CLOUDSCRAPER_SESSION = cloudscraper.create_scraper(
        interpreter="js2py",
        delay=float(os.getenv("THESIS_CLOUDSCRAPER_CHALLENGE_DELAY_SECONDS", "5")),
        enable_stealth=True,
        stealth_options={
            "min_delay": float(os.getenv("THESIS_CLOUDSCRAPER_MIN_DELAY_SECONDS", "2.0")),
            "max_delay": float(os.getenv("THESIS_CLOUDSCRAPER_MAX_DELAY_SECONDS", "6.0")),
            "human_like_delays": True,
            "randomize_headers": True,
            "browser_quirks": True,
        },
        auto_refresh_on_403=_env_enabled("THESIS_CLOUDSCRAPER_AUTO_REFRESH_ON_403", "0"),
        max_403_retries=int(os.getenv("THESIS_CLOUDSCRAPER_MAX_403_RETRIES", "0")),
        min_request_interval=float(os.getenv("THESIS_CLOUDSCRAPER_MIN_INTERVAL_SECONDS", "2.0")),
        max_concurrent_requests=1,
        rotate_tls_ciphers=True,
    )
    _CLOUDSCRAPER_CREATED_AT = now
    return _CLOUDSCRAPER_SESSION


def _cloudscraper_fetch_sync(url: str, timeout_seconds: float) -> FetchOutcome:
    try:
        scraper = _get_cloudscraper_session()
    except Exception as exc:
        return FetchOutcome(
            url=url,
            access_path="cloudscraper",
            error=str(exc),
        )

    try:
        with _SCRAPER_LOCK:
            response = scraper.get(
                url,
                allow_redirects=True,
                timeout=timeout_seconds,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.8",
                },
            )
    except Exception as exc:
        logger.debug("Cloudscraper fetch failed for %s: %s", url, exc)
        return FetchOutcome(url=url, access_path="cloudscraper", error=str(exc))

    return FetchOutcome(
        url=str(response.url),
        status_code=response.status_code,
        headers={str(key).lower(): str(value) for key, value in response.headers.items()},
        text=response.text or "",
        access_path="cloudscraper",
    )


async def fetch_html_document(
    http_client: httpx.AsyncClient,
    url: str,
    *,
    timeout_seconds: float = 15.0,
    use_cloudscraper: bool = True,
) -> FetchOutcome:
    """Fetch an HTML-ish document, retrying blocked Cloudflare-like pages once.

    The fallback is deliberately narrow: direct httpx remains the first path, 401s are
    preserved as blocked, and fallback output is returned only as another fetch result.
    Callers must still validate source host, author name, and evidence type.
    """
    try:
        response = await http_client.get(url, follow_redirects=True, timeout=timeout_seconds)
        direct = FetchOutcome(
            url=str(response.url),
            status_code=response.status_code,
            headers={str(key).lower(): str(value) for key, value in response.headers.items()},
            text=response.text or "",
            access_path="direct",
        )
    except Exception as exc:
        logger.debug("Direct fetch failed for %s: %s", url, exc)
        direct = FetchOutcome(url=url, access_path="direct", error=str(exc))

    if (
        not use_cloudscraper
        or _redirected_to_site_root(url, direct.url)
        or not _should_try_cloudscraper(direct)
    ):
        return direct

    hard_timeout = float(
        os.getenv("THESIS_CLOUDSCRAPER_HARD_TIMEOUT_SECONDS", str(timeout_seconds + 8.0))
    )
    try:
        fallback = await asyncio.wait_for(
            asyncio.to_thread(_cloudscraper_fetch_sync, url, timeout_seconds),
            timeout=hard_timeout,
        )
    except TimeoutError:
        return FetchOutcome(
            url=direct.url,
            status_code=direct.status_code,
            headers=direct.headers,
            text=direct.text,
            access_path=direct.access_path,
            error=direct.error,
            fallback_error="cloudscraper_timeout",
        )
    if (
        fallback.status_code == 200
        and "text/html" in fallback.content_type
        and not is_challenge_html(fallback.text, fallback.headers)
    ):
        return fallback

    fallback_barrier = classify_access_barrier(fallback)
    if fallback.error:
        return FetchOutcome(
            url=direct.url,
            status_code=direct.status_code,
            headers=direct.headers,
            text=direct.text,
            access_path=direct.access_path,
            error=direct.error,
            fallback_error=fallback.error,
        )
    return FetchOutcome(
        url=direct.url,
        status_code=direct.status_code,
        headers=direct.headers,
        text=direct.text,
        access_path=direct.access_path,
        error=direct.error,
        fallback_error=f"cloudscraper_{fallback_barrier or fallback.status_code}",
    )


def outcome_to_error(outcome: FetchOutcome) -> str | None:
    """Convert a fetch outcome into the scraper error string used by older callers."""
    if outcome.error:
        return f"Fetch failed: {outcome.error}"
    if outcome.status_code != 200:
        suffix = f" after {outcome.access_path}" if outcome.access_path != "direct" else ""
        return f"HTTP {outcome.status_code}{suffix}"
    content_type = outcome.content_type
    if "text/html" not in content_type and "application/json" not in content_type:
        return f"Non-HTML content type: {content_type}"
    barrier = classify_access_barrier(outcome)
    if barrier:
        return barrier
    return None
