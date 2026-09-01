"""CMS public endpoint crawler for author enrichment."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.logging import get_logger

logger = get_logger("reporter_cms_crawl")


async def discover_cms_authors(
    http_client: httpx.AsyncClient,
    domain: str,
    reporter_name: str,
) -> list[dict[str, Any]]:
    """Try common CMS public endpoints to find author data.

    Checks:
    - WordPress REST API: /wp-json/wp/v2/users?search={name}
    - Drupal JSON:API: /jsonapi/user/user?filter[name]={name}

    Returns list of dicts with keys: claim_type, claim_value, source_type, source_url, confidence.
    Returns empty list if no CMS endpoints respond or no matching authors found.
    """
    base_url = f"https://{domain}" if "://" not in domain else domain
    claims = []

    wp_claims = await _try_wordpress_api(http_client, base_url, reporter_name)
    claims.extend(wp_claims)

    drupal_claims = await _try_drupal_api(http_client, base_url, reporter_name)
    claims.extend(drupal_claims)

    return claims


async def _fetch_cms_json(
    http_client: httpx.AsyncClient,
    url: str,
    params: dict[str, Any],
    platform: str,
    base_url: str,
) -> Any | None:
    """Fetch a CMS endpoint and return parsed JSON, or None on failure."""
    try:
        response = await http_client.get(url, params=params, timeout=10.0)
    except Exception as exc:
        logger.debug("%s API failed for %s: %s", platform, base_url, exc)
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except Exception:
        logger.debug("%s API non-JSON response for %s", platform, base_url)
        return None


def _cms_claim(
    claim_type: str,
    claim_value: str,
    source_type: str,
    source_url: str,
    confidence: float,
) -> dict[str, Any]:
    return {
        "claim_type": claim_type,
        "claim_value": claim_value,
        "source_type": source_type,
        "source_url": source_url,
        "confidence": confidence,
    }


def _wordpress_user_claims(
    user: Any,
    search_url: str,
    base_url: str,
    reporter_name: str,
    name_lower: str,
) -> list[dict[str, Any]]:
    display_name = (user.get("name") or "").strip()
    slug = (user.get("slug") or "").strip()
    description = (user.get("description") or "").strip()

    if not display_name or name_lower not in display_name.lower():
        return []

    claims = []
    if description:
        claims.append(
            _cms_claim(
                "bio",
                description,
                "cms_wordpress",
                f"{search_url}?search={reporter_name}",
                0.7,
            )
        )

    author_url = user.get("link") or (f"{base_url.rstrip('/')}/author/{slug}" if slug else None)
    if author_url:
        claims.append(
            _cms_claim(
                "sameAs",
                author_url,
                "cms_wordpress",
                f"{search_url}?search={reporter_name}",
                0.8,
            )
        )
    return claims


async def _try_wordpress_api(
    http_client: httpx.AsyncClient,
    base_url: str,
    reporter_name: str,
) -> list[dict[str, Any]]:
    """Try WordPress REST API for author data.

    Hits /wp-json/wp/v2/users with search parameter.
    Returns bio and sameAs claims for matching authors.
    """
    search_url = f"{base_url.rstrip('/')}/wp-json/wp/v2/users"
    params: dict[str, Any] = {"search": reporter_name, "per_page": 3}
    users = await _fetch_cms_json(http_client, search_url, params, "WordPress", base_url)
    if users is None:
        return []

    claims = []
    name_lower = reporter_name.lower()
    for user in users if isinstance(users, list) else []:
        claims.extend(_wordpress_user_claims(user, search_url, base_url, reporter_name, name_lower))
    return claims


def _drupal_user_claims(
    item: Any,
    search_url: str,
    reporter_name: str,
) -> list[dict[str, Any]]:
    attrs = item.get("attributes") or {}
    display_name = (attrs.get("display_name") or attrs.get("name") or "").strip()

    if not display_name or reporter_name.lower() not in display_name.lower():
        return []

    bio = (attrs.get("field_biography") or attrs.get("bio") or "").strip()
    if not bio:
        return []
    return [
        _cms_claim("bio", bio, "cms_drupal", search_url, 0.7),
    ]


async def _try_drupal_api(
    http_client: httpx.AsyncClient,
    base_url: str,
    reporter_name: str,
) -> list[dict[str, Any]]:
    """Try Drupal JSON:API for author data.

    Hits /jsonapi/user/user with name filter.
    Returns bio claims for matching authors.
    """
    search_url = f"{base_url.rstrip('/')}/jsonapi/user/user"
    params: dict[str, Any] = {"filter[name]": reporter_name}
    data = await _fetch_cms_json(http_client, search_url, params, "Drupal", base_url)
    if data is None:
        return []

    claims = []
    included = data.get("data") or []
    for item in included if isinstance(included, list) else []:
        claims.extend(_drupal_user_claims(item, search_url, reporter_name))
    return claims
