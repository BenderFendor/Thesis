"""Reporter Directory."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.core.config import SCOOP_USER_AGENT
from app.core.logging import get_logger

logger = get_logger("reporter_directory")


JOURNALISM_INSTANCES = [
    {
        "name": "journa.host",
        "url": "https://journa.host",
        "vetting": "invitation-only, press credentials verified",
    },
    {
        "name": "newsie.social",
        "url": "https://newsie.social",
        "vetting": "journalist-focused, closed registration",
    },
]


def _directory_account(account: dict[str, Any], instance_url: str) -> dict[str, Any]:
    fields = {
        field.get("name", ""): field.get("value", "") for field in account.get("fields") or []
    }
    return {
        "username": account.get("acct", ""),
        "display_name": account.get("display_name", ""),
        "bio": _strip_html(account.get("note", ""))[:500],
        "url": account.get("url", ""),
        "avatar": account.get("avatar", ""),
        "followers_count": account.get("followers_count", 0),
        "following_count": account.get("following_count", 0),
        "created_at": account.get("created_at", ""),
        "custom_fields": fields,
        "instance": instance_url,
    }


async def enumerate_instance_directory(
    instance_url: str,
    http_client: httpx.AsyncClient,
    limit: int = 0,
) -> list[dict[str, Any]]:
    """Enumerate Instance Directory."""
    accounts: list[dict[str, Any]] = []
    offset = 0
    page_size = 80
    while True:
        raw = await _fetch_directory_page(http_client, instance_url, offset, page_size)
        if raw is None or not raw:
            break
        accounts.extend(_directory_account(account, instance_url) for account in raw)
        offset += page_size
        if (limit and len(accounts) >= limit) or len(raw) < page_size:
            break
        await asyncio.sleep(0.3)
    return accounts


async def _fetch_directory_page(
    http_client: httpx.AsyncClient,
    instance_url: str,
    offset: int,
    page_size: int,
) -> list[dict[str, Any]] | None:
    """Fetch one directory page, returning ``None`` after a recoverable failure."""
    try:
        response = await http_client.get(
            f"{instance_url}/api/v1/directory",
            params={"local": True, "limit": page_size, "offset": offset},
            headers={"User-Agent": SCOOP_USER_AGENT},
            timeout=15.0,
        )
        if response.status_code != 200:
            logger.warning(
                "Directory enumeration failed on %s: HTTP %s",
                instance_url,
                response.status_code,
            )
            return None
        payload = response.json()
        return list(payload) if isinstance(payload, list) else []
    except Exception as exc:
        logger.warning("Directory enumeration error on %s: %s", instance_url, exc)
        return None


def _strip_html(text: str) -> str:
    import re

    return re.sub(r"<[^>]+>", "", text)


async def mine_journalist_directories(
    limit_per_instance: int = 0,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Mine Journalist Directories."""
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        instances_result: dict[str, Any] = {}
        all_accounts: list[dict[str, Any]] = []
        for inst in JOURNALISM_INSTANCES:
            instance_url = inst["url"]
            logger.info("Enumerating journalist directory: %s", instance_url)
            accounts = await enumerate_instance_directory(
                instance_url, client, limit=limit_per_instance
            )
            instances_result[inst["name"]] = {
                "url": instance_url,
                "vetting": inst["vetting"],
                "count": len(accounts),
            }
            all_accounts.extend(accounts)
            logger.info("Found %d accounts on %s", len(accounts), instance_url)
        return {
            "total_accounts": len(all_accounts),
            "instances": instances_result,
            "accounts": all_accounts,
        }
    finally:
        if owned_client:
            await client.aclose()


async def search_directory_by_name(
    name: str,
    http_client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    """Search Directory By Name."""
    owned_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=15.0)
    results: list[dict[str, Any]] = []
    try:
        for inst in JOURNALISM_INSTANCES:
            try:
                r = await client.get(
                    f"{inst['url']}/api/v2/search",
                    params={"q": name, "type": "accounts", "limit": 5},
                    headers={"User-Agent": SCOOP_USER_AGENT},
                    timeout=8.0,
                )
                if r.status_code != 200:
                    continue
                data = r.json()
                for acct in data.get("accounts") or []:
                    fields = {}
                    for field in acct.get("fields") or []:
                        fields[field.get("name", "")] = field.get("value", "")
                    results.append(
                        {
                            "username": acct.get("acct", ""),
                            "display_name": acct.get("display_name", ""),
                            "bio": _strip_html(acct.get("note", ""))[:500],
                            "url": acct.get("url", ""),
                            "followers_count": acct.get("followers_count", 0),
                            "custom_fields": fields,
                            "instance": inst["url"],
                        }
                    )
            except Exception:
                continue
    finally:
        if owned_client:
            await client.aclose()
    return results
