"""Replay the frozen evidence corpus through the real SCOOP evidence stack."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any, cast

from app.proof_suite.cases import CASE_BY_ID

DEFAULT_CORPUS = Path(__file__).resolve().parents[2] / "tests" / "evidence_corpus"
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class CorpusReplayError(RuntimeError):
    """Raised when a corpus cannot safely enter or complete replay."""


def _load_manifest(corpus: Path) -> dict[str, Any]:
    manifest_path = corpus / "manifest.json"
    if not manifest_path.is_file():
        raise CorpusReplayError(f"missing corpus manifest: {manifest_path}")
    return cast(dict[str, Any], json.loads(manifest_path.read_text(encoding="utf-8")))


def _normalized_name(value: str | None) -> str:
    text = " ".join((value or "").casefold().replace("&", "and").split())
    return text.removeprefix("the ").rstrip(".,")


def _names_match(actual: str | None, expected: str) -> bool:
    actual_name = _normalized_name(actual)
    expected_name = _normalized_name(expected)
    return bool(
        actual_name
        and expected_name
        and (
            actual_name == expected_name
            or actual_name in expected_name
            or expected_name in actual_name
        )
    )


def _validate_capture(
    corpus: Path, case_id: str, capture: dict[str, Any], failures: list[str]
) -> None:
    relative_path = Path(str(capture.get("path", "")))
    path = (corpus / relative_path).resolve()
    if corpus.resolve() not in path.parents or not path.is_file():
        failures.append(f"{case_id}: missing capture {relative_path}")
        return
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != capture.get("sha256"):
        failures.append(f"{case_id}: hash mismatch {relative_path}")
    if not capture.get("source_url") or not capture.get("retrieved_at"):
        failures.append(f"{case_id}: capture request metadata incomplete")
    if int(capture.get("http_status", 0)) != 200:
        failures.append(f"{case_id}: capture HTTP status was not 200")


def _validate_case(corpus: Path, case: dict[str, Any], failures: list[str]) -> None:
    case_id = str(case["case_id"])
    captures = case.get("captures") or []
    if not captures:
        failures.append(f"{case_id}: no immutable captures")
    for capture in captures:
        _validate_capture(corpus, case_id, capture, failures)
    review = case.get("review") or {}
    if review.get("status") != "approved" or not review.get("reviewer"):
        failures.append(f"{case_id}: independent reviewer signoff missing")
    if not case.get("expectations"):
        failures.append(f"{case_id}: reviewed expectations missing")
    if not case.get("adapter") or not isinstance(case.get("records"), list):
        failures.append(f"{case_id}: replay adapter or records missing")


def validate_corpus(corpus: Path) -> dict[str, Any]:
    """Validate coverage, source metadata, hashes, expectations, and review gates."""
    manifest = _load_manifest(corpus)
    if manifest.get("network_access") is not False:
        raise CorpusReplayError("manifest must explicitly disable network access")
    cases = manifest.get("cases")
    if not isinstance(cases, list):
        raise CorpusReplayError("manifest cases must be a list")
    ids = {
        str(case["case_id"])
        for case in cases
        if isinstance(case, dict) and isinstance(case.get("case_id"), str)
    }
    expected = set(CASE_BY_ID)
    if ids != expected:
        raise CorpusReplayError(
            f"corpus case mismatch: missing={sorted(expected - ids)} extra={sorted(ids - expected)}"
        )
    failures: list[str] = []
    for case in cases:
        if isinstance(case, dict):
            _validate_case(corpus, case, failures)
    if failures:
        raise CorpusReplayError("corpus release gates failed:\n- " + "\n- ".join(failures))
    return manifest


def _start_cluster(root: Path) -> tuple[Path, Path, dict[str, str]]:
    data = root / "postgres"
    log = root / "postgres.log"
    socket_dir = root / "socket"
    socket_dir.mkdir()
    subprocess.run(
        ["initdb", "-D", str(data), "--auth=trust", "--username=scoop_replay", "--no-locale"],
        check=True,
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [
            "pg_ctl",
            "-D",
            str(data),
            "-l",
            str(log),
            "-o",
            f"-F -h '' -k {socket_dir}",
            "-w",
            "start",
        ],
        check=True,
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )
    command_env = dict(os.environ)
    command_env.update(
        {
            "PGHOST": str(socket_dir),
            "PGUSER": "scoop_replay",
            "PGDATABASE": "postgres",
        }
    )
    return data, socket_dir, command_env


def _stop_cluster(data: Path) -> None:
    subprocess.run(
        ["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"],
        check=True,
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )


def _create_database(database_name: str, command_env: dict[str, str]) -> None:
    subprocess.run(
        ["createdb", "--maintenance-db", command_env["PGDATABASE"], database_name],
        env=command_env,
        check=True,
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
    )


def _run_migrations(sync_url: str) -> None:
    migration_env = dict(os.environ)
    migration_env["DATABASE_URL"] = sync_url
    try:
        subprocess.run(
            [str(BACKEND_ROOT / ".venv" / "bin" / "alembic"), "upgrade", "head"],
            env=migration_env,
            check=True,
            cwd=BACKEND_ROOT,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise CorpusReplayError(f"migration failed: {exc.stderr.strip()}") from exc


async def _run_adapter(db: Any, case: dict[str, Any], corpus: Path) -> Any:
    from datetime import datetime

    from app.services.evidence_ingest import IngestReport
    from app.services.primary_source_adapters import (
        CapturedPayload,
        ingest_article_records,
        ingest_companies_house_records,
        ingest_corporate_records,
        ingest_fcc_records,
        ingest_gleif_records,
        ingest_irs_990_records,
        ingest_sellers_json_records,
        ingest_sponsorship_records,
        ingest_usaspending_records,
    )

    adapters = {
        "gleif": ingest_gleif_records,
        "companies_house": ingest_companies_house_records,
        "corporate_records": ingest_corporate_records,
        "irs_990": ingest_irs_990_records,
        "usaspending": ingest_usaspending_records,
        "fcc": ingest_fcc_records,
        "article_records": ingest_article_records,
        "sellers_json": ingest_sellers_json_records,
        "sponsorship": ingest_sponsorship_records,
    }
    adapter_name = str(case["adapter"])
    adapter = adapters.get(adapter_name)
    if adapter is None:
        raise CorpusReplayError(f"{case['case_id']}: unknown adapter {adapter_name}")
    combined = IngestReport(source=adapter_name)
    captures = cast(list[dict[str, Any]], case["captures"])
    records = cast(list[dict[str, Any]], case["records"])
    for record in records:
        capture_index = int(record.get("capture_index", 0))
        if capture_index < 0 or capture_index >= len(captures):
            raise CorpusReplayError(
                f"{case['case_id']}: record references missing capture {capture_index}"
            )
        capture = captures[capture_index]
        payload = CapturedPayload(
            source_url=str(capture["source_url"]),
            body=(corpus / str(capture["path"])).read_bytes(),
            retrieved_at=datetime.fromisoformat(
                str(capture["retrieved_at"]).replace("Z", "+00:00")
            ).replace(tzinfo=None),
            http_status=int(capture.get("http_status", 200)),
            content_type=str(capture.get("content_type", "application/json")),
        )
        report = await adapter(db, payload=payload, records=[record])
        for field in (
            "documents_created",
            "snapshots_created",
            "observations_created",
            "claims_created",
            "claims_deduped",
            "accepted",
            "candidates",
        ):
            setattr(combined, field, getattr(combined, field) + getattr(report, field))
        combined.acceptance_failures.extend(report.acceptance_failures)
    return combined


async def _claim_ids_matching(db: Any, asserted_by: str) -> set[str]:
    from sqlalchemy import select

    from app.models.evidence import EvidenceClaim

    return {
        cast(str, claim_id)
        for claim_id in (
            await db.execute(
                select(EvidenceClaim.id).where(EvidenceClaim.asserted_by == asserted_by)
            )
        ).scalars()
    }


async def _new_claims(db: Any, asserted_by: str, prior_claim_ids: set[str]) -> list[Any]:
    from sqlalchemy import select

    from app.models.evidence import EvidenceClaim

    return list(
        (
            await db.execute(
                select(EvidenceClaim).where(
                    EvidenceClaim.asserted_by == asserted_by,
                    EvidenceClaim.id.not_in(prior_claim_ids),
                )
            )
        )
        .scalars()
        .all()
    )


async def _review_claims(
    db: Any, claim_rows: list[Any], reviewer: str
) -> tuple[int, list[dict[str, str]]]:
    from sqlalchemy import select

    from app.models.evidence import ClaimEvidence, EvidenceObservation
    from app.services.evidence_ingest import _mark_observation_reviewed
    from app.services.evidence_spine import (
        EvidenceSpineError,
        evaluate_claim_by_id,
        materialize_claim,
    )

    accepted_count = 0
    rejection_reasons: list[dict[str, str]] = []
    for claim in claim_rows:
        observation_ids = list(
            (
                await db.execute(
                    select(ClaimEvidence.observation_id).where(ClaimEvidence.claim_id == claim.id)
                )
            )
            .scalars()
            .all()
        )
        for observation_id in observation_ids:
            observation = await db.get(EvidenceObservation, observation_id)
            if observation is not None:
                await _mark_observation_reviewed(db, observation, reviewer=reviewer)
        try:
            if claim.object_entity_id:
                await materialize_claim(
                    db,
                    cast(str, claim.id),
                    reviewer=reviewer,
                )
            else:
                evaluation = await evaluate_claim_by_id(db, cast(str, claim.id))
                if not evaluation.accepted:
                    continue
                claim.status = "accepted"
            accepted_count += 1
        except EvidenceSpineError as exc:
            rejection_reasons.append({"claim_id": cast(str, claim.id), "reason": str(exc)})
    return accepted_count, rejection_reasons


def _assert_predicates_match(
    case_id: str, predicates: set[str], expectations: list[dict[str, Any]]
) -> None:
    expected_predicates = {
        str(expectation["predicate"])
        for expectation in expectations
        if expectation.get("predicate")
    }
    if predicates != expected_predicates:
        raise CorpusReplayError(
            f"{case_id}: predicate mismatch "
            f"missing={sorted(expected_predicates - predicates)} "
            f"extra={sorted(predicates - expected_predicates)}"
        )


async def _claim_entity_names(db: Any, claim_rows: list[Any]) -> dict[str, str]:
    from sqlalchemy import select

    from app.models.evidence import EvidenceEntity

    entity_ids = {
        entity_id
        for claim in claim_rows
        for entity_id in (claim.subject_entity_id, claim.object_entity_id)
        if entity_id
    }
    entities = (
        list(
            (await db.execute(select(EvidenceEntity).where(EvidenceEntity.id.in_(entity_ids))))
            .scalars()
            .all()
        )
        if entity_ids
        else []
    )
    return {cast(str, entity.id): cast(str, entity.canonical_name) for entity in entities}


def _expectation_matches(
    claim: Any,
    expectation: dict[str, Any],
    predicates: set[str],
    entity_names: dict[str, str],
) -> bool:
    predicate = expectation.get("predicate")
    if predicate and claim.predicate != predicate:
        return False
    if predicate and claim.status != str(expectation.get("acceptance_status") or "accepted"):
        return False
    if expectation.get("subject") and not _names_match(
        entity_names.get(cast(str, claim.subject_entity_id)), str(expectation["subject"])
    ):
        return False
    if expectation.get("object") and not _names_match(
        entity_names.get(cast(str, claim.object_entity_id)), str(expectation["object"])
    ):
        return False
    return not (
        expectation.get("lifecycle_state")
        and (claim.qualifiers or {}).get("lifecycle_state") != expectation["lifecycle_state"]
    )


def _assert_expectations(
    case_id: str,
    expectations: list[dict[str, Any]],
    claim_rows: list[Any],
    predicates: set[str],
    entity_names: dict[str, str],
) -> None:
    for expectation in expectations:
        predicate = expectation.get("predicate")
        if predicate and predicate not in predicates:
            raise CorpusReplayError(f"{case_id}: missing expected predicate {predicate}")
        forbidden = expectation.get("forbidden_predicate")
        if forbidden and forbidden in predicates:
            raise CorpusReplayError(f"{case_id}: unsupported predicate present {forbidden}")
        matching = [
            claim
            for claim in claim_rows
            if _expectation_matches(claim, expectation, predicates, entity_names)
        ]
        if predicate and not matching:
            actual = [
                (
                    claim.predicate,
                    entity_names.get(cast(str, claim.subject_entity_id)),
                    entity_names.get(cast(str, claim.object_entity_id)),
                    claim.qualifiers,
                )
                for claim in claim_rows
            ]
            raise CorpusReplayError(
                f"{case_id}: expected relationship classification not found; "
                f"expected={expectation!r}; actual={actual!r}"
            )
        forbidden_subject = expectation.get("forbidden_subject")
        forbidden_object = expectation.get("forbidden_object")
        if (
            forbidden_subject
            and forbidden_object
            and any(
                _names_match(
                    entity_names.get(cast(str, claim.subject_entity_id)),
                    str(forbidden_subject),
                )
                and _names_match(
                    entity_names.get(cast(str, claim.object_entity_id)),
                    str(forbidden_object),
                )
                for claim in claim_rows
            )
        ):
            raise CorpusReplayError(f"{case_id}: forbidden entity shortcut present")


async def _replay_case(db: Any, corpus: Path, case: dict[str, Any]) -> dict[str, Any]:
    case_id = str(case["case_id"])
    reviewer = str((case.get("review") or {}).get("reviewer") or "").strip()
    if not reviewer:
        raise CorpusReplayError(f"{case_id}: replay requires a reviewer identity")
    adapter_asserted_by = f"evidence_adapter:{case['adapter']}"
    prior_claim_ids = await _claim_ids_matching(db, adapter_asserted_by)
    report = await _run_adapter(db, case, corpus)
    claim_rows = await _new_claims(db, adapter_asserted_by, prior_claim_ids)
    accepted_count, rejection_reasons = await _review_claims(db, claim_rows, reviewer)
    expectations = cast(list[dict[str, Any]], case["expectations"])
    predicates = {cast(str, claim.predicate) for claim in claim_rows}
    _assert_predicates_match(case_id, predicates, expectations)
    entity_names = await _claim_entity_names(db, claim_rows)
    _assert_expectations(case_id, expectations, claim_rows, predicates, entity_names)
    return {
        "case_id": case_id,
        "adapter": case["adapter"],
        "claims_created": report.claims_created,
        "candidates": report.candidates,
        "accepted_after_policy": accepted_count,
        "rejection_reasons": rejection_reasons,
        "claim_bundle": [
            {
                "claim_id": claim.id,
                "subject_entity_id": claim.subject_entity_id,
                "predicate": claim.predicate,
                "object_entity_id": claim.object_entity_id,
                "object_value": claim.object_value,
                "qualifiers": claim.qualifiers,
                "evidence_class": claim.evidence_class,
                "status": claim.status,
            }
            for claim in claim_rows
        ],
    }


async def _assert_dossier_projection(db: Any) -> bool:
    from sqlalchemy import select

    from app.models.evidence import EvidenceEntity
    from app.services.atlas_entity import get_atlas_entity
    from app.services.atlas_entity_resolution import outlet_node_ids

    first_entity = (
        await db.execute(select(EvidenceEntity).where(EvidenceEntity.canonical_name == "CNN"))
    ).scalar_one_or_none()
    dossier_entity_id: str | None = None
    if first_entity is not None:
        if first_entity.entity_kind in {
            "publication",
            "publication_brand",
            "digital_property",
            "feed",
            "broadcast_station",
        }:
            dossier_entity_id = (await outlet_node_ids(db, [first_entity])).get(
                cast(str, first_entity.id)
            )
        else:
            dossier_entity_id = f"organization:{first_entity.id}"
    dossier = await get_atlas_entity(db, dossier_entity_id) if dossier_entity_id else None
    if dossier is None:
        raise CorpusReplayError("CNN dossier projection was not available")
    summary = next(section for section in dossier.dossier_sections if section.key == "summary")
    ownership = next(
        section for section in dossier.dossier_sections if section.key == "ownership_control"
    )
    if not summary.statements or not _names_match(
        summary.statements[0].answer, "Warner Bros. Discovery"
    ):
        raise CorpusReplayError(
            "CNN dossier did not answer current WBD ownership; "
            f"summary={summary.model_dump(mode='json')!r}; "
            f"connections={[item.model_dump(mode='json') for item in dossier.connections]!r}"
        )
    if not any(
        statement.lifecycle_state == "proposed"
        and _names_match(statement.answer, "Paramount Skydance")
        for statement in ownership.statements
    ):
        raise CorpusReplayError(
            "CNN dossier did not separate the Paramount proposal; "
            f"ownership={ownership.model_dump(mode='json')!r}; "
            f"connections={[item.model_dump(mode='json') for item in dossier.connections]!r}"
        )
    if any(
        _names_match(statement.answer, "Ellison-controlled entities")
        for statement in summary.statements
    ):
        raise CorpusReplayError("CNN dossier promoted an unsupported Ellison shortcut")
    return True


async def _evidence_counts(db: Any) -> dict[str, int]:
    from sqlalchemy import func, select

    from app.models.evidence import (
        EvidenceClaim,
        EvidenceDocument,
        EvidenceObservation,
    )

    return {
        "documents": int((await db.scalar(select(func.count(EvidenceDocument.id)))) or 0),
        "observations": int((await db.scalar(select(func.count(EvidenceObservation.id)))) or 0),
        "claims": int((await db.scalar(select(func.count(EvidenceClaim.id)))) or 0),
    }


async def _replay_async(manifest: dict[str, Any], corpus: Path, async_url: str) -> dict[str, Any]:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.database import Base
    from app.models.evidence import EVIDENCE_SPINE_TABLES
    from app.services.entity_backfill import run_backfill
    from app.services.media_measurements import calculate_media_measurements

    engine = create_async_engine(async_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    case_results: list[dict[str, Any]] = []
    try:
        async with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                if table.name not in EVIDENCE_SPINE_TABLES:
                    await connection.run_sync(table.create, checkfirst=True)
        async with factory() as db:
            await run_backfill(db)
            for case in manifest["cases"]:
                case_results.append(await _replay_case(db, corpus, cast(dict[str, Any], case)))
            measurements = await calculate_media_measurements(db)
            dossier_exercised = await _assert_dossier_projection(db)
            counts = await _evidence_counts(db)
            expected_counts = cast(dict[str, int], manifest.get("expected_counts") or {})
            if expected_counts and counts != expected_counts:
                raise CorpusReplayError(
                    f"corpus count mismatch: expected={expected_counts!r} actual={counts!r}"
                )
            await db.commit()
    finally:
        await engine.dispose()
    return {
        "status": "passed",
        "corpus_version": manifest.get("version"),
        "case_count": len(manifest["cases"]),
        "network_access": False,
        "database": "disposable_postgresql",
        "migrations": "head",
        "counts": counts,
        "measurements": [trace.measurement_name for trace in measurements],
        "dossier_api_exercised": dossier_exercised,
        "cases": case_results,
    }


def replay_corpus(manifest: dict[str, Any], corpus: Path) -> dict[str, Any]:
    """Run migrations, adapters, measurements, dossier projection, and assertions."""
    database_name = "scoop_replay"
    with tempfile.TemporaryDirectory(prefix="scoop-evidence-replay-") as temp_dir:
        data, socket_dir, command_env = _start_cluster(Path(temp_dir))
        try:
            _create_database(database_name, command_env)
            async_url = f"postgresql+asyncpg://scoop_replay@/{database_name}?host={socket_dir}"
            sync_url = f"postgresql+psycopg2://scoop_replay@/{database_name}?host={socket_dir}"
            _run_migrations(sync_url)
            return asyncio.run(_replay_async(manifest, corpus, async_url))
        finally:
            _stop_cluster(data)


def main(argv: Iterable[str] | None = None) -> int:
    """Validate and run a fully offline replay in a disposable database."""
    parser = argparse.ArgumentParser(description="Replay the frozen SCOOP evidence corpus")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        manifest = validate_corpus(args.corpus)
        report = replay_corpus(manifest, args.corpus)
    except (CorpusReplayError, subprocess.CalledProcessError) as exc:
        parser.exit(2, f"evidence replay blocked: {exc}\n")

    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
