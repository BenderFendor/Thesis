# Atlas Phase 5: funding vs. bias, done honestly

## Goal and done criteria

Implement Phase 5 only (of `~/.claude/plans/okay-so-what-i-curried-journal.md`):
a per-entity Funding & Bias panel (outlet/organization) that prefers
evidence-spine claims over legacy fields, and a catalog-wide, pre-registered
funding-type vs. bias-rating correlation with a persisted `CalculationTrace`.
Built on Phases 0-4 (uncommitted in the working tree).

Done: `funding_and_bias` details block on outlet/organization entities with
claim/legacy origin tagging; frontend `FundingBiasPanel` on both detail
pages with the correlation-not-causation caption and MBFC attribution;
`funding_bias_analysis.py` preregisters the methodology before computing
Cramer's V by hand (stdlib only) and persists a `CalculationTrace`; CLI
script; `GET /api/wiki/atlas/analysis/funding-bias`; a dedicated frontend
route rendering methodology, contingency table, statistic, and limitations.

## Status: complete

## Files changed

Backend:
- `backend/app/services/atlas_entity.py` -- new `_FUNDING_BIAS_PREDICATES`,
  `_accepted_attribute_claims` (latest accepted, non-retracted attribute
  claim per predicate for a subject), `_claim_object_text` (pulls the rated
  value out of `object_value`), `_funding_and_bias_block` (builds the
  `funding_and_bias` details block: each of `funding_type`/`bias_rating`/
  `factual_reporting` independently prefers an accepted claim over the
  legacy value, tagged `origin: "claim" | "legacy" | null`, carrying
  `claim_ids`/`evidence_count`/`asserted_by`/`source`/`evidence`).
  Refactored `_outlet_name_for_id` to extract `_outlet_evidence_entity_id`
  (same query, now reusable). Wired into the outlet branch (legacy values:
  `SourceMetadata`/`rss_sources.py`) and organization branch (legacy
  values: added `media_bias_rating`/`factual_reporting` to the existing
  legacy-`Organization` enrichment block, which previously only surfaced
  `funding_type`).
- `backend/app/services/atlas_evidence_projection.py` -- renamed the
  private `_evidence_refs_for_claims` to public `evidence_refs_for_claims`
  (two internal call sites updated) so `atlas_entity.py` can resolve claim
  evidence citations without duplicating the
  claim -> observation -> snapshot -> document join.
- `backend/app/services/funding_bias_analysis.py` (new) -- population
  collection (every catalog outlet with both a known funding_type and
  bias_rating, same claim-preferred-over-legacy resolution as the panel);
  `build_contingency_table`/`cramers_v` (stdlib-only chi-square and
  Cramer's V, degenerate guards return `None` not `0.0`);
  `preregister_funding_bias_methodology` (idempotent, fixed id, locks
  population/measure/limitations/interpretation bands before computation);
  `run_funding_bias_analysis` (preregister, compute, persist a
  `CalculationTrace` keyed by a hash of the input population so identical
  data never re-writes a duplicate trace); `load_latest_funding_bias_analysis`
  / `get_funding_bias_analysis_response` (read-only, empty-state safe).
  Imports `atlas_entity.py`'s private catalog/claim helpers directly,
  matching the precedent already set by
  `app/scripts/ingest_evidence.py` importing `entity_backfill.py`'s
  private helpers.
- `backend/app/models/atlas.py` -- `FundingBiasMethodology`,
  `FundingBiasStatistic`, `FundingBiasAnalysisResponse` (`available: bool`
  empty-state, not a 404/500, before the CLI has ever run).
- `backend/app/api/routes/wiki_atlas.py` -- `GET
  /api/wiki/atlas/analysis/funding-bias`, read-only.
- `backend/app/scripts/run_funding_bias_analysis.py` (new) -- CLI, mirrors
  `ingest_evidence.py`'s structure (`init_db`, session factory, prints a
  summary report including the contingency table and the validation-card
  skip reason).
- New tests: `tests/test_atlas_phase5_funding_bias_panel.py` (4 tests --
  claim-over-legacy preference, all-fields-unset -> `origin: null`,
  organization mixed claim/legacy origins, a retracted claim losing to
  legacy) and `tests/test_funding_bias_analysis.py` (9 tests -- Cramer's V
  against a hand-computed 2x2 fixture, two degenerate cases, preregistration
  idempotency, a full run over a seeded catalog, run idempotency, population
  exclusion of incomplete outlets, and the endpoint's empty/populated
  states).

Frontend:
- `frontend/features/intelligence-atlas/lib/atlas-schema.ts` -- added
  `AtlasFundingBiasFieldSchema`/`AtlasFundingAndBiasSchema`/
  `parseFundingAndBias` (Phase 3-convention defensive parsing of the
  `details` bag) and `FundingBiasMethodologySchema`/
  `FundingBiasStatisticSchema`/`FundingBiasAnalysisResponseSchema` for the
  new analysis endpoint.
- `frontend/features/intelligence-atlas/lib/atlas-api.ts` --
  `fetchFundingBiasAnalysis`.
- `frontend/features/intelligence-atlas/funding-bias-panel.tsx` (new) --
  `FundingBiasPanel`: three fields (funding type, bias rating, factual
  reporting), each showing "MBFC"/"cited"/"uncited" provenance, an
  evidence-count link to the citing source when a claim backs it, and the
  persistent, non-dismissible "Correlation shown, not proven causation —
  values are attributed to their sources." caption (always rendered, not
  conditional on having any data).
- `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx` and
  `frontend/app/wiki/organization/[id]/organization-wiki-view.tsx` -- each
  resolve `parseFundingAndBias(details)` and render a "Funding & Bias"
  panel above the ownership chain when the block is present.
- `frontend/app/wiki/analysis/funding-bias/page.tsx` +
  `funding-bias-analysis-view.tsx` (new route) -- methodology card
  (population/measure/locked date/preregistration id), contingency table,
  statistic tiles (n, chi-square, Cramer's V, interpretation), limitations
  list, and the same correlation caption; an explicit empty state pointing
  at the CLI command when the analysis has never run.
- New tests: `frontend/features/intelligence-atlas/tests/
  funding-bias-panel.test.tsx` (3 tests) and additions to
  `frontend/features/intelligence-atlas/tests/atlas-schema.test.ts` (5
  tests: `parseFundingAndBias` null/parse/reject-malformed,
  `FundingBiasAnalysisResponseSchema` empty and populated).

## The statistic, precisely

Population: every catalog outlet with both a known `funding_type` and a
known `bias_rating` (each independently preferring an accepted
evidence-spine claim over the legacy `SourceMetadata`/`rss_sources.py`
value); outlets missing either are excluded, never imputed.

Contingency table: `funding_type` (rows) x `bias_rating` (cols), sorted
category labels, cell = count of outlets with that pair.

Chi-square: `chi2 = sum((observed[i][j] - expected[i][j])^2 /
expected[i][j])` over every cell, `expected[i][j] = row_total[i] *
col_total[j] / n`.

Cramer's V: `V = sqrt(chi2 / (n * (min(rows, cols) - 1)))`.

Degenerate guards (return `cramers_v: None`, not `0.0` -- a `0.0` would
falsely claim "measured no association" when no measurement was possible):
`n == 0` (empty population), or fewer than 2 categories on either axis
(`min(rows, cols) - 1 <= 0`, zero denominator).

Small-sample caveats documented in the preregistration's `limitations`:
chi-square/Cramer's V are unreliable when any expected cell count is below
~5; Cramer's V is a biased estimator at small n (no bias correction, e.g.
Bergsma 2013, is applied).

Validation numbers (hand-computed fixture, `test_funding_bias_analysis.py`):
8 state-funded/left, 2 state-funded/right, 2 commercial/left, 8
commercial/right (n=20). Row/col totals all 10, so `expected[i][j] = 5` for
every cell: `chi2 = (8-5)^2/5 * 4 = 7.2`, `df = 1`,
`V = sqrt(7.2 / (20 * 1)) = sqrt(0.36) = 0.6` exactly -- matches the test's
`pytest.approx(0.6)` assertion, computed independently of the
implementation by hand before writing the assertion.

## Where MeasurementValidationCard fits (it doesn't -- documented, not forced)

`MeasurementValidationCard` requires a non-nullable `gold_set_snapshot_id`
(FK to `DocumentSnapshot`) and a non-nullable `annotation_guide_uri`: it
validates an *extraction* measurement's accuracy against a hand-annotated
gold-labeled document. A catalog-wide chi-square/Cramer's V association has
no such gold-labeled document to grade against -- there is no per-example
annotation task to compare against ground truth, only a statistic computed
directly over the accepted/legacy data. Writing a row here would mean
fabricating an annotation guide and a gold snapshot that don't exist.
`funding_bias_analysis.VALIDATION_CARD_SKIP_REASON` states this; the CLI
script prints it in its report; the API response carries it in
`validation_card_skip_reason` so the frontend page and any API consumer see
the reason, not silence.

## CalculationTrace <-> Preregistration linkage

`CalculationTrace.relationship_id` is a nullable FK to
`AcceptedRelationship` only -- there is no dedicated preregistration
foreign key on the table, and this catalog-wide measurement is not an
`AcceptedRelationship`. Rather than add a migration/column to the shared
evidence-spine schema for one measurement, the preregistration id is
carried inside `CalculationTrace.subgraph["preregistration_id"]`
(`relationship_id` stays `None`), documented in a comment at the write
site. The trace remains fully traceable to the locked methodology that
preceded it; querying by `subgraph->>'preregistration_id'` (or, as the
route does, reading both rows and matching by convention) recovers the
link.

## Commands and tests run

```
cd backend
.venv/bin/ruff check app/ tests/
# All checks passed!

MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Success: no issues found in 170 source files

.venv/bin/pytest tests/test_atlas_phase5_funding_bias_panel.py tests/test_funding_bias_analysis.py -q
# 13 passed

.venv/bin/pytest tests -m "not slow" -q
# 557 passed, 3 deselected (544 pre-existing + 13 new; no regressions)

cd ../frontend
npx tsc --noEmit
# clean

npx eslint .
# 0 errors, 1 pre-existing warning (atlas-index-sheet.tsx useVirtualizer,
# unrelated, not introduced by this change)

npx jest features/intelligence-atlas
# 16 passed (4 suites; +9 new across funding-bias-panel.test.tsx and
# atlas-schema.test.ts additions)

npx jest
# 123 passed, 3 failed (blindspot-view.test.tsx x2, search-inline-edit.test.tsx x1)
# -- identical to the pre-existing failure set documented in the Phase 2/3
# traces; not touched by this change.
```

## Assumptions / deviations

- `funding_type` has no ingestor writing it as an evidence-spine claim
  today (Phase 1 only populated `directly_owns`/`owns_equity_in`/
  `founded_by`/`controls`/`bias_rating`/`factual_reporting`). The panel and
  the catalog-wide population still query for an accepted `funding_type`
  claim first, so a future ingestor's output is picked up automatically;
  in the current data every outlet's `funding_type` falls back to legacy.
  Not a gap in this task's scope -- Phase 5 was not asked to add a new
  funding-type ingestor, only to prefer accepted claims "where available."
- `Preregistration.external_service` is `NOT NULL` with no external
  service (OSF/AsPredicted/...) integrated in this project. Used
  `external_service="internal"` and `external_identifier=<the fixed
  preregistration id>` rather than fabricating an external deposit --
  states plainly that this is filed only in this project's own database.
- The analysis endpoint returns `available: false` with HTTP 200 (not 404)
  when the analysis has never run, matching the rest of the Atlas API's
  pattern of returning an empty/zeroed shape rather than an error when
  nothing has been computed/indexed yet (e.g. the graph endpoint on an
  empty catalog). The task's phrasing ("404/empty-state safe") allowed
  either; documented here as the deliberate choice.
- `run_funding_bias_analysis` is never triggered by the API route --
  only the CLI script writes. This matches the plan's "preregister then
  run" framing as an offline analysis step, not a per-request computation,
  and avoids a public endpoint able to trigger a 253-outlet, several-hundred
  query batch job.
- Frontend evidence linking: a claim-backed field links out to the first
  cited evidence item's `source_url` when one exists (MBFC claims always
  carry a `source_url` pointing at the HuggingFace dataset, not a
  per-outlet page); when no URL is available the evidence count still
  renders as plain text rather than a dead link.
- No commits made, per instructions.
