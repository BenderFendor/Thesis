"""Route-level regression tests for the materialize/proof-download auth gate.

PR #8 review (tracked as GitHub issue #9) found `POST
/api/wiki/evidence/claims/{claim_id}/materialize` had no authentication, no
reviewer-identity requirement, and no audit trail -- any unauthenticated
caller could convert a candidate claim into an accepted fact. These tests
exercise the real FastAPI route (not just the service function) to confirm
the fix: the endpoint fails closed until an operator token is configured,
requires a matching token plus a non-empty reviewer identity, and records
the reviewer on the resulting relationship. Proof downloads for
privacy-scoped entities are gated the same way.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.routes import wiki_evidence
from app.core.config import settings as real_settings
from app.database import Base, get_db
from app.models.evidence import (
    ClaimEvidence,
    DocumentSnapshot,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)

NOW = datetime(2026, 7, 20, tzinfo=UTC).replace(tzinfo=None)


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed_qualifying_claim(
    db: AsyncSession, *, claim_id: str, privacy_scope: str = "public"
) -> str:
    publication = EvidenceEntity(
        id=f"{claim_id}_pub",
        record_kind="publication",
        canonical_name="Example Daily",
        status="candidate",
        privacy_scope=privacy_scope,
    )
    owner = EvidenceEntity(
        id=f"{claim_id}_owner",
        record_kind="legal_entity",
        canonical_name="Example Holdings LLC",
        status="candidate",
    )
    document = EvidenceDocument(
        id=f"{claim_id}_doc",
        source_url=f"https://registry.example.test/{claim_id}",
        document_type="beneficial_ownership_filing",
        source_class="registry_filing",
    )
    snapshot = DocumentSnapshot(
        id=f"{claim_id}_snap",
        document_id=document.id,
        sha256_raw="a" * 64,
        storage_path=f"/var/scoop/snapshots/{claim_id}.warc",
        retrieved_at=NOW,
        retriever="test-retriever",
        retriever_version="1.0",
    )
    observation = EvidenceObservation(
        id=f"{claim_id}_obs",
        snapshot_id=snapshot.id,
        locator={"page": 1, "field": "beneficial_owner"},
        quoted_text="Example Holdings LLC holds 100% of Example Daily.",
        extractor="test-extractor",
        extractor_version="1.0",
        entailment="reviewed_yes",
        reviewed_by="reviewer@test",
    )
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=publication.id,
        predicate="directly_owns",
        object_entity_id=owner.id,
        qualifiers={"pct": 100, "direct": True},
        recorded_at=NOW,
        asserted_by="test/v1",
        evidence_class="registry_filing",
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{claim_id}",
    )
    db.add_all([publication, owner, document, snapshot, observation, claim])
    await db.flush()
    db.add(ClaimEvidence(claim_id=claim_id, observation_id=observation.id, role="supporting"))
    await db.commit()
    return claim_id


@pytest_asyncio.fixture
async def client(db: AsyncSession):
    app = FastAPI()
    app.include_router(wiki_evidence.router)

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def configured_token(monkeypatch: pytest.MonkeyPatch) -> str:
    token = "operator-secret"
    monkeypatch.setattr(
        wiki_evidence,
        "settings",
        replace(real_settings, scoop_materialize_token=token),
    )
    return token


@pytest.fixture
def unconfigured_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wiki_evidence,
        "settings",
        replace(real_settings, scoop_materialize_token=None),
    )


@pytest.mark.asyncio
async def test_materialize_fails_closed_when_token_not_configured(
    client: AsyncClient, db: AsyncSession, unconfigured_token: None
) -> None:
    claim_id = await _seed_qualifying_claim(db, claim_id="claim_unconfigured")
    response = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Reviewer": "alice", "X-Scoop-Materialize-Token": "anything"},
    )
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_materialize_rejects_missing_or_wrong_token(
    client: AsyncClient, db: AsyncSession, configured_token: str
) -> None:
    claim_id = await _seed_qualifying_claim(db, claim_id="claim_wrong_token")
    no_token = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Reviewer": "alice"},
    )
    assert no_token.status_code == 401

    wrong_token = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Reviewer": "alice", "X-Scoop-Materialize-Token": "not-it"},
    )
    assert wrong_token.status_code == 401


@pytest.mark.asyncio
async def test_materialize_requires_reviewer_header(
    client: AsyncClient, db: AsyncSession, configured_token: str
) -> None:
    claim_id = await _seed_qualifying_claim(db, claim_id="claim_no_reviewer_header")
    missing = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Materialize-Token": configured_token},
    )
    assert missing.status_code == 422

    blank = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Materialize-Token": configured_token, "X-Scoop-Reviewer": "   "},
    )
    assert blank.status_code == 422


@pytest.mark.asyncio
async def test_materialize_succeeds_with_token_and_reviewer_and_records_audit_trail(
    client: AsyncClient, db: AsyncSession, configured_token: str
) -> None:
    claim_id = await _seed_qualifying_claim(db, claim_id="claim_authorized")
    response = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Materialize-Token": configured_token, "X-Scoop-Reviewer": "alice"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["materialized_by"] == "alice"


@pytest.mark.asyncio
async def test_proof_download_is_open_for_public_entities(
    client: AsyncClient, db: AsyncSession, configured_token: str
) -> None:
    claim_id = await _seed_qualifying_claim(db, claim_id="claim_public_proof")
    materialize = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Materialize-Token": configured_token, "X-Scoop-Reviewer": "alice"},
    )
    relationship_id = materialize.json()["id"]

    response = await client.get(f"/api/wiki/evidence/relationships/{relationship_id}/proof")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_proof_download_requires_token_for_privacy_scoped_entities(
    client: AsyncClient, db: AsyncSession, configured_token: str
) -> None:
    claim_id = await _seed_qualifying_claim(
        db, claim_id="claim_restricted_proof", privacy_scope="restricted"
    )
    materialize = await client.post(
        f"/api/wiki/evidence/claims/{claim_id}/materialize",
        headers={"X-Scoop-Materialize-Token": configured_token, "X-Scoop-Reviewer": "alice"},
    )
    relationship_id = materialize.json()["id"]

    unauthenticated = await client.get(f"/api/wiki/evidence/relationships/{relationship_id}/proof")
    assert unauthenticated.status_code == 401

    authenticated = await client.get(
        f"/api/wiki/evidence/relationships/{relationship_id}/proof",
        headers={"X-Scoop-Materialize-Token": configured_token},
    )
    assert authenticated.status_code == 200
