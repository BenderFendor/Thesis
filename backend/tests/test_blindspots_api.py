from __future__ import annotations

from typing import Any

import pytest


class _StubViewerService:
    async def build_viewer(self, session: Any, **kwargs: Any) -> dict[str, Any]:
        return {
            "available_lenses": [
                {
                    "id": "bias",
                    "label": "Left vs Right",
                    "description": "Bias lens",
                    "available": True,
                    "unavailable_reason": None,
                },
                {
                    "id": "credibility",
                    "label": "Credible vs Uncredible",
                    "description": "Credibility lens",
                    "available": True,
                    "unavailable_reason": None,
                },
                {
                    "id": "geography",
                    "label": "Global North vs Global South",
                    "description": "Geography lens",
                    "available": True,
                    "unavailable_reason": None,
                },
                {
                    "id": "institutional_populist",
                    "label": "Institutional vs Populist",
                    "description": "SemAxis lens",
                    "available": True,
                    "unavailable_reason": None,
                },
            ],
            "selected_lens": {
                "id": "geography",
                "label": "Global North vs Global South",
                "description": "Geography lens",
                "available": True,
                "unavailable_reason": None,
            },
            "summary": {
                "window": "1w",
                "total_clusters": 1,
                "eligible_clusters": 1,
                "generated_at": "2026-03-27T00:00:00",
                "category": None,
                "source_filters": [],
            },
            "lanes": [
                {
                    "id": "pole_a",
                    "label": "For the Global North",
                    "description": "North lens",
                    "cluster_count": 1,
                },
                {
                    "id": "shared",
                    "label": "Shared Coverage",
                    "description": "Shared lens",
                    "cluster_count": 0,
                },
                {
                    "id": "pole_b",
                    "label": "For the Global South",
                    "description": "South lens",
                    "cluster_count": 0,
                },
            ],
            "cards": [
                {
                    "cluster_id": 101,
                    "cluster_label": "Brazil energy protests",
                    "keywords": ["brazil", "energy", "protests"],
                    "article_count": 4,
                    "source_count": 4,
                    "lane": "pole_b",
                    "blindspot_score": 2.5,
                    "balance_score": 0.25,
                    "published_at": "2026-03-26T12:00:00",
                    "explanation": "Test card",
                    "coverage_counts": {"pole_a": 1, "shared": 1, "pole_b": 2},
                    "coverage_shares": {
                        "pole_a": 0.25,
                        "shared": 0.25,
                        "pole_b": 0.5,
                    },
                    "representative_article": {
                        "id": 1,
                        "title": "Brazil energy protests",
                        "source": "Outlet A",
                        "url": "https://example.com/a",
                        "image_url": None,
                        "published_at": "2026-03-26T12:00:00",
                        "summary": "Summary",
                        "similarity": 0.91,
                    },
                    "articles": [],
                    "geography_signals": [
                        {
                            "id": "source_country",
                            "label": "Source country",
                            "count": 2,
                        },
                        {
                            "id": "baseline_country",
                            "label": "Baseline country",
                            "count": 2,
                        },
                    ],
                }
            ],
            "status": "ok",
        }


@pytest.mark.asyncio
async def test_blindspots_viewer_exposes_geography_signals(
    client,
    monkeypatch: pytest.MonkeyPatch,
):
    from app.api.routes import blindspots

    monkeypatch.setattr(
        blindspots,
        "get_blindspot_viewer_service",
        lambda: _StubViewerService(),
    )

    response = await client.get("/blindspots/viewer?lens=geography&window=1w")
    assert response.status_code == 200
    data = response.json()

    assert data["selected_lens"]["id"] == "geography"
    assert data["cards"][0]["geography_signals"] == [
        {"id": "source_country", "label": "Source country", "count": 2},
        {"id": "baseline_country", "label": "Baseline country", "count": 2},
    ]
