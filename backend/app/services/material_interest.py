"""
Material Interest Agent for Phase 5C.

This agent analyzes material interests that may influence news coverage:
- Trade relationships between countries (OEC data from trade_flows table)
- Corporate interests and advertisers (from organizations table)
- GDELT economic event context between mentioned countries
- Commodity price dynamics affecting coverage incentives

Helps identify potential conflicts of interest in news coverage.
"""

import json
import re
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, cast

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import text

from app.core.llm_client import get_llm_client
from app.core.logging import get_logger
from app.services.prompting import COPY_STYLE_GUIDE, build_json_system_prompt

logger = get_logger("material_interest")

MATERIAL_INTEREST_SYSTEM_PROMPT = build_json_system_prompt(
    role="material interest analyst",
    task=(
        "Assess potential material interests, conflicts, blind spots, and reader "
        "warnings from the supplied source, owner, trade, GDELT, and commodity context."
    ),
)

_CAMEO_COOPERATION_LO = 1
_CAMEO_COOPERATION_HI = 6
_CAMEO_CONFLICT_LO = 7
_CAMEO_CONFLICT_HI = 13
_CAMEO_ECONOMIC_LO = 14
_CAMEO_ECONOMIC_HI = 20


def _extract_json(content: str) -> Optional[Dict[str, Any]]:
    match = re.search(r"\{[\s\S]*\}", content)
    if match:
        return json.loads(match.group())
    return None


class MaterialInterestAgent:
    """Agent that analyzes material interests affecting news coverage."""

    def __init__(self) -> None:
        self.llm_client = get_llm_client()
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.oec_base = "https://oec.world/olap-proxy/data"

    async def _get_db_session(self) -> AsyncSession:
        from app.database import AsyncSessionLocal

        if AsyncSessionLocal is None:
            raise RuntimeError("Database access requested but ENABLE_DATABASE=0")
        factory = cast(async_sessionmaker[AsyncSession], AsyncSessionLocal)
        return factory()

    async def _get_gdelt_economic_context(
        self, countries: List[str], days: int = 30, session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        upper = [c.upper() for c in countries]
        if not upper:
            return {
                "cooperation_events": 0,
                "conflict_events": 0,
                "economic_events": 0,
                "avg_tone": None,
                "avg_goldstein": None,
                "total_events": 0,
            }

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        async def _run_query(db: AsyncSession) -> Dict[str, Any]:
            result = await db.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (
                            WHERE CAST(event_root_code AS FLOAT) BETWEEN :coop_lo AND :coop_hi
                        ) AS cooperation_events,
                        COUNT(*) FILTER (
                            WHERE CAST(event_root_code AS FLOAT) BETWEEN :conf_lo AND :conf_hi
                        ) AS conflict_events,
                        COUNT(*) FILTER (
                            WHERE CAST(event_root_code AS FLOAT) BETWEEN :econ_lo AND :econ_hi
                        ) AS economic_events,
                        AVG(tone) AS avg_tone,
                        AVG(goldstein_scale) AS avg_goldstein,
                        COUNT(*) AS total_events
                    FROM gdelt_events
                    WHERE published_at >= :cutoff
                      AND (
                          actor1_country = ANY(:countries)
                          OR actor2_country = ANY(:countries)
                      )
                """
                ),
                {
                    "coop_lo": _CAMEO_COOPERATION_LO,
                    "coop_hi": _CAMEO_COOPERATION_HI,
                    "conf_lo": _CAMEO_CONFLICT_LO,
                    "conf_hi": _CAMEO_CONFLICT_HI,
                    "econ_lo": _CAMEO_ECONOMIC_LO,
                    "econ_hi": _CAMEO_ECONOMIC_HI,
                    "countries": upper,
                    "cutoff": cutoff,
                },
            )
            row = result.one()
            return {
                "cooperation_events": int(row.cooperation_events or 0),
                "conflict_events": int(row.conflict_events or 0),
                "economic_events": int(row.economic_events or 0),
                "avg_tone": round(row.avg_tone, 3)
                if row.avg_tone is not None
                else None,
                "avg_goldstein": round(row.avg_goldstein, 3)
                if row.avg_goldstein is not None
                else None,
                "total_events": int(row.total_events or 0),
            }

        try:
            if session is not None:
                return await _run_query(session)
            async with await self._get_db_session() as new_session:
                return await _run_query(new_session)
        except Exception as e:
            logger.error("GDELT economic context query failed: %s", e)
            return {
                "cooperation_events": 0,
                "conflict_events": 0,
                "economic_events": 0,
                "avg_tone": None,
                "avg_goldstein": None,
                "total_events": 0,
                "error": str(e),
            }

    async def _get_country_resources(
        self, country_codes: List[str], session: Optional[AsyncSession] = None
    ) -> Dict[str, Dict[str, Any]]:
        upper = [c.upper() for c in country_codes]
        if not upper:
            return {}

        async def _run(db: AsyncSession) -> Dict[str, Dict[str, Any]]:
            result = await db.execute(
                text(
                    """
                    SELECT country_code, natural_resources, top_exports, top_imports,
                           economic_sectors
                    FROM country_resources
                    WHERE country_code = ANY(:codes)
                """
                ),
                {"codes": upper},
            )
            return {
                row.country_code: {
                    "natural_resources": row.natural_resources or [],
                    "top_exports": row.top_exports or [],
                    "top_imports": row.top_imports or [],
                    "economic_sectors": row.economic_sectors or [],
                }
                for row in result
            }

        try:
            if session is not None:
                return await _run(session)
            async with await self._get_db_session() as new_s:
                return await _run(new_s)
        except Exception as e:
            logger.error("Country resources query failed: %s", e)
            return {}

    async def _get_trade_flows(
        self, exporter: str, importer: str, session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        async def _run(db: AsyncSession) -> Dict[str, Any]:
            agg_result = await db.execute(
                text(
                    """
                    SELECT
                        SUM(trade_value_usd) AS total_value,
                        COUNT(*) AS product_count
                    FROM trade_flows
                    WHERE exporter_country = :exporter
                      AND importer_country = :importer
                """
                ),
                {"exporter": exporter.upper(), "importer": importer.upper()},
            )
            agg = agg_result.one()

            products_result = await db.execute(
                text(
                    """
                    SELECT product_code, product_name, trade_value_usd
                    FROM trade_flows
                    WHERE exporter_country = :exporter
                      AND importer_country = :importer
                    ORDER BY trade_value_usd DESC
                    LIMIT 5
                """
                ),
                {"exporter": exporter.upper(), "importer": importer.upper()},
            )
            top_products = [
                {
                    "product_code": row.product_code,
                    "product_name": row.product_name,
                    "trade_value_usd": row.trade_value_usd,
                }
                for row in products_result
            ]

            return {
                "total_trade_value_usd": agg.total_value,
                "product_count": agg.product_count,
                "top_products": top_products,
            }

        try:
            if session is not None:
                return await _run(session)
            async with await self._get_db_session() as new_s:
                return await _run(new_s)
        except Exception as e:
            logger.error(
                "Trade flows query failed for %s->%s: %s", exporter, importer, e
            )
            return {"total_trade_value_usd": None, "product_count": 0, "top_products": []}

    async def _get_commodity_context(
        self, commodities: List[str], session: Optional[AsyncSession] = None
    ) -> Dict[str, Dict[str, Any]]:
        if not commodities:
            return {}

        six_months_ago = datetime.now(timezone.utc) - timedelta(days=180)

        async def _run(db: AsyncSession) -> Dict[str, Dict[str, Any]]:
            result = await db.execute(
                text(
                    """
                    SELECT commodity_name, price_usd, date, source
                    FROM commodity_prices
                    WHERE commodity_name = ANY(:names)
                      AND date >= :six_months
                    ORDER BY commodity_name, date DESC
                """
                ),
                {"names": commodities, "six_months": six_months_ago},
            )
            rows = list(result)
            grouped: Dict[str, List[Dict[str, Any]]] = {}
            for row in rows:
                grouped.setdefault(row.commodity_name, []).append(
                    {
                        "price_usd": row.price_usd,
                        "date": row.date.isoformat() if row.date else None,
                        "source": row.source,
                    }
                )

            context: Dict[str, Dict[str, Any]] = {}
            for name, prices in grouped.items():
                latest = prices[0]["price_usd"] if prices else None
                oldest = prices[-1]["price_usd"] if prices else None
                trend = None
                if latest is not None and oldest is not None and oldest != 0:
                    trend = round((latest - oldest) / oldest * 100, 1)
                context[name] = {
                    "latest_price_usd": latest,
                    "trend_pct_6mo": trend,
                    "data_points": len(prices),
                }
            return context

        try:
            if session is not None:
                return await _run(session)
            async with await self._get_db_session() as new_s:
                return await _run(new_s)
        except Exception as e:
            logger.error("Commodity context query failed: %s", e)
            return {}

    async def _get_source_owner_interests(
        self, source_name: str, session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        async def _run(db: AsyncSession) -> Dict[str, Any]:
            normalized = source_name.lower().strip()
            org_result = await db.execute(
                text(
                    """
                    SELECT name, org_type, funding_type, parent_org_id, funding_sources,
                           major_advertisers, media_bias_rating, factual_reporting
                    FROM organizations
                    WHERE LOWER(normalized_name) = :name
                    LIMIT 1
                """
                ),
                {"name": normalized},
            )
            org_row = org_result.first()

            score_result = await db.execute(
                text(
                    """
                    SELECT axis_name, score, prose_explanation
                    FROM source_analysis_scores
                    WHERE LOWER(source_name) = :name
                """
                ),
                {"name": normalized},
            )
            scores = [
                {
                    "axis": row.axis_name,
                    "score": row.score,
                    "explanation": row.prose_explanation,
                }
                for row in score_result
            ]

            if org_row:
                return {
                    "name": org_row.name,
                    "org_type": org_row.org_type,
                    "funding_type": org_row.funding_type,
                    "funding_sources": org_row.funding_sources or [],
                    "major_advertisers": org_row.major_advertisers or [],
                    "media_bias_rating": org_row.media_bias_rating,
                    "factual_reporting": org_row.factual_reporting,
                    "analysis_scores": scores,
                }
            return {"name": source_name, "analysis_scores": scores}

        try:
            if session is not None:
                return await _run(session)
            async with await self._get_db_session() as new_s:
                return await _run(new_s)
        except Exception as e:
            logger.error("Owner interests query failed for '%s': %s", source_name, e)
            return {}

    async def _persist_analysis(
        self, article_url: str, source_name: str, analysis_json: Dict[str, Any], session: Optional[AsyncSession] = None
    ) -> None:
        async def _run(db: AsyncSession) -> None:
            await db.execute(
                text(
                    """
                    INSERT INTO material_interest_analyses
                        (article_url, source_name, analysis_json, created_at)
                    VALUES (:url, :source, :analysis, :now)
                """
                ),
                {
                    "url": article_url,
                    "source": source_name,
                    "analysis": json.dumps(analysis_json, default=str),
                    "now": datetime.now(timezone.utc),
                },
            )
            await db.commit()

        try:
            if session is not None:
                return await _run(session)
            async with await self._get_db_session() as new_s:
                return await _run(new_s)
        except Exception as e:
            logger.error("Failed to persist material interest analysis: %s", e)

    async def _ai_analyze_interests(
        self,
        source_name: str,
        source_country: str,
        mentioned_countries: List[str],
        topics: Optional[List[str]],
        article_text: Optional[str],
        gdelt_context: Dict[str, Any],
        country_resources: Dict[str, Dict[str, Any]],
        trade_data: List[Dict[str, Any]],
        owner_interests: Dict[str, Any],
        commodity_context: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not self.llm_client:
            return {
                "beneficiary_table": [],
                "analysis_summary": "LLM client not available.",
                "reader_warnings": [],
                "potential_conflicts": [],
            }

        prompt = f"""Analyze material interests affecting coverage of this news story.

Source: {source_name} (from {source_country})
Countries mentioned: {", ".join(mentioned_countries)}
Topics: {", ".join(topics or ["general"])}

Article text (excerpt): {(article_text or "")[:2000]}

GDELT economic context (last 30 days between mentioned countries):
{json.dumps(gdelt_context, indent=2)}

Country resources (natural resources, exports, imports):
{json.dumps(country_resources, indent=2)}

Trade flows between mentioned countries:
{json.dumps(trade_data, indent=2)}

Source owner/funding profile:
{json.dumps(owner_interests, indent=2)}

Commodity price context:
{json.dumps(commodity_context, indent=2)}

Answer these questions directly:

1. Who benefits economically from stability in this region? Who benefits from instability?
2. What commodities or trade flows are at stake in this story?
3. Does the source's ownership or funding create structural pressure on coverage?
4. What is the reader not being told about economic interests?

Return ONLY valid JSON:

{{
  "beneficiary_table": [
    {{
      "actor": "string (country, company, or organization)",
      "interest_type": "stability|instability|economic_gain",
      "interest_description": "Brief explanation of the economic stake",
      "evidence": "Supporting data or reasoning",
      "certainty": "high|medium|low"
    }}
  ],
  "analysis_summary": "Concise analysis of the economic forces shaping this coverage",
  "reader_warnings": ["Things the reader should be aware of regarding economic interests"],
  "potential_conflicts": ["Conflicts between coverage and source interests"]
}}

{COPY_STYLE_GUIDE}"""

        try:
            response = self.llm_client.chat_completions_create(
                service_name="material",
                messages=[
                    {"role": "system", "content": MATERIAL_INTEREST_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1200,
                temperature=0.3,
            )

            content = response.choices[0].message.content or ""
            parsed = _extract_json(content)

            if parsed:
                return {
                    "beneficiary_table": parsed.get("beneficiary_table", []),
                    "analysis_summary": parsed.get("analysis_summary", ""),
                    "reader_warnings": parsed.get("reader_warnings", []),
                    "potential_conflicts": parsed.get("potential_conflicts", []),
                    "confidence": parsed.get("certainty", "medium"),
                }

            logger.warning(
                "AI response could not be parsed as JSON: %s", content[:200]
            )
            return {
                "beneficiary_table": [],
                "analysis_summary": "Analysis unavailable.",
                "reader_warnings": [],
                "potential_conflicts": [],
            }

        except Exception as e:
            logger.error("AI analysis failed: %s", e)
            return {
                "beneficiary_table": [],
                "analysis_summary": "Analysis failed.",
                "reader_warnings": [],
                "potential_conflicts": [],
            }

    async def analyze_material_context(
        self,
        article_source: str,
        source_country: str,
        mentioned_countries: List[str],
        topics: Optional[List[str]] = None,
        article_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        logger.info(
            "Analyzing material context for %s (%s)", article_source, source_country
        )

        all_countries = [c for c in [source_country] + mentioned_countries[:4] if c]
        if not all_countries:
            all_countries = mentioned_countries[:5]

        session = await self._get_db_session()
        try:
            gdelt_context, resources, owner_interests = await asyncio.gather(
                self._get_gdelt_economic_context(all_countries, session=session),
                self._get_country_resources(all_countries, session=session),
                self._get_source_owner_interests(article_source, session=session),
            )

            trade_data: List[Dict[str, Any]] = []
            trade_tasks = []
            for i, c1 in enumerate(all_countries):
                for c2 in all_countries[i + 1 :]:
                    trade_tasks.append(self._get_trade_flows(c1, c2, session=session))
            trade_results = await asyncio.gather(*trade_tasks)
            pair_index = 0
            for i, c1 in enumerate(all_countries):
                for j, c2 in enumerate(all_countries[i + 1 :]):
                    if pair_index < len(trade_results):
                        trade_data.append(
                            {"exporter": c1, "importer": c2, **trade_results[pair_index]}
                        )
                    pair_index += 1

            commodity_names: List[str] = []
            for cr in resources.values():
                for res in cr.get("natural_resources", []):
                    commodity_names.append(str(res))
            commodity_context = await self._get_commodity_context(commodity_names[:10], session=session)

            analysis = await self._ai_analyze_interests(
                source_name=article_source,
                source_country=source_country,
                mentioned_countries=mentioned_countries,
                topics=topics,
                article_text=article_text,
                gdelt_context=gdelt_context,
                country_resources=resources,
                trade_data=trade_data,
                owner_interests=owner_interests,
                commodity_context=commodity_context,
            )

            timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            article_url_hint = f"material_{article_source}_{timestamp_str}"
            await self._persist_analysis(article_url_hint, article_source, analysis, session=session)

            result: Dict[str, Any] = {
                "source": article_source,
                "source_country": source_country,
                "mentioned_countries": mentioned_countries,
                "trade_relationships": trade_data,
                "known_interests": owner_interests,
                "potential_conflicts": analysis.get("potential_conflicts", []),
                "analysis_summary": analysis.get("analysis_summary"),
                "reader_warnings": analysis.get("reader_warnings", []),
                "beneficiary_table": analysis.get("beneficiary_table", []),
                "gdelt_context": gdelt_context,
                "commodity_context": commodity_context,
                "confidence": analysis.get("confidence", "medium"),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            }
            return result
        finally:
            await session.close()

    async def get_country_economic_profile(
        self, country_code: str
    ) -> Dict[str, Any]:
        resources = await self._get_country_resources([country_code])
        return resources.get(country_code.upper(), {"note": "Economic data not available"})

    async def close(self) -> None:
        await self.http_client.aclose()


_agent: Optional[MaterialInterestAgent] = None


def get_material_interest_agent() -> MaterialInterestAgent:
    global _agent
    if _agent is None:
        _agent = MaterialInterestAgent()
    return _agent
