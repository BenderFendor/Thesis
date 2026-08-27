"""Soft-retired reporters must not leak through list/dossier endpoints.

`reporter_merge` / `reporter_split_backfill` soft-retire duplicate and
composite rows (`retirement_reason='merged'/'split', never deleted). Every
endpoint that serves the wiki directory, dossier, or reporter articles must
hide retired rows and follow `merged_into` the same way
`entity_research.get_reporter` does.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.database import ArticleAuthor, Reporter


def _seed_retired_reporters(seeded_db) -> None:
    """Winner(10), merged loser(11), split composite(12).

    The winner owns the article links that used to belong to the loser, as
    `reporter_merge` leaves them. The split composite keeps no links here,
    which is the state that endpoints must still hide from listings.
    """
    seeded_db.add_all(
        [
            Reporter(
                id=10,
                name="Eric Tucker",
                normalized_name="eric tucker",
                article_count=9,
                match_status="matched",
                career_history=[{"organization": "AP", "role": "reporter"}],
            ),
            Reporter(
                id=11,
                name="Eric Tucker",
                normalized_name="eric tucker",
                article_count=5,
                match_status="matched",
                retirement_reason="merged",
                merged_into=10,
            ),
            Reporter(
                id=12,
                name="John Smith & Jane Doe",
                normalized_name="john smith & jane doe",
                article_count=7,
                match_status="matched",
                retirement_reason="split",
                split_into=[1, 2],
            ),
            ArticleAuthor(article_id=1, reporter_id=10),
            ArticleAuthor(article_id=2, reporter_id=10),
        ]
    )


@pytest.mark.asyncio
async def test_wiki_directory_hides_retired_reporters(client: AsyncClient, seeded_db) -> None:
    _seed_retired_reporters(seeded_db)
    await seeded_db.commit()

    response = await client.get("/api/wiki/reporters?limit=500")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert {1, 2, 10}.issubset(ids)
    assert 11 not in ids  # merged loser must not appear again
    assert 12 not in ids  # split composite byline must not appear


@pytest.mark.asyncio
async def test_wiki_dossier_serves_winner_for_merged_id(client: AsyncClient, seeded_db) -> None:
    _seed_retired_reporters(seeded_db)
    await seeded_db.commit()

    response = await client.get("/api/wiki/reporters/11")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 10
    assert body["name"] == "Eric Tucker"
    assert body["article_count"] == 9
    assert {a["title"] for a in body["recent_articles"]} >= {"Article A", "Article B"}


@pytest.mark.asyncio
async def test_wiki_dossier_keeps_split_composite_reachable(client: AsyncClient, seeded_db) -> None:
    _seed_retired_reporters(seeded_db)
    await seeded_db.commit()

    response = await client.get("/api/wiki/reporters/12")
    assert response.status_code == 200
    assert response.json()["id"] == 12


@pytest.mark.asyncio
async def test_wiki_reporter_articles_follow_merge_chain(client: AsyncClient, seeded_db) -> None:
    _seed_retired_reporters(seeded_db)
    await seeded_db.commit()

    response = await client.get("/api/wiki/reporters/11/articles")
    assert response.status_code == 200
    titles = {a["title"] for a in response.json()}
    assert {"Article A", "Article B"}.issubset(titles)


@pytest.mark.asyncio
async def test_entity_research_list_hides_retired(client: AsyncClient, seeded_db) -> None:
    _seed_retired_reporters(seeded_db)
    await seeded_db.commit()

    response = await client.get("/research/entity/reporters?limit=200")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert ids == {1, 2, 10}


@pytest.mark.asyncio
async def test_wikidata_document_probes_legacy_id(db_session) -> None:
    """A document created under the old readable id must be reused, not
    duplicated by the new hashed id."""
    from app.models.evidence import EvidenceDocument

    from app.services.evidence_ingest import _get_or_create_wikidata_document

    legacy = EvidenceDocument(
        id="doc_wikidata_Q100_P127_Q100$OLD",
        source_url="https://www.wikidata.org/wiki/Q100#Q100$OLD",
        document_type="wikidata_statement",
        source_class="wikidata_referenced_statement",
    )
    db_session.add(legacy)
    await db_session.commit()

    document = await _get_or_create_wikidata_document(
        db_session,
        qid="Q100",
        prop="P127",
        statement_id="Q100$OLD",
        source_url="https://www.wikidata.org/wiki/Q100#Q100$OLD",
        document_type="wikidata_statement",
        source_class="wikidata_referenced_statement",
        title="Wikidata item Q100, property P127",
        report=None,
    )
    assert document.id == "doc_wikidata_Q100_P127_Q100$OLD"

    fresh = await _get_or_create_wikidata_document(
        db_session,
        qid="Q100",
        prop="P127",
        statement_id="Q100$NEW",
        source_url="https://www.wikidata.org/wiki/Q100#Q100$NEW",
        document_type="wikidata_statement",
        source_class="wikidata_referenced_statement",
        title="Wikidata item Q100, property P127",
        report=None,
    )
    assert fresh.id.startswith("doc_wikidata_")
    assert fresh.id != document.id
