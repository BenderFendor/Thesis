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
    params: dict[str, str | int] = {"search": reporter_name, "per_page": 3}

    try:
        response = await http_client.get(search_url, params=params, timeout=10.0)
    except Exception as exc:
        logger.debug("WordPress API failed for %s: %s", base_url, exc)
        return []

    if response.status_code != 200:
        return []

    try:
        users = response.json()
    except Exception:
        logger.debug("WordPress API non-JSON response for %s", base_url)
        return []

    claims = []
    name_lower = reporter_name.lower()
    for user in users if isinstance(users, list) else []:
        display_name = (user.get("name") or "").strip()
        slug = (user.get("slug") or "").strip()
        description = (user.get("description") or "").strip()

        if not display_name or name_lower not in display_name.lower():
            continue

        if description:
            claims.append(
                {
                    "claim_type": "bio",
                    "claim_value": description,
                    "source_type": "cms_wordpress",
                    "source_url": f"{search_url}?search={reporter_name}",
                    "confidence": 0.7,
                }
            )

        author_url = user.get("link") or (f"{base_url.rstrip('/')}/author/{slug}" if slug else None)
        if author_url:
            claims.append(
                {
                    "claim_type": "sameAs",
                    "claim_value": author_url,
                    "source_type": "cms_wordpress",
                    "source_url": f"{search_url}?search={reporter_name}",
                    "confidence": 0.8,
                }
            )

    return claims


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
    params = {"filter[name]": reporter_name}

    try:
        response = await http_client.get(search_url, params=params, timeout=10.0)
    except Exception as exc:
        logger.debug("Drupal API failed for %s: %s", base_url, exc)
        return []

    if response.status_code != 200:
        return []

    try:
        data = response.json()
    except Exception:
        logger.debug("Drupal API non-JSON response for %s", base_url)
        return []

    claims = []
    included = data.get("data") or []
    for item in included if isinstance(included, list) else []:
        attrs = item.get("attributes") or {}
        display_name = (attrs.get("display_name") or attrs.get("name") or "").strip()

        if not display_name or reporter_name.lower() not in display_name.lower():
            continue

        bio = (attrs.get("field_biography") or attrs.get("bio") or "").strip()
        if bio:
            claims.append(
                {
                    "claim_type": "bio",
                    "claim_value": bio,
                    "source_type": "cms_drupal",
                    "source_url": search_url,
                    "confidence": 0.7,
                }
            )

    return claims
