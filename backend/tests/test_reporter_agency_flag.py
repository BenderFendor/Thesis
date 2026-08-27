"""Agency/collective row flagging (audit rec 4)."""

from __future__ import annotations

import pytest

from app.database import Reporter
from app.models.evidence import EntityExternalId, EvidenceClaim
from app.services.reporter_agency_flag import flag_agency_reporters, is_agency_name


@pytest.mark.parametrize(
    "name, expected",
    [
        ("AP", True),
        ("RT", True),
        ("SG", True),
        ("AFP", True),
        ("Reuters", True),
        ("Agencies", True),
        ("Bloomberg News", True),
        ("Associated Press", True),
        ("The Associated Press", True),
        ("Agence France-Presse", True),
        ("Agence France-Press", True),
        ("Jane Reporter", False),
        ("Bloomberg", False),  # not the exact known agency name
        ("Reuters Correspondent", False),
    ],
)
def test_is_agency_name(name: str, expected: bool) -> None:
    assert is_agency_name(name.lower()) is expected


@pytest.mark.asyncio
async def test_flag_agency_reporters_sets_flag_and_retracts_claim(db_session) -> None:
    reporter = Reporter(name="Reuters", normalized_name="reuters", article_count=5)
    real_reporter = Reporter(name="Jane Reporter", normalized_name="jane reporter", article_count=5)
    db_session.add_all([reporter, real_reporter])
    await db_session.commit()

    person = _make_person(f"ent_{reporter.id}", reporter.id)
    db_session.add(person)
    await db_session.flush()
    db_session.add(
        EntityExternalId(entity_id=person.id, scheme="scoop_reporter_id", value=str(reporter.id))
    )
    claim = EvidenceClaim(
        id=f"claim_{reporter.id}",
        subject_entity_id=person.id,
        predicate="authored_by",
        object_entity_id=person.id,  # object doesn't matter for this test
        qualifiers={},
        asserted_by="test/v1",
        evidence_class="article_byline",
        status="candidate",
        method_version="test/1.0",
        claim_hash=f"hash_{reporter.id}",
    )
    db_session.add(claim)
    await db_session.commit()

    report = await flag_agency_reporters(db_session)
    await db_session.commit()

    assert report.reporters_flagged == 1
    assert report.claims_retracted == 1

    await db_session.refresh(reporter)
    assert reporter.is_collective is True
    await db_session.refresh(real_reporter)
    assert real_reporter.is_collective is False

    retracted = await db_session.get(EvidenceClaim, claim.id)
    assert retracted.retracted_at is not None


@pytest.mark.asyncio
async def test_flag_agency_reporters_is_idempotent(db_session) -> None:
    reporter = Reporter(name="AP", normalized_name="ap", article_count=1)
    db_session.add(reporter)
    await db_session.commit()

    first = await flag_agency_reporters(db_session)
    await db_session.commit()
    assert first.reporters_flagged == 1

    second = await flag_agency_reporters(db_session)
    await db_session.commit()
    assert second.reporters_flagged == 0
    assert second.claims_retracted == 0


def _make_person(entity_id: str, reporter_id: int):
    from app.models.evidence import EvidenceEntity

    return EvidenceEntity(
        id=entity_id,
        record_kind="person",
        canonical_name=f"reporter-{reporter_id}",
        entity_kind="person",
        status="accepted",
    )
