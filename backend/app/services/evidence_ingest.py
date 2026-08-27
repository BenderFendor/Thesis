"""Evidence-spine writers: turn external ownership datasets into evidence rows.

Each `ingest_*` function is one dataset writer producing the full chain
`EvidenceDocument -> DocumentSnapshot (sha256) -> EvidenceObservation ->
EvidenceClaim -> ClaimEvidence`, then routes the claim through tiered
acceptance:

- **tier-auto** sources (SEC EDGAR filings, Wikidata statements that carry a
  reference) mark their supporting observation `entailment="reviewed_yes"`
  with a system reviewer identity and call `evidence_spine.materialize_claim`
  (or, for attribute-only claims that have no `object_entity_id` such as MBFC
  bias ratings, evaluate + accept the claim directly -- `materialize_claim`
  only handles entity-to-entity claims) so the fact becomes an
  `AcceptedRelationship`/accepted claim through the *real* acceptance
  machinery in `evidence_policy.py`, not a parallel path.
- **tier-review** sources (LittleSis, MBFC ownership) create claims and stop:
  they stay `status="candidate"` for the human review queue in
  `wiki_evidence.py`.

Entity resolution always goes through `entity_resolver.resolve_or_create` so
these writers never re-diverge from the Phase 0 entity store.

Predicate choice matters for downstream math: `directly_owns` is one of the
two predicates `evidence_spine.INTEREST_PREDICATES` feeds into
`ownership_math.compute_indirect_interest` (the other, `owns_equity_in`, is
for minority equity stakes below control -- not used here). Every ownership
fact this module ingests (Wikidata P127/P749, LittleSis ownership/hierarchy,
MBFC ownership, EDGAR Exhibit-21 subsidiaries) is recorded as `directly_owns`
with `subject_entity_id` = the owned entity and `object_entity_id` = the
owner, matching `OwnershipEdge.owner_id`/`owned_id` in
`evidence_spine._all_accepted_interest_edges`. Non-ownership relations
(Wikidata P112 founder, P169 CEO) get their own predicates
(`founded_by`, `controls`) that do not participate in the interest math but
still evidence a fact through the same acceptance pipeline.

Reuses (never duplicates) the HTTP/parsing plumbing already in:
- `funding_researcher.py` (`FundingResearcher._fetch_wikidata_by_qid`,
  `_resolve_org_wikidata_sparql`, `_EDGAR_HEADERS`) for Wikidata + EDGAR.
- `littlesis_integration.py` (`load_littlesis_entities`,
  `load_littlesis_relationships`) for LittleSis bulk data.
- `mbfc_integration.py` (`build_mbfc_lookup`) for MBFC CSVs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.evidence import (
    AcceptedRelationship,
    ClaimEvidence,
    DocumentSnapshot,
    EntityExternalId,
    EvidenceClaim,
    EvidenceDocument,
    EvidenceEntity,
    EvidenceObservation,
)
from app.services.entity_resolver import resolve_or_create
from app.services.evidence_spine import (
    ContradictionError,
    EvidenceSpineError,
    canonical_json,
    evaluate_claim_by_id,
    materialize_claim,
    stable_hash,
)
from app.services.funding_researcher import _EDGAR_HEADERS, FundingResearcher
from app.services.littlesis_integration import (
    LITTLESIS_ENTITIES_FILE,
    LITTLESIS_RELATIONSHIPS_FILE,
    RELATIONSHIP_CATEGORIES_OF_INTEREST,
    download_littlesis_bulk,
    load_littlesis_entities,
    load_littlesis_relationships,
)
from app.services.ad_supply_transparency import ADS_TXT_MAX_BYTES, ads_txt_url, parse_ads_txt
from app.services.mbfc_integration import build_mbfc_lookup

logger = get_logger("evidence_ingest")

METHOD_VERSION = "evidence_ingest/1.0"

# Wikidata properties this ingestor reads off `raw_claims`.
_P_OWNED_BY = "P127"
_P_PARENT_ORG = "P749"
_P_FOUNDED_BY = "P112"
_P_CEO = "P169"
_P_PROPORTION = "P1107"  # "proportion" qualifier, when a statement carries one


@dataclass
class IngestReport:
    """Summary counters for one ingestor run."""

    source: str
    documents_created: int = 0
    snapshots_created: int = 0
    observations_created: int = 0
    claims_created: int = 0
    claims_deduped: int = 0
    accepted: int = 0
    candidates: int = 0
    acceptance_failures: list[str] = field(default_factory=list)
    adjudications_opened: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Shared spine-writing helpers -- every ingestor below goes through these so
# document/snapshot/observation/claim creation is uniformly idempotent.
# ---------------------------------------------------------------------------


async def _get_or_create_document(
    db: AsyncSession,
    *,
    document_id: str,
    source_url: str,
    document_type: str,
    source_class: str,
    title: str | None = None,
    issuer_entity_id: str | None = None,
    published_at: datetime | None = None,
    jurisdiction: str | None = None,
    report: IngestReport | None = None,
) -> EvidenceDocument:
    existing = await db.get(EvidenceDocument, document_id)
    if existing is not None:
        return existing
    document = EvidenceDocument(
        id=document_id,
        source_url=source_url,
        document_type=document_type,
        title=title,
        issuer_entity_id=issuer_entity_id,
        published_at=published_at,
        jurisdiction=jurisdiction,
        source_class=source_class,
    )
    db.add(document)
    await db.flush()
    if report is not None:
        report.documents_created += 1
    return document


async def _get_or_create_snapshot(
    db: AsyncSession,
    *,
    document_id: str,
    raw_bytes: bytes,
    retriever: str,
    retriever_version: str,
    retrieved_at: datetime,
    http_status: int | None = None,
    content_type: str | None = None,
    report: IngestReport | None = None,
) -> DocumentSnapshot:
    import hashlib

    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    existing = (
        await db.execute(select(DocumentSnapshot).where(DocumentSnapshot.sha256_raw == sha256))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    snapshot_id = f"snap_{sha256[:32]}"
    snapshot = DocumentSnapshot(
        id=snapshot_id,
        document_id=document_id,
        sha256_raw=sha256,
        storage_path=f"ingest://{document_id}/{sha256}",
        retrieved_at=retrieved_at,
        http_status=http_status,
        content_type=content_type,
        retriever=retriever,
        retriever_version=retriever_version,
        response_headers={},
    )
    db.add(snapshot)
    await db.flush()
    if report is not None:
        report.snapshots_created += 1
    return snapshot


async def _get_or_create_observation(
    db: AsyncSession,
    *,
    snapshot_id: str,
    locator: dict[str, Any],
    extractor: str,
    extractor_version: str,
    quoted_text: str | None = None,
    structured_value: dict[str, Any] | None = None,
    report: IngestReport | None = None,
) -> EvidenceObservation:
    observation_id = f"obs_{stable_hash(snapshot_id, locator, quoted_text, structured_value)[:32]}"
    existing = await db.get(EvidenceObservation, observation_id)
    if existing is not None:
        return existing
    observation = EvidenceObservation(
        id=observation_id,
        snapshot_id=snapshot_id,
        locator=locator,
        quoted_text=quoted_text,
        structured_value=structured_value,
        extractor=extractor,
        extractor_version=extractor_version,
        entailment="unevaluated",
    )
    db.add(observation)
    await db.flush()
    if report is not None:
        report.observations_created += 1
    return observation


def _claim_hash(
    subject_entity_id: str,
    predicate: str,
    object_entity_id: str | None,
    object_value: Any | None,
    qualifiers: dict[str, Any],
    method_version: str,
) -> str:
    return stable_hash(
        subject_entity_id, predicate, object_entity_id, object_value, qualifiers, method_version
    )


async def _get_or_create_claim(
    db: AsyncSession,
    *,
    subject_entity_id: str,
    predicate: str,
    object_entity_id: str | None,
    object_value: Any | None,
    qualifiers: dict[str, Any],
    asserted_by: str,
    evidence_class: str,
    valid_from: datetime | None = None,
    valid_to: datetime | None = None,
    report: IngestReport | None = None,
) -> tuple[EvidenceClaim, bool]:
    """Return `(claim, created)`; `created=False` means claim_hash deduped."""
    digest = _claim_hash(
        subject_entity_id, predicate, object_entity_id, object_value, qualifiers, METHOD_VERSION
    )
    existing = (
        await db.execute(select(EvidenceClaim).where(EvidenceClaim.claim_hash == digest))
    ).scalar_one_or_none()
    if existing is not None:
        if report is not None:
            report.claims_deduped += 1
        return existing, False
    claim_id = f"claim_{digest[:32]}"
    claim = EvidenceClaim(
        id=claim_id,
        subject_entity_id=subject_entity_id,
        predicate=predicate,
        object_entity_id=object_entity_id,
        object_value=object_value,
        qualifiers=qualifiers,
        valid_from=valid_from,
        valid_to=valid_to,
        asserted_by=asserted_by,
        evidence_class=evidence_class,
        status="candidate",
        method_version=METHOD_VERSION,
        claim_hash=digest,
    )
    db.add(claim)
    await db.flush()
    if report is not None:
        report.claims_created += 1
    return claim, True


async def _link_claim_evidence(
    db: AsyncSession, *, claim_id: str, observation_id: str, role: str = "supporting"
) -> None:
    existing = await db.get(ClaimEvidence, {"claim_id": claim_id, "observation_id": observation_id})
    if existing is not None:
        return
    db.add(ClaimEvidence(claim_id=claim_id, observation_id=observation_id, role=role))
    await db.flush()


async def _mark_observation_reviewed(
    db: AsyncSession, observation: EvidenceObservation, *, reviewer: str
) -> None:
    if cast(str, observation.entailment) == "reviewed_yes" and observation.reviewed_by:
        return
    observation.entailment = "reviewed_yes"
    observation.reviewed_by = reviewer
    observation.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
    await db.flush()


async def _auto_accept_relationship_claim(
    db: AsyncSession, claim: EvidenceClaim, *, reviewer: str, report: IngestReport
) -> AcceptedRelationship | None:
    """Materialize an entity-to-entity claim via the real acceptance pipeline.

    Returns `None` (not an error) when the policy declines to accept --
    the claim still exists as a review-queue candidate.
    """
    try:
        relationship = await materialize_claim(db, cast(str, claim.id), reviewer=reviewer)
    except ContradictionError as exc:
        report.adjudications_opened.append(f"{claim.id}: {exc.adjudication_item_id}")
        report.candidates += 1
        return None
    except EvidenceSpineError as exc:
        report.acceptance_failures.append(f"{claim.id}: {exc}")
        report.candidates += 1
        return None
    report.accepted += 1
    return relationship


async def _auto_accept_attribute_claim(
    db: AsyncSession, claim: EvidenceClaim, *, reviewer: str, report: IngestReport
) -> bool:
    """Accept an attribute (`object_value`-only) claim directly.

    `evidence_spine.materialize_claim` only handles entity-to-entity claims
    (it raises for `object_entity_id is None`), and attribute assessments
    like MBFC bias ratings have no relationship to materialize into an
    `AcceptedRelationship` -- there is no second entity. Accepting one here
    still runs the exact same evaluation `materialize_claim` uses
    (`evidence_spine.evaluate_claim_by_id`, which resolves each observation's
    evidence class from its linked document and lineage-resolves root
    counting -- reused rather than reimplemented); this only skips the
    `AcceptedRelationship` materialization step, which does not apply to
    non-relational claims.
    """
    evaluation = await evaluate_claim_by_id(db, cast(str, claim.id))
    if not evaluation.accepted:
        report.acceptance_failures.append(f"{claim.id}: {'; '.join(evaluation.reasons)}")
        report.candidates += 1
        return False
    claim.status = "accepted"
    await db.flush()
    report.accepted += 1
    return True


# ---------------------------------------------------------------------------
# 1. Wikidata ownership claims (P127/P749/P112/P169)
# ---------------------------------------------------------------------------


def _wikidata_document_id(qid: str, prop: str, statement_id: Any) -> str:
    return f"doc_wikidata_{stable_hash(qid, prop, statement_id)[:40]}"


def _wikidata_legacy_document_id(qid: str, prop: str, statement_id: Any) -> str:
    """The pre-2026-08-27 readable id; probed so re-ingests reuse old documents."""
    return f"doc_wikidata_{qid}_{prop}_{statement_id}"


async def _get_or_create_wikidata_document(
    db: AsyncSession,
    *,
    qid: str,
    prop: str,
    statement_id: Any,
    **kwargs: Any,
) -> EvidenceDocument:
    """Get-or-create the statement document, probing the legacy id first.

    The id format changed on 2026-08-27 (readable -> stable hash): documents
    created before that carry the old id, so a re-ingest must look both up
    instead of orphaning a duplicate row per statement.
    """
    doc_id = _wikidata_document_id(qid, prop, statement_id)
    document = await db.get(EvidenceDocument, doc_id)
    if document is None:
        document = await db.get(
            EvidenceDocument, _wikidata_legacy_document_id(qid, prop, statement_id)
        )
    if document is None:
        document = await _get_or_create_document(db, document_id=doc_id, **kwargs)
    return document


def _statement_has_reference(statement: dict[str, Any]) -> bool:
    refs = statement.get("references")
    return bool(refs)


def _statement_proportion(statement: dict[str, Any]) -> float | None:
    qualifiers = statement.get("qualifiers") or {}
    for snak in qualifiers.get(_P_PROPORTION, []):
        datavalue = (snak.get("datavalue") or {}).get("value") or {}
        amount = datavalue.get("amount") if isinstance(datavalue, dict) else None
        if amount is None:
            continue
        try:
            return float(str(amount).lstrip("+")) * 100.0
        except ValueError:
            continue
    return None


async def _resolve_wikidata_entity(
    db: AsyncSession, *, qid: str, name: str, record_kind: str
) -> EvidenceEntity:
    return await resolve_or_create(
        db,
        record_kind=record_kind,
        external_ids={"wikidata_qid": qid},
        candidate_name=name,
    )


async def _ingest_wikidata_qid(
    db: AsyncSession,
    researcher: FundingResearcher,
    *,
    qid: str,
    subject_entity: EvidenceEntity,
    reviewer: str,
    report: IngestReport,
) -> list[str]:
    """Ingest one Wikidata item's ownership/founder/CEO statements.

    Returns the list of owner QIDs discovered (P127 + P749), for BFS
    expansion by the caller.
    """
    result = await researcher._fetch_wikidata_by_qid(qid)  # noqa: SLF001 -- intentional reuse
    if not result:
        return []
    raw_claims = cast(dict[str, Any], result.get("raw_claims") or {})
    labels = cast(dict[str, str], result.get("labels") or {})
    wikidata_url = cast(str, result.get("wikidata_url") or f"https://www.wikidata.org/wiki/{qid}")

    async def _statement_snapshot(
        prop: str, statement: dict[str, Any], *, referenced: bool
    ) -> DocumentSnapshot:
        # One document+snapshot per statement (not per Wikidata item): a
        # single item mixes referenced and unreferenced statements across
        # properties, and `evidence_spine.evaluate_claim_by_id` gates
        # acceptance on the linked *document's* `source_class`, so each
        # statement's citation status must be recorded on its own document.
        statement_id = statement.get("id") or stable_hash(prop, statement)[:16]
        document = await _get_or_create_wikidata_document(
            db,
            qid=qid,
            prop=prop,
            statement_id=statement_id,
            source_url=f"{wikidata_url}#{statement_id}",
            document_type="wikidata_statement",
            source_class=(
                "wikidata_referenced_statement" if referenced else "third_party_assessment"
            ),
            title=f"Wikidata item {qid}, property {prop}, statement {statement_id}",
            report=report,
        )
        return await _get_or_create_snapshot(
            db,
            document_id=cast(str, document.id),
            raw_bytes=canonical_json({"qid": qid, "property": prop, "statement": statement}).encode(
                "utf-8"
            ),
            retriever="evidence_ingest.wikidata",
            retriever_version=METHOD_VERSION,
            retrieved_at=datetime.now(UTC).replace(tzinfo=None),
            content_type="application/json",
            report=report,
        )

    owner_qids: list[str] = []

    async def _handle_ownership_property(prop: str, predicate: str) -> None:
        for statement in raw_claims.get(prop, []):
            mainsnak = statement.get("mainsnak") or {}
            datavalue = mainsnak.get("datavalue") or {}
            value = datavalue.get("value") or {}
            owner_qid_raw = value.get("id") if isinstance(value, dict) else None
            if not owner_qid_raw:
                continue
            owner_qid = cast(str, owner_qid_raw)
            owner_label = labels.get(owner_qid, owner_qid)
            owner_entity = await _resolve_wikidata_entity(
                db, qid=owner_qid, name=owner_label, record_kind="legal_entity"
            )
            owner_qids.append(owner_qid)

            referenced = _statement_has_reference(statement)
            proportion = _statement_proportion(statement)
            qualifiers: dict[str, Any] = {"direct": True, "interest": "economic"}
            if proportion is not None:
                qualifiers["pct"] = proportion
            evidence_class = (
                "wikidata_referenced_statement" if referenced else "third_party_assessment"
            )

            snapshot = await _statement_snapshot(prop, statement, referenced=referenced)
            observation = await _get_or_create_observation(
                db,
                snapshot_id=cast(str, snapshot.id),
                locator={"property": prop, "statement_id": statement.get("id")},
                extractor="evidence_ingest.wikidata",
                extractor_version=METHOD_VERSION,
                structured_value={
                    "property": prop,
                    "subject_qid": qid,
                    "object_qid": owner_qid,
                    "object_label": owner_label,
                    "referenced": referenced,
                    "proportion_pct": proportion,
                },
                report=report,
            )
            claim, _created = await _get_or_create_claim(
                db,
                subject_entity_id=cast(str, subject_entity.id),
                predicate=predicate,
                object_entity_id=cast(str, owner_entity.id),
                object_value=None,
                qualifiers=qualifiers,
                asserted_by="evidence_ingest:wikidata",
                evidence_class=evidence_class,
                report=report,
            )
            await _link_claim_evidence(
                db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
            )

            if referenced:
                # Tier-auto: a Wikidata statement with a citation is treated as
                # attributable third-party evidence -- mark the observation
                # reviewed by the ingest pipeline and materialize.
                await _mark_observation_reviewed(db, observation, reviewer=reviewer)
                await _auto_accept_relationship_claim(db, claim, reviewer=reviewer, report=report)
            else:
                # Tier-review: unreferenced statements stay candidates.
                report.candidates += 1

    await _handle_ownership_property(_P_OWNED_BY, "directly_owns")
    await _handle_ownership_property(_P_PARENT_ORG, "directly_owns")

    async def _handle_person_property(prop: str, predicate: str) -> None:
        for statement in raw_claims.get(prop, []):
            mainsnak = statement.get("mainsnak") or {}
            datavalue = mainsnak.get("datavalue") or {}
            value = datavalue.get("value") or {}
            person_qid_raw = value.get("id") if isinstance(value, dict) else None
            if not person_qid_raw:
                continue
            person_qid = cast(str, person_qid_raw)
            person_label = labels.get(person_qid, person_qid)
            person_entity = await _resolve_wikidata_entity(
                db, qid=person_qid, name=person_label, record_kind="person"
            )
            referenced = _statement_has_reference(statement)
            evidence_class = (
                "wikidata_referenced_statement" if referenced else "third_party_assessment"
            )
            snapshot = await _statement_snapshot(prop, statement, referenced=referenced)
            observation = await _get_or_create_observation(
                db,
                snapshot_id=cast(str, snapshot.id),
                locator={"property": prop, "statement_id": statement.get("id")},
                extractor="evidence_ingest.wikidata",
                extractor_version=METHOD_VERSION,
                structured_value={
                    "property": prop,
                    "subject_qid": qid,
                    "object_qid": person_qid,
                    "object_label": person_label,
                    "referenced": referenced,
                },
                report=report,
            )
            claim, _created = await _get_or_create_claim(
                db,
                subject_entity_id=cast(str, subject_entity.id),
                predicate=predicate,
                object_entity_id=cast(str, person_entity.id),
                object_value=None,
                qualifiers={},
                asserted_by="evidence_ingest:wikidata",
                evidence_class=evidence_class,
                report=report,
            )
            await _link_claim_evidence(
                db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
            )
            if referenced:
                await _mark_observation_reviewed(db, observation, reviewer=reviewer)
                await _auto_accept_relationship_claim(db, claim, reviewer=reviewer, report=report)
            else:
                report.candidates += 1

    await _handle_person_property(_P_FOUNDED_BY, "founded_by")
    await _handle_person_property(_P_CEO, "controls")

    return owner_qids


async def ingest_wikidata_ownership_claims(
    db: AsyncSession,
    *,
    seed_entity_ids: list[str] | None = None,
    limit: int | None = None,
    max_depth: int = 3,
    researcher: FundingResearcher | None = None,
) -> IngestReport:
    """BFS Wikidata P127/P749/P112/P169 outward from catalog outlets.

    `seed_entity_ids` are `EvidenceEntity.id`s (normally `publication`
    entities already resolved to a `wikidata_qid` external id by
    `entity_backfill`). When omitted, every publication entity carrying a
    `wikidata_qid` external id is used (capped by `limit`). Walks ownership
    ancestors (ownership ancestors only, not descendants) up to `max_depth`
    hops -- not a bulk import.
    """
    report = IngestReport(source="wikidata")
    active_researcher = researcher or FundingResearcher()

    seeds: list[tuple[str, str]] = []  # (entity_id, qid)
    if seed_entity_ids:
        for entity_id in seed_entity_ids:
            row = (
                await db.execute(
                    select(EntityExternalId).where(
                        EntityExternalId.entity_id == entity_id,
                        EntityExternalId.scheme == "wikidata_qid",
                    )
                )
            ).scalar_one_or_none()
            if row is not None:
                seeds.append((entity_id, cast(str, row.value)))
    else:
        rows = list(
            (
                await db.execute(
                    select(EntityExternalId, EvidenceEntity)
                    .join(EvidenceEntity, EvidenceEntity.id == EntityExternalId.entity_id)
                    .where(
                        EntityExternalId.scheme == "wikidata_qid",
                        EvidenceEntity.record_kind == "publication",
                    )
                )
            ).all()
        )
        for ext_id, entity in rows:
            seeds.append((cast(str, entity.id), cast(str, ext_id.value)))
    if limit is not None:
        seeds = seeds[:limit]

    reviewer = "auto-ingest:wikidata:" + METHOD_VERSION
    visited_qids: set[str] = set()
    for entity_id, qid in seeds:
        entity = await db.get(EvidenceEntity, entity_id)
        if entity is None:
            continue
        frontier = [qid]
        depth = 0
        current_entity = entity
        while frontier and depth < max_depth:
            next_frontier: list[str] = []
            for current_qid in frontier:
                if current_qid in visited_qids:
                    continue
                visited_qids.add(current_qid)
                owner_qids = await _ingest_wikidata_qid(
                    db,
                    active_researcher,
                    qid=current_qid,
                    subject_entity=current_entity,
                    reviewer=reviewer,
                    report=report,
                )
                next_frontier.extend(owner_qids)
            if not next_frontier:
                break
            # Each subsequent hop's "subject" is whichever owner entity we
            # just resolved -- walk ancestors one owner at a time so every
            # hop's claim subject/object direction stays correct.
            for owner_qid in next_frontier:
                owner_row = (
                    await db.execute(
                        select(EntityExternalId).where(
                            EntityExternalId.scheme == "wikidata_qid",
                            EntityExternalId.value == owner_qid,
                        )
                    )
                ).scalar_one_or_none()
                if owner_row is None:
                    continue
                owner_entity = await db.get(EvidenceEntity, owner_row.entity_id)
                if owner_entity is None or owner_qid in visited_qids:
                    continue
                current_entity = owner_entity
                frontier = [owner_qid]
                break
            else:
                break
            depth += 1
    return report


# ---------------------------------------------------------------------------
# 2. LittleSis ownership/hierarchy relationships (tier-review)
# ---------------------------------------------------------------------------


def _littlesis_document_id(relationship_id: Any) -> str:
    return f"doc_littlesis_rel_{relationship_id}"


async def ingest_littlesis_ownership(
    db: AsyncSession,
    *,
    entities_file: str | None = None,
    relationships_file: str | None = None,
    limit: int | None = None,
) -> IngestReport:
    """Ingest LittleSis ownership (category 10) / hierarchy (category 11) edges.

    Crowd-sourced (CC BY-SA), so every claim here is tier-review: created as
    a `status="candidate"` `EvidenceClaim` and left for the human review
    queue in `wiki_evidence.py` -- never auto-materialized.

    LittleSis relationship rows model `entity1`/`entity2` without a single
    documented "which field is the owner" convention across categories; this
    ingestor follows LittleSis's own relationship-description convention
    (`entity1` holds the position described by `description1`, e.g. "Owns" /
    "Parent of") and treats `entity1` as the owner, `entity2` as the owned
    entity, for both category 10 (ownership) and 11 (hierarchy).
    """
    report = IngestReport(source="littlesis")
    if entities_file is None and relationships_file is None:
        # Auto-download is idempotent (download_littlesis_bulk skips any
        # file already cached) and degrades gracefully offline -- it never
        # raises, just logs one warning and leaves the file absent.
        downloaded = await download_littlesis_bulk()
        entities_file = downloaded.get(LITTLESIS_ENTITIES_FILE, entities_file)
        relationships_file = downloaded.get(LITTLESIS_RELATIONSHIPS_FILE, relationships_file)
    entities = load_littlesis_entities(entities_file)
    if not entities:
        return report
    entities_by_id: dict[int, dict[str, Any]] = {}
    for entity in entities:
        eid = entity.get("id")
        if eid is not None:
            entities_by_id[int(eid)] = entity

    relationships = load_littlesis_relationships(relationships_file)
    ownership_relationships = [
        rel
        for rel in relationships
        if RELATIONSHIP_CATEGORIES_OF_INTEREST.get(
            int(rel.get("category_id", -1))
            if str(rel.get("category_id", "")).lstrip("-").isdigit()
            else -1
        )
        in ("ownership", "hierarchy")
    ]
    if limit is not None:
        ownership_relationships = ownership_relationships[:limit]

    for rel in ownership_relationships:
        entity1_id = rel.get("entity1_id")
        entity2_id = rel.get("entity2_id")
        rel_id = rel.get("id")
        if entity1_id is None or entity2_id is None or rel_id is None:
            continue
        owner_raw = entities_by_id.get(int(entity1_id))
        owned_raw = entities_by_id.get(int(entity2_id))
        if not owner_raw or not owned_raw:
            continue
        owner_name = str(owner_raw.get("name", "")).strip()
        owned_name = str(owned_raw.get("name", "")).strip()
        if not owner_name or not owned_name:
            continue

        owner_entity = await resolve_or_create(
            db,
            record_kind="legal_entity",
            external_ids={"littlesis_id": str(entity1_id)},
            candidate_name=owner_name,
        )
        owned_entity = await resolve_or_create(
            db,
            record_kind="legal_entity",
            external_ids={"littlesis_id": str(entity2_id)},
            candidate_name=owned_name,
        )

        document = await _get_or_create_document(
            db,
            document_id=_littlesis_document_id(rel_id),
            source_url=f"https://littlesis.org/relationships/{rel_id}",
            document_type="littlesis_relationship",
            source_class="third_party_assessment",
            title=f"LittleSis relationship {rel_id}: {owner_name} / {owned_name}",
            report=report,
        )
        snapshot = await _get_or_create_snapshot(
            db,
            document_id=cast(str, document.id),
            raw_bytes=canonical_json(rel).encode("utf-8"),
            retriever="evidence_ingest.littlesis",
            retriever_version=METHOD_VERSION,
            retrieved_at=datetime.now(UTC).replace(tzinfo=None),
            content_type="application/json",
            report=report,
        )
        observation = await _get_or_create_observation(
            db,
            snapshot_id=cast(str, snapshot.id),
            locator={"relationship_id": rel_id},
            extractor="evidence_ingest.littlesis",
            extractor_version=METHOD_VERSION,
            structured_value={
                "entity1": owner_name,
                "entity2": owned_name,
                "category_id": rel.get("category_id"),
                "description1": rel.get("description1"),
                "description2": rel.get("description2"),
            },
            report=report,
        )
        claim, _created = await _get_or_create_claim(
            db,
            subject_entity_id=cast(str, owned_entity.id),
            predicate="directly_owns",
            object_entity_id=cast(str, owner_entity.id),
            object_value=None,
            qualifiers={"direct": True, "interest": "economic"},
            asserted_by="evidence_ingest:littlesis",
            evidence_class="third_party_assessment",
            report=report,
        )
        await _link_claim_evidence(
            db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
        )
        report.candidates += 1

    return report


# ---------------------------------------------------------------------------
# 3. MBFC ownership + bias/factuality ratings
# ---------------------------------------------------------------------------

_OWNERSHIP_PREFIX_RE = re.compile(r"^(owned by|owner:?)\s+", re.IGNORECASE)


def _mbfc_owner_name(raw_ownership: str) -> str | None:
    cleaned = _OWNERSHIP_PREFIX_RE.sub("", raw_ownership.strip()).strip(" .")
    return cleaned or None


async def ingest_mbfc_ownership(
    db: AsyncSession,
    *,
    factuality_file: str | None = None,
    bias_file: str | None = None,
    ownership_file: str | None = None,
    catalog_domains: dict[str, str] | None = None,
    limit: int | None = None,
) -> IngestReport:
    """Ingest MBFC ownership (tier-review) plus bias/factuality ratings.

    Bias/factuality are MBFC's own published editorial assessment, not an
    asserted ground-truth fact about the outlet -- recorded as `object_value`
    claims (`bias_rating`/`factual_reporting`) with `evidence_class`
    `"third_party_assessment"` and `asserted_by="mbfc"` so the UI can show
    "MBFC rates this outlet ..." rather than presenting it as verified.
    These auto-accept (tier-auto) because that attribution is exactly what
    MBFC published; ownership claims (MBFC does not disclose its sourcing
    for the ownership column) stay tier-review.

    `catalog_domains` maps normalized outlet name -> domain, used to resolve
    the MBFC row to the same `publication` entity the RSS catalog backfill
    created (matching on domain, the same key `entity_backfill` uses).
    """
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        lookup = build_mbfc_lookup(factuality_file, bias_file, ownership_file)
    report = IngestReport(source="mbfc")
    reviewer = "auto-ingest:mbfc:" + METHOD_VERSION
    domains = catalog_domains or {}

    entries = list(lookup.items())
    if limit is not None:
        entries = entries[:limit]
    for normalized_name, entry in entries:
        mbfc_name = entry.get("mbfc_name", normalized_name)
        domain = domains.get(normalized_name)
        external_ids = {"mbfc_name": normalized_name}
        if domain:
            external_ids["domain"] = domain
        outlet_entity = await resolve_or_create(
            db,
            record_kind="publication",
            external_ids=external_ids,
            candidate_name=mbfc_name,
        )

        document = await _get_or_create_document(
            db,
            document_id=f"doc_mbfc_{stable_hash(normalized_name)[:24]}",
            source_url="https://huggingface.co/datasets/zainmujahid/mbfc-media-outlets",
            document_type="mbfc_dataset_row",
            source_class="third_party_assessment",
            title=f"MBFC outlet record: {mbfc_name}",
            report=report,
        )
        snapshot = await _get_or_create_snapshot(
            db,
            document_id=cast(str, document.id),
            raw_bytes=canonical_json(entry).encode("utf-8"),
            retriever="evidence_ingest.mbfc",
            retriever_version=METHOD_VERSION,
            retrieved_at=datetime.now(UTC).replace(tzinfo=None),
            content_type="text/csv",
            report=report,
        )

        ownership_raw = entry.get("ownership")
        if ownership_raw:
            owner_name = _mbfc_owner_name(ownership_raw)
            if owner_name:
                owner_entity = await resolve_or_create(
                    db,
                    record_kind="legal_entity",
                    external_ids={"mbfc_owner_name": owner_name.lower()},
                    candidate_name=owner_name,
                )
                observation = await _get_or_create_observation(
                    db,
                    snapshot_id=cast(str, snapshot.id),
                    locator={"field": "ownership"},
                    extractor="evidence_ingest.mbfc",
                    extractor_version=METHOD_VERSION,
                    quoted_text=ownership_raw,
                    report=report,
                )
                claim, _created = await _get_or_create_claim(
                    db,
                    subject_entity_id=cast(str, outlet_entity.id),
                    predicate="directly_owns",
                    object_entity_id=cast(str, owner_entity.id),
                    object_value=None,
                    qualifiers={"direct": True, "interest": "economic"},
                    asserted_by="evidence_ingest:mbfc",
                    evidence_class="third_party_assessment",
                    report=report,
                )
                await _link_claim_evidence(
                    db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
                )
                report.candidates += 1

        for field_name, predicate in (("bias", "bias_rating"), ("factuality", "factual_reporting")):
            value = entry.get(field_name)
            if not value:
                continue
            observation = await _get_or_create_observation(
                db,
                snapshot_id=cast(str, snapshot.id),
                locator={"field": field_name},
                extractor="evidence_ingest.mbfc",
                extractor_version=METHOD_VERSION,
                structured_value={"rating": value, "source": "mbfc"},
                report=report,
            )
            claim, _created = await _get_or_create_claim(
                db,
                subject_entity_id=cast(str, outlet_entity.id),
                predicate=predicate,
                object_entity_id=None,
                object_value={"rating": value, "source": "mbfc"},
                qualifiers={},
                asserted_by="mbfc",
                evidence_class="third_party_assessment",
                report=report,
            )
            await _link_claim_evidence(
                db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
            )
            await _mark_observation_reviewed(db, observation, reviewer=reviewer)
            await _auto_accept_attribute_claim(db, claim, reviewer=reviewer, report=report)

    return report


# ---------------------------------------------------------------------------
# 4. SEC EDGAR Exhibit-21 subsidiary lists (tier-auto)
# ---------------------------------------------------------------------------

_EX21_LINK_RE = re.compile(r'href="([^"]*ex-?21[^"]*\.htm[l]?)"', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


async def _fetch_edgar_json(client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
    response = await client.get(url, headers=_EDGAR_HEADERS)
    if response.status_code != 200:
        return None
    return cast(dict[str, Any], response.json())


async def _fetch_edgar_text(client: httpx.AsyncClient, url: str) -> tuple[str, bytes] | None:
    response = await client.get(url, headers=_EDGAR_HEADERS)
    if response.status_code != 200:
        return None
    return response.text, response.content


def _parse_exhibit_21(html: str) -> list[tuple[str, str]]:
    """Parse a `(subsidiary name, jurisdiction)` pair list out of an Exhibit-21 HTML doc.

    Exhibit 21 filings are free-form HTML tables with no fixed schema across
    filers; the one structural convention they share is a two-column
    "Entity Name" / "Country [or State] of ..." table. This strips tags to a
    flat token stream, locates that header pair, then reads the remaining
    tokens as alternating (name, jurisdiction) pairs -- the same shape
    verified against a real live SEC EDGAR Exhibit 21.1 filing during
    development (see docs/agents/traces for the manual verification notes).
    """
    text = _TAG_RE.sub("|", html)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    text = re.sub(r"\|+", "|", text)
    tokens = [tok.strip() for tok in text.split("|") if tok.strip()]

    header_idx = None
    for i in range(len(tokens) - 1):
        if tokens[i].lower().startswith("entity name") and "country" in tokens[i + 1].lower():
            header_idx = i + 2
            break
        if tokens[i].lower().startswith("entity name") and "state" in tokens[i + 1].lower():
            header_idx = i + 2
            break
    if header_idx is None:
        return []

    pairs: list[tuple[str, str]] = []
    remaining = tokens[header_idx:]
    for i in range(0, len(remaining) - 1, 2):
        name, jurisdiction = remaining[i], remaining[i + 1]
        if len(name) > 200 or len(jurisdiction) > 100:
            break
        pairs.append((name, jurisdiction))
    return pairs


async def _find_latest_10k(client: httpx.AsyncClient, cik: str) -> tuple[str, str, str, str] | None:
    """Return `(accession_no_dashes, accession_with_dashes, primary_doc, filing_date)`."""
    cik_padded = cik.zfill(10)
    data = await _fetch_edgar_json(client, f"https://data.sec.gov/submissions/CIK{cik_padded}.json")
    if data is None:
        return None
    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    for i, form in enumerate(forms):
        if form != "10-K":
            continue
        accession = recent["accessionNumber"][i]
        primary_doc = recent["primaryDocument"][i]
        filing_date = recent["filingDate"][i]
        return accession.replace("-", ""), accession, primary_doc, filing_date
    return None


async def ingest_edgar_subsidiaries(
    db: AsyncSession,
    *,
    ciks: dict[str, str],
    client: httpx.AsyncClient | None = None,
) -> IngestReport:
    """Ingest Exhibit-21 consolidated-subsidiary lists for public parent companies.

    `ciks` maps CIK (with or without leading zeros) -> parent company display
    name, e.g. `{"1437107": "Warner Bros. Discovery, Inc."}`. Primary legal
    filings, so each accepted subsidiary listing tier-autos: the observation
    is marked reviewed by the ingest pipeline and the claim is materialized
    directly.

    Exhibit 21 lists consolidated subsidiaries but does not disclose an
    ownership percentage for each one; per SEC/GAAP consolidation rules a
    listed subsidiary implies majority (typically wholly-owned) control, but
    this ingestor does not assert a percentage figure it cannot cite from the
    filing itself. These `directly_owns` claims therefore materialize
    without a `pct`/`pct_band` qualifier and are excluded from
    `ownership_math.compute_indirect_interest`'s numeric range (which
    requires a quantified interest on every edge in the path) until a
    percentage-bearing source (e.g. a proxy statement or Wikidata
    P1107-qualified statement) supplies one.
    """
    report = IngestReport(source="edgar")
    owned_client = client is None
    http_client = client or httpx.AsyncClient(timeout=30.0, follow_redirects=True)
    reviewer = "auto-ingest:edgar:" + METHOD_VERSION

    try:
        for cik, parent_name in ciks.items():
            cik_clean = cik.lstrip("0") or "0"
            parent_entity = await resolve_or_create(
                db,
                record_kind="legal_entity",
                external_ids={"cik": cik_clean},
                candidate_name=parent_name,
            )

            found = await _find_latest_10k(http_client, cik_clean)
            if found is None:
                continue
            accession_nodash, accession, primary_doc, filing_date = found

            index_url = f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{accession_nodash}/"
            index_result = await _fetch_edgar_text(http_client, index_url)
            if index_result is None:
                continue
            index_html, _ = index_result
            link_match = _EX21_LINK_RE.search(index_html)
            if link_match is None:
                continue
            ex21_path = link_match.group(1)
            ex21_url = (
                ex21_path
                if ex21_path.startswith("http")
                else f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{accession_nodash}/{ex21_path.lstrip('/')}"
            )
            ex21_result = await _fetch_edgar_text(http_client, ex21_url)
            if ex21_result is None:
                continue
            ex21_html, ex21_bytes = ex21_result
            subsidiaries = _parse_exhibit_21(ex21_html)
            if not subsidiaries:
                continue

            document = await _get_or_create_document(
                db,
                document_id=f"doc_edgar_ex21_{cik_clean}_{accession_nodash}",
                source_url=ex21_url,
                document_type="sec_exhibit_21",
                source_class="registry_filing",
                title=f"Exhibit 21 - {parent_name} - {accession}",
                issuer_entity_id=cast(str, parent_entity.id),
                published_at=datetime.strptime(filing_date, "%Y-%m-%d") if filing_date else None,
                jurisdiction="US",
                report=report,
            )
            snapshot = await _get_or_create_snapshot(
                db,
                document_id=cast(str, document.id),
                raw_bytes=ex21_bytes,
                retriever="evidence_ingest.edgar",
                retriever_version=METHOD_VERSION,
                retrieved_at=datetime.now(UTC).replace(tzinfo=None),
                content_type="text/html",
                report=report,
            )
            for index, (name, jurisdiction) in enumerate(subsidiaries):
                subsidiary_entity = await resolve_or_create(
                    db,
                    record_kind="legal_entity",
                    external_ids={"edgar_subsidiary": f"{cik_clean}:{name.lower()}"},
                    candidate_name=name,
                )
                observation = await _get_or_create_observation(
                    db,
                    snapshot_id=cast(str, snapshot.id),
                    locator={"row": index, "field": "entity_name"},
                    extractor="evidence_ingest.edgar",
                    extractor_version=METHOD_VERSION,
                    quoted_text=f"{name} | {jurisdiction}",
                    structured_value={"name": name, "jurisdiction": jurisdiction},
                    report=report,
                )
                claim, _created = await _get_or_create_claim(
                    db,
                    subject_entity_id=cast(str, subsidiary_entity.id),
                    predicate="directly_owns",
                    object_entity_id=cast(str, parent_entity.id),
                    object_value=None,
                    qualifiers={
                        "direct": True,
                        "interest": "economic",
                        "consolidation_basis": "sec_exhibit_21_consolidated_subsidiary",
                    },
                    asserted_by="evidence_ingest:edgar",
                    evidence_class="registry_filing",
                    report=report,
                )
                await _link_claim_evidence(
                    db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
                )
                await _mark_observation_reviewed(db, observation, reviewer=reviewer)
                await _auto_accept_relationship_claim(db, claim, reviewer=reviewer, report=report)
    finally:
        if owned_client:
            await http_client.aclose()

    return report


async def ingest_ads_supply(
    db: AsyncSession,
    *,
    publishers: dict[str, str],
    client: httpx.AsyncClient | None = None,
    limit: int | None = None,
) -> IngestReport:
    """Capture ads.txt seller authorizations as candidate evidence claims.

    ``publishers`` maps an accepted publication entity id to its canonical
    website. Each claim keeps the exact publisher domain, seller account id,
    DIRECT/RESELLER relationship, and capture time. This adapter never
    accepts or materializes a relationship.
    """
    from urllib.parse import urlparse

    from app.core.config import SCOOP_BROWSER_UA

    report = IngestReport(source="ads_txt")
    owned_client = client is None
    http_client = client or httpx.AsyncClient(timeout=20.0, follow_redirects=True)
    try:
        items = (
            sorted(publishers.items())[:limit] if limit is not None else sorted(publishers.items())
        )
        unreachable_count = 0
        eligible_count = 0
        for publisher_entity_id, website in items:
            url = ads_txt_url(website)
            if url is None:
                continue
            eligible_count += 1
            try:
                response = await http_client.get(
                    url,
                    headers={"User-Agent": SCOOP_BROWSER_UA, "Accept": "text/plain,*/*;q=0.8"},
                    follow_redirects=True,
                )
            except httpx.HTTPError as exc:
                unreachable_count += 1
                logger.debug("ads_txt: publisher %s unreachable: %s", website, exc)
                continue
            if response.status_code != 200:
                continue
            raw = response.content[:ADS_TXT_MAX_BYTES]
            text = raw.decode(response.encoding or "utf-8", errors="replace")
            parsed = parse_ads_txt(text)
            retrieved_at = datetime.now(UTC).replace(tzinfo=None)
            publisher_domain = (urlparse(website).hostname or website).lower().removeprefix("www.")
            document = await _get_or_create_document(
                db,
                document_id=f"doc_ads_txt_{stable_hash(publisher_domain)[:24]}",
                source_url=str(response.url),
                document_type="ads_txt",
                source_class="ads_txt",
                issuer_entity_id=publisher_entity_id,
                report=report,
            )
            snapshot = await _get_or_create_snapshot(
                db,
                document_id=cast(str, document.id),
                raw_bytes=raw,
                retriever="httpx",
                retriever_version=METHOD_VERSION,
                retrieved_at=retrieved_at,
                http_status=response.status_code,
                content_type=response.headers.get("content-type"),
                report=report,
            )
            capture_time = cast(datetime, snapshot.retrieved_at)
            for index, record in enumerate(cast(list[dict[str, str]], parsed["records"])):
                ad_system = record["ad_system_domain"]
                account_id = record["publisher_account_id"]
                relationship_type = record["relationship"]
                seller = await resolve_or_create(
                    db,
                    record_kind="legal_entity",
                    entity_kind="seller_account",
                    external_ids={"seller_account": f"{ad_system}:{account_id}"},
                    candidate_name=f"{ad_system} seller {account_id}",
                )
                observation = await _get_or_create_observation(
                    db,
                    snapshot_id=cast(str, snapshot.id),
                    locator={"record_index": index},
                    quoted_text=f"{ad_system}, {account_id}, {relationship_type}",
                    structured_value=record,
                    extractor="ads_txt_parser",
                    extractor_version=METHOD_VERSION,
                    report=report,
                )
                claim, created = await _get_or_create_claim(
                    db,
                    subject_entity_id=publisher_entity_id,
                    predicate="authorizes_inventory_seller",
                    object_entity_id=cast(str, seller.id),
                    object_value=None,
                    qualifiers={
                        "publisher_domain": publisher_domain,
                        "seller_account_id": account_id,
                        "ad_system_domain": ad_system,
                        "relationship_type": relationship_type,
                        "captured_at": capture_time.isoformat(),
                        "lifecycle_state": "current",
                    },
                    asserted_by="ads_txt",
                    evidence_class="ads_txt",
                    valid_from=capture_time,
                    report=report,
                )
                await _link_claim_evidence(
                    db, claim_id=cast(str, claim.id), observation_id=cast(str, observation.id)
                )
                if created:
                    report.candidates += 1
        if unreachable_count:
            logger.info("ads_txt: skipped %d unreachable publishers", unreachable_count)
        if eligible_count and unreachable_count == eligible_count:
            raise EvidenceSpineError(f"ads_txt: all {eligible_count} publishers were unreachable")
        return report
    finally:
        if owned_client:
            await http_client.aclose()


# ---------------------------------------------------------------------------
# Smoke check: run ownership_math over the resulting DAG for named chains.
# ---------------------------------------------------------------------------


async def run_ownership_smoke_check(
    db: AsyncSession, *, owner_target_pairs: list[tuple[str, str]]
) -> list[dict[str, object]]:
    """Run `compute_ownership_interest` for each (owner_entity_id, target_entity_id) pair.

    Thin wrapper around `evidence_spine.compute_ownership_interest` (which
    persists nothing by itself -- CalculationTrace rows are written by
    `evidence_spine._record_interest_trace` as a side effect of
    `materialize_claim` on an interest-bearing claim, not by this function).
    Returns each pair's calculation trace dict for a caller (the CLI, or a
    test) to print/assert against.
    """
    from app.services.evidence_spine import compute_ownership_interest

    results: list[dict[str, object]] = []
    for owner_id, target_id in owner_target_pairs:
        trace = await compute_ownership_interest(db, owner_id=owner_id, target_id=target_id)
        results.append(trace)
    return results
