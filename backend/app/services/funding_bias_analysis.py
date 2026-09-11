"""Catalog-wide funding-type vs. bias-rating correlation, pre-registered.

Phase 5 of the Atlas rebuild plan (`~/.claude/plans/okay-so-what-i-curried-
journal.md`): a documented methodology filed *before* any computation
(`Preregistration`), then a reproducible Cramer's V association statistic
over the current catalog persisted as a `CalculationTrace`. Explicitly a
correlation measurement, not a causal claim -- see the preregistration's
`specification["limitations"]` and every UI surface's "correlation shown,
not proven causation" caption.

Population and per-outlet value resolution reuse `atlas_entity.py`'s
private helpers (`_catalog_sources`, `_outlet_evidence_entity_id`,
`_accepted_attribute_claims`, `_claim_object_text`) rather than
re-deriving "does this outlet have an accepted claim or only a legacy
value" logic a second time -- the same precedent as
`app.scripts.ingest_evidence` importing `entity_backfill`'s private catalog
helpers directly.

`MeasurementValidationCard` is intentionally never written here (see
`VALIDATION_CARD_SKIP_REASON`): that table validates an *extraction*
measurement's accuracy against a hand-annotated gold document snapshot
(`gold_set_snapshot_id` is a required, non-nullable foreign key). A
catalog-wide statistical association has no such gold-labeled document to
grade against -- forcing a row here would mean fabricating an annotation
guide and a snapshot that don't exist.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SourceMetadata
from app.models.atlas import (
    FundingBiasAnalysisResponse,
    FundingBiasMethodology,
    FundingBiasStatistic,
)
from app.models.evidence import CalculationTrace, Preregistration
from app.services.atlas_entity import (
    _accepted_attribute_claims,
    _catalog_sources,
    _claim_object_text,
    _outlet_evidence_entity_id,
)
from app.services.atlas_graph_helpers import stable_source_id
from app.services.evidence_spine import stable_hash

METHOD_VERSION = "funding_bias_analysis/1.0"
MEASUREMENT_NAME = "funding_bias_association"

# Fixed, deterministic id: there is exactly one methodology for this
# measurement at a given `METHOD_VERSION`. `preregister_funding_bias_
# methodology` is idempotent against this id -- re-running it never edits
# an already-locked specification, matching the "locked before computation"
# guarantee a preregistration is supposed to provide.
PREREGISTRATION_ID = "prereg_funding_bias_methodology_v1"

VALIDATION_CARD_SKIP_REASON = (
    "MeasurementValidationCard validates an extraction measurement's "
    "accuracy against a hand-annotated gold document snapshot "
    "(gold_set_snapshot_id is a required foreign key, annotation_guide_uri "
    "is required text). A catalog-wide chi-square/Cramer's V association "
    "statistic has no such gold-labeled document to grade against -- there "
    "is nothing to annotate and compare per-example. Writing a row here "
    "would mean fabricating an annotation guide and a gold snapshot that "
    "don't exist, so this measurement intentionally never writes one."
)

_INTERPRETATION_BANDS: tuple[tuple[float, str], ...] = (
    (0.1, "negligible association"),
    (0.2, "weak association"),
    (0.4, "moderate association"),
    (0.6, "relatively strong association"),
    (float("inf"), "strong association"),
)


def _interpret_cramers_v(value: float | None) -> str | None:
    """Map a Cramer's V magnitude to a plain-language interpretation band."""
    if value is None:
        return None
    for threshold, label in _INTERPRETATION_BANDS:
        if value < threshold:
            return label
    return _INTERPRETATION_BANDS[-1][1]


@dataclass(frozen=True, slots=True)
class OutletSample:
    """One outlet's resolved funding-type/bias-rating pair for the population."""

    name: str
    funding_type: str
    bias_rating: str
    funding_origin: str
    bias_origin: str
    claim_ids: tuple[str, ...] = field(default_factory=tuple)


def _resolve_population_attribute(
    claims: dict[str, Any],
    key: str,
    legacy_value: str | None,
    catalog_value: Any,
) -> tuple[str | None, str, str | None]:
    claim = claims.get(key)
    value = _claim_object_text(claim) if claim is not None else None
    if value is not None:
        return value.strip() or None, "claim", cast(str, claim.id)
    fallback = (legacy_value or catalog_value or "").strip() or None
    return fallback, "legacy", None


async def _collect_outlet_sample(
    db: AsyncSession, name: str, config: dict[str, Any]
) -> OutletSample | None:
    metadata = (
        await db.execute(select(SourceMetadata).where(SourceMetadata.source_name == name))
    ).scalar_one_or_none()
    evidence_entity_id = await _outlet_evidence_entity_id(db, f"outlet:{stable_source_id(name)}")
    claims = (
        await _accepted_attribute_claims(db, evidence_entity_id, ("funding_type", "bias_rating"))
        if evidence_entity_id is not None
        else {}
    )
    funding_value, funding_origin, funding_claim_id = _resolve_population_attribute(
        claims,
        "funding_type",
        metadata.funding_type if metadata else None,
        config.get("funding_type"),
    )
    bias_value, bias_origin, bias_claim_id = _resolve_population_attribute(
        claims,
        "bias_rating",
        metadata.political_bias if metadata else None,
        config.get("bias_rating"),
    )
    if funding_value is None or bias_value is None:
        return None
    claim_ids = tuple(
        claim_id for claim_id in (funding_claim_id, bias_claim_id) if claim_id is not None
    )
    return OutletSample(
        name=name,
        funding_type=funding_value,
        bias_rating=bias_value,
        funding_origin=funding_origin,
        bias_origin=bias_origin,
        claim_ids=claim_ids,
    )


async def collect_population(db: AsyncSession) -> list[OutletSample]:
    """Return catalog outlets with both funding and bias values resolved."""
    samples: list[OutletSample] = []
    for name, config in _catalog_sources().items():
        sample = await _collect_outlet_sample(db, name, config)
        if sample is not None:
            samples.append(sample)
    return samples


def build_contingency_table(
    pairs: list[tuple[str, str]],
) -> tuple[list[str], list[str], list[list[int]]]:
    """Build a sorted-category contingency table from (row, col) observations."""
    rows = sorted({row for row, _ in pairs})
    cols = sorted({col for _, col in pairs})
    row_index = {row: i for i, row in enumerate(rows)}
    col_index = {col: i for i, col in enumerate(cols)}
    table = [[0 for _ in cols] for _ in rows]
    for row, col in pairs:
        table[row_index[row]][col_index[col]] += 1
    return rows, cols, table


def _chi_square(
    table: list[list[int]],
    row_totals: list[int],
    col_totals: list[int],
    population_size: int,
) -> float:
    chi_square = 0.0
    for row_index, row in enumerate(table):
        for col_index, observed in enumerate(row):
            expected = row_totals[row_index] * col_totals[col_index] / population_size
            if expected > 0:
                chi_square += (observed - expected) ** 2 / expected
    return chi_square


def cramers_v(table: list[list[int]]) -> dict[str, Any]:
    """Chi-square and Cramer's V for a contingency table -- stdlib only.

    chi2 = sum over every cell of (observed - expected)^2 / expected, where
    expected[i][j] = row_total[i] * col_total[j] / n.
    V = sqrt(chi2 / (n * (min(rows, cols) - 1))).

    Degenerate guards return `cramers_v: None` (not `0.0` -- a `0.0` would
    falsely claim "measured no association" when no measurement was
    actually possible):
    - `n == 0`: empty population.
    - fewer than 2 categories on either axis: `min(rows, cols) - 1 <= 0`,
      the denominator would be zero.
    """
    rows, cols, n = _contingency_dimensions(table)
    if _is_degenerate_contingency(rows, cols, n):
        return _degenerate_cramers_result(n, rows, cols)
    row_totals = [sum(row) for row in table]
    col_totals = [sum(table[i][j] for i in range(rows)) for j in range(cols)]
    chi_square, degrees_of_freedom, value = _cramers_statistics(
        table,
        row_totals,
        col_totals,
        rows,
        cols,
        n,
    )
    return {
        "n": n,
        "rows": rows,
        "cols": cols,
        "chi_square": round(chi_square, 6),
        "degrees_of_freedom": degrees_of_freedom,
        "cramers_v": round(value, 6) if value is not None else None,
        "note": None,
    }


def _contingency_dimensions(table: list[list[int]]) -> tuple[int, int, int]:
    rows = len(table)
    cols = len(table[0]) if table else 0
    n = sum(sum(row) for row in table)
    return rows, cols, n


def _is_degenerate_contingency(rows: int, cols: int, population_size: int) -> bool:
    return population_size == 0 or rows < 2 or cols < 2


def _degenerate_cramers_result(
    population_size: int,
    rows: int,
    cols: int,
) -> dict[str, Any]:
    return {
        "n": population_size,
        "rows": rows,
        "cols": cols,
        "chi_square": None,
        "degrees_of_freedom": None,
        "cramers_v": None,
        "note": (
            "degenerate: empty population or fewer than two categories "
            "on one axis -- no association statistic is computable"
        ),
    }


def _cramers_statistics(
    table: list[list[int]],
    row_totals: list[int],
    col_totals: list[int],
    rows: int,
    cols: int,
    population_size: int,
) -> tuple[float, int, float | None]:
    chi_square = _chi_square(table, row_totals, col_totals, population_size)
    degrees_of_freedom = (rows - 1) * (cols - 1)
    denominator = population_size * (min(rows, cols) - 1)
    value = math.sqrt(chi_square / denominator) if denominator > 0 else None
    return chi_square, degrees_of_freedom, value


async def preregister_funding_bias_methodology(db: AsyncSession) -> Preregistration:
    """File the funding-vs-bias methodology, idempotently, before any computation.

    Returns the existing row unchanged on every call after the first --
    a preregistration that could be silently rewritten after seeing the
    data would defeat the point of pre-registering it.
    """
    existing = await db.get(Preregistration, PREREGISTRATION_ID)
    if existing is not None:
        return existing

    specification: dict[str, Any] = {
        "population": (
            "Every outlet in the local RSS catalog (app.data.rss_sources) "
            "that has both a known funding_type and a known bias_rating. "
            "Each value independently prefers an accepted evidence-spine "
            "claim (predicate funding_type / bias_rating) over the legacy "
            "SourceMetadata/rss_sources.py fallback value shown elsewhere "
            "in the Atlas. Outlets missing either value are excluded, "
            "never imputed."
        ),
        "measure": (
            "A funding_type x bias_rating contingency table over the "
            "population, plus Cramer's V computed from its Pearson "
            "chi-square statistic: V = sqrt(chi2 / (n * (min(rows, cols) "
            "- 1))); chi2 = sum((observed - expected)^2 / expected) over "
            "every cell, expected[i][j] = row_total[i] * col_total[j] / n. "
            "Implemented with the Python standard library only (math.sqrt "
            "over hand-built row/column sums) -- no scipy dependency."
        ),
        "predicates_consulted": ["funding_type", "bias_rating"],
        "algorithm_version": METHOD_VERSION,
        "limitations": [
            "MBFC bias ratings are a single rated source's own editorial "
            "judgment, not a ground-truth label for 'true' bias -- this "
            "measures agreement with MBFC's categorization, not reality.",
            "The population is this project's curated RSS catalog, not a "
            "representative or random sample of all media outlets.",
            "Funding-type categories (public/commercial/non-profit/"
            "state-funded/independent) were largely hand-classified in the "
            "legacy catalog, not sourced from one consistent registry.",
            "An association statistic, even a large Cramer's V, shows "
            "correlation, not that funding causes a given bias rating -- "
            "confounds like country, language, and outlet size are not "
            "controlled for.",
            "Chi-square and Cramer's V are unreliable when any expected "
            "cell count is below roughly 5; small categories should be "
            "read with that caveat, not merged after the fact to inflate "
            "the statistic.",
            "Cramer's V is a biased estimator at small n (it tends to "
            "overstate association); no small-sample bias correction "
            "(e.g. Bergsma 2013) is applied here.",
        ],
        "interpretation_bands": {
            "0.0-0.1": "negligible association",
            "0.1-0.2": "weak association",
            "0.2-0.4": "moderate association",
            "0.4-0.6": "relatively strong association",
            "0.6-1.0": "strong association",
        },
    }
    now = datetime.now(UTC).replace(tzinfo=None)
    preregistration = Preregistration(
        id=PREREGISTRATION_ID,
        title="Catalog funding-type vs. MBFC bias-rating association",
        canonical_hash=stable_hash(specification),
        # No external preregistration service (OSF/AsPredicted/...) is
        # integrated -- "internal" records honestly that this is filed only
        # in this project's own database, not deposited externally.
        external_service="internal",
        external_identifier=PREREGISTRATION_ID,
        doi=None,
        deposited_at=now,
        locked_at=now,
        specification=specification,
        deviations=[],
    )
    db.add(preregistration)
    await db.flush()
    return preregistration


@dataclass(frozen=True, slots=True)
class FundingBiasRun:
    """The result of running (or re-fetching) the funding-vs-bias analysis."""

    preregistration: Preregistration
    trace: CalculationTrace
    rows: list[str]
    cols: list[str]
    table: list[list[int]]
    statistic: dict[str, Any]
    population_size: int
    validation_card_skip_reason: str = VALIDATION_CARD_SKIP_REASON

    def to_response(self) -> FundingBiasAnalysisResponse:
        """Serialize into the `/api/wiki/atlas/analysis/funding-bias` response shape."""
        specification = cast(dict[str, Any], self.preregistration.specification)
        return FundingBiasAnalysisResponse(
            available=True,
            methodology=FundingBiasMethodology(
                preregistration_id=cast(str, self.preregistration.id),
                title=cast(str, self.preregistration.title),
                locked_at=cast(datetime, self.preregistration.locked_at),
                specification=specification,
                deviations=cast(list[Any], self.preregistration.deviations or []),
            ),
            statistic=FundingBiasStatistic(
                n=cast(int, self.statistic.get("n", 0)),
                rows=self.rows,
                cols=self.cols,
                table=self.table,
                chi_square=cast(float | None, self.statistic.get("chi_square")),
                degrees_of_freedom=cast(int | None, self.statistic.get("degrees_of_freedom")),
                cramers_v=cast(float | None, self.statistic.get("cramers_v")),
                interpretation=cast(str | None, self.statistic.get("interpretation")),
                note=cast(str | None, self.statistic.get("note")),
            ),
            trace_id=cast(str, self.trace.id),
            algorithm_version=cast(str, self.trace.algorithm_version),
            computed_at=cast(datetime, self.trace.created_at),
            population_size=self.population_size,
            validation_card_skip_reason=self.validation_card_skip_reason,
        )


async def run_funding_bias_analysis(db: AsyncSession) -> FundingBiasRun:
    """Preregister (idempotent), compute, and persist the funding-vs-bias trace.

    Idempotent for identical input data: the `CalculationTrace` id is a
    stable hash of the population's (name, funding_type, bias_rating)
    tuples, so re-running against unchanged data returns the existing trace
    rather than writing a duplicate; re-running after the catalog's
    accepted claims or legacy values changed produces a new trace with a
    new id, preserving the old one's history.
    """
    preregistration = await preregister_funding_bias_methodology(db)
    population = await collect_population(db)
    pairs = [(sample.funding_type, sample.bias_rating) for sample in population]
    rows, cols, table = build_contingency_table(pairs)
    statistic = cramers_v(table)
    statistic["interpretation"] = _interpret_cramers_v(statistic["cramers_v"])

    fingerprint = sorted(
        (sample.name, sample.funding_type, sample.bias_rating) for sample in population
    )
    trace_id = f"calc_{stable_hash(MEASUREMENT_NAME, preregistration.id, METHOD_VERSION, fingerprint)[:32]}"
    existing_trace = await db.get(CalculationTrace, trace_id)
    if existing_trace is None:
        input_claim_ids = sorted(
            {claim_id for sample in population for claim_id in sample.claim_ids}
        )
        trace = CalculationTrace(
            id=trace_id,
            relationship_id=None,
            measurement_name=MEASUREMENT_NAME,
            input_claim_ids=input_claim_ids,
            # `CalculationTrace` has no dedicated preregistration foreign
            # key -- it links back to an `AcceptedRelationship`, which this
            # catalog-wide measurement is not one of. The preregistration
            # id is carried inside `subgraph` instead, so the trace is
            # still traceable to the methodology that was locked before it
            # ran without altering the shared evidence-spine schema.
            subgraph={
                "preregistration_id": preregistration.id,
                "population_outlets": [sample.name for sample in population],
                "rows": rows,
                "cols": cols,
            },
            algorithm_version=METHOD_VERSION,
            result={"table": table, **statistic},
        )
        db.add(trace)
        await db.flush()
        existing_trace = trace

    return FundingBiasRun(
        preregistration=preregistration,
        trace=existing_trace,
        rows=rows,
        cols=cols,
        table=table,
        statistic=statistic,
        population_size=len(population),
    )


async def load_latest_funding_bias_analysis(db: AsyncSession) -> FundingBiasRun | None:
    """Read-only: the most recently computed trace plus its preregistration.

    Never triggers a computation -- `run_funding_bias_analysis` (via the
    CLI script `app.scripts.run_funding_bias_analysis`) is the only writer.
    Returns `None` when the analysis has never been run, which the API
    route turns into an empty-state response rather than a 404 or 500.
    """
    preregistration = await db.get(Preregistration, PREREGISTRATION_ID)
    if preregistration is None:
        return None
    trace = (
        (
            await db.execute(
                select(CalculationTrace)
                .where(CalculationTrace.measurement_name == MEASUREMENT_NAME)
                .order_by(CalculationTrace.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if trace is None:
        return None
    result = cast(dict[str, Any], trace.result)
    table = cast(list[list[int]], result.get("table", []))
    subgraph = cast(dict[str, Any], trace.subgraph)
    return FundingBiasRun(
        preregistration=preregistration,
        trace=trace,
        rows=cast(list[str], subgraph.get("rows", [])),
        cols=cast(list[str], subgraph.get("cols", [])),
        table=table,
        statistic={key: value for key, value in result.items() if key != "table"},
        population_size=len(cast(list[str], subgraph.get("population_outlets", []))),
    )


async def get_funding_bias_analysis_response(db: AsyncSession) -> FundingBiasAnalysisResponse:
    """Read-only API-shaped view for `GET /api/wiki/atlas/analysis/funding-bias`."""
    run = await load_latest_funding_bias_analysis(db)
    if run is None:
        return FundingBiasAnalysisResponse(available=False)
    return run.to_response()
