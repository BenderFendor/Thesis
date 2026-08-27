# Reporter/person node unification

## Goal and done criteria
User ontology decision: all reporters are people, not all people are
reporters — one Atlas node per human. Remove the duplicate `person`
evidence-entity nodes created per reporter by the byline ingest
(see reporter-byline-coverage.md) without regressing reporter coverage.

## Status
Done, 2026-07-22. Projection-level unification; evidence spine untouched
(append-only preserved).

Measured before/after (`/api/wiki/atlas/stats`, live `newsdb`):

| Metric | Before | After |
|---|---|---|
| by_entity_type.person | 11,506 | 31 |
| by_entity_type.reporter | 11,395 | 11,395 |
| research_coverage | 23,087 / 23,187 | 11,612 / 11,712 |
| coverage.reporter | 11,392 / 11,395 | 11,392 / 11,395 (unchanged) |
| coverage.person | (doubled split) | 31 / 31 |

## Files changed
- `backend/app/services/atlas_evidence_projection.py` — `_reporter_entity_map()`
  (single `EntityExternalId` query on `scoop_reporter_id`), person-node
  suppression for mapped entities, `_endpoint_id_map` remaps suppressed
  entity ids to `reporter:<id>` for edge endpoints (covers any future
  predicate); accepted/candidate edge builders skip `authored_by`/
  `employed_by` for reporter-mapped subjects since
  `_reporter_byline_edge_index` in atlas_graph_projection.py already emits
  that exact fact — avoids double-counting evidence on the unified node.
- `backend/app/services/entity_resolver.py` — `resolve_or_create` gained
  `entity_kind`; auto-links a person entity to an existing `Reporter` via
  `Reporter.normalized_name` when the match is unambiguous (561
  duplicate-name groups exist; ambiguous matches deliberately left
  unlinked). Byline ingest supplies the id directly, so no cost there.
- `frontend/features/intelligence-atlas/atlas-entity-list.tsx` — TYPE_TABS
  map to entity-type lists: People tab = ["person","reporter"], Reporters =
  ["reporter"]. No backend route change needed; kind facet surfaces both.
- `backend/tests/test_reporter_person_unification.py` (new, 8 tests):
  node dedup, edge remap on a non-byline predicate, no-double-count on an
  evidence-backed authored_by claim, plain person still projects, plus
  resolve_or_create match/ambiguous/no-match/pre-supplied-id cases.

## Commands and results
- `cd backend && uv run pytest tests/ -q` — 643 passed, 3 skipped
  (baseline 635/3 + 8 new, 0 regressions).
- `npx tsc --noEmit` clean; `npx jest features/intelligence-atlas/tests/`
  — 5 suites / 23 tests passed.

## Risks / remaining
- Cold `/stats` ~3.7s (pre-existing: `_load_graph_projection` building
  ~11.6k reporter nodes dominates; unification adds only ~23ms). The 300s
  stats cache keeps UI polling at ~12ms. Separate profiling pass warranted.
- `scoop_reporter_id` pointing at a deleted Reporter degrades gracefully
  (edge dropped by node-membership filter).
- Byline edge matching in atlas_graph_projection.py stayed name-based —
  unchanged scope.
