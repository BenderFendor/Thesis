from __future__ import annotations

import json
from pathlib import Path

from app.services.prompting import compose_prompt_blocks


_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "rss_sources.json"


def load_rss_sources_context() -> str:
    return _DATA_PATH.read_text(encoding="utf-8")


def build_rss_source_research_prompt() -> str:
    task = """You are researching additions to a country-based RSS news catalog.

Your task:
Expand coverage for undercovered countries using only high-quality English-language news outlets with working RSS feeds.

Primary goal:
Find up to 2 strong, distinct sources per country where coverage is weak.

Selection rules:
- Quality is more important than completeness.
- English-language only.
- Prefer outlets that are actually read in the country, shape domestic discourse, or provide direct reporting from the country.
- Prefer first-party official RSS feeds.
- Do not use junk aggregators, spam networks, low-effort expat blogs, or generic mirror feeds.
- Do not add a source just to fill a gap.
- If a country does not have a good English-language option, return no addition for that country.

Perspective rules:
- If a state-funded or state-affiliated outlet is widely read and important for understanding domestic framing, it may be included.
- If you include such a source, explicitly label it.
- Where possible, pair it with an independent, opposition, investigative, or otherwise distinct source.
- Aim for contrast without forcing false balance.

Validation rules:
For every proposed source, verify:
- the RSS URL is real and parseable
- the feed returns recent entries
- the outlet is genuinely tied to the target country
- the site is not obviously dormant, broken, or low credibility
- the feed is not just a search wrapper unless there is no better option and you explain why

Research method:
1. Read the current JSON and map coverage by country.
2. Prioritize countries with fewer than 2 good sources.
3. Search for candidate outlets and official RSS pages.
4. Validate each RSS feed.
5. Compare candidates and keep only the strongest additions.
6. For each accepted source, explain why it improves the catalog.
7. For each rejected source, explain why it was rejected.

Output format:

Part 1: Priority countries
- List the countries that need attention first, with a short reason for each.

Part 2: Proposed additions
For each proposed source, return:
- source_name
- url
- category
- country
- funding_type
- bias_rating
- ownership_label
- ownership_note
- why_this_source_matters
- audience_or_role_note
- rss_validation_evidence
- contrast_note
- confidence: high | medium | low

Part 3: Rejected candidates
For each rejected candidate, return:
- name
- country
- reason_rejected

Part 4: JSON-ready entries
Return only the accepted additions as JSON objects shaped exactly like:
"Source Name": {
  "url": "https://example.com/feed/",
  "category": "general",
  "country": "XX",
  "funding_type": "Commercial",
  "bias_rating": "Center",
  "ownership_label": "private media group"
}

Part 5: Gaps that remain
List countries where no acceptable English-language source was found.

Important:
- Be conservative.
- Do not invent feed URLs.
- Do not guess ownership or political alignment; if uncertain, say uncertain.
- Prefer no recommendation over a weak recommendation.
- Do not return more than 2 additions per country.
- Prefer one RSS URL per source entry."""

    background = """Context:
- The current RSS catalog is a curated source map used for country-level news coverage.
- The catalog accepts `ownership_label` as a compact source-ownership field alongside `funding_type` and `bias_rating`.
- State or state-affiliated outlets are allowed when clearly labeled and ideally paired with a contrasting domestic source.
- Country values should use ISO-style two-letter codes.
- The current catalog JSON follows below and should be treated as the baseline coverage map."""

    rss_context = json.dumps(
        json.loads(load_rss_sources_context()), indent=2, ensure_ascii=True
    )
    return compose_prompt_blocks(task, background, rss_context)
