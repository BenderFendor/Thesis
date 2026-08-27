# Reporter byline coverage (Workstream 1 of coverage-to-8000-plan)

## Goal and done criteria
Raise Atlas `research_coverage` from 76/11,709 toward 8,000 by creating
evidence-backed `authored_by` claims from the local article corpus and
bridging them to Reporter nodes. Success metric:
`research_coverage_by_entity_type["reporter"]`.

## Status
Done. Ran against live `newsdb` on 2026-07-22.

- `research_coverage`: 76/11,709 -> 23,087/23,187
- `research_coverage_by_entity_type["reporter"]`: 0/11,395 -> 11,392/11,395
- Cold `/api/wiki/atlas/stats`: 97.5ms
- Backend tests: 635 passed, 3 skipped (baseline 631/3; +4 new, 0 regressions)

## Files changed
- `backend/app/services/primary_source_adapters.py` - new `reporter_byline`
  record type in `ingest_article_records` (person -authored_by-> outlet,
  author entity keyed by stable `scoop_reporter_id` external id).
- `backend/app/scripts/ingest_reporter_bylines.py` (new) - DB-backed
  ingestion; one claim per reporter (most-recent byline), idempotent via
  `Reporter.research_sources` skip-marker and reproducible claim hashes
  (`retrieved_at` = article `published_at`).
- `backend/app/services/atlas_graph_projection.py` - `_reporter_byline_edge_index`
  (single grouped SQL query) wired into the reporter edge-builder.
- `backend/app/services/atlas_evidence_projection.py` - `authored_by` added to
  `_OWNERSHIP_PREDICATES`.
- `backend/app/services/auto_ingest.py` - `Stage("reporter_byline_ingest",
  network_bound=False)`; runs on every restart, no-ops when already ingested.
- `backend/tests/test_reporter_byline_bridge.py` (new, 4 tests);
  `backend/tests/test_auto_ingest.py` stage count 3 -> 4.

## Design decisions
- Did NOT reuse the existing `byline` record type: it mints a fresh
  `publication_brand` entity per article, which would have flooded the Atlas
  with ~11.5k junk organization nodes. New `reporter_byline` type resolves
  catalog outlets by domain (only 3 new non-catalog outlet entities created).
- One claim per reporter instead of per reporter-outlet pair: coverage needs
  one evidence-backed edge per node; cut writes from 55,893 to 11,475 rows.
- Disk math (hard constraint, ~2.6GB free): 1,000-reporter sample grew
  evidence tables ~2.5MB; full run grew newsdb 512MB -> 549MB in 95s.

## Known follow-ups / risks
- ~~Denominator doubled (11,709 -> 23,187)~~ -- **fixed**, see
  `docs/agents/traces/reporter-person-unification.md`: reporter and person
  evidence entities are now unified onto one Atlas node per human.
- 3 of 11,395 reporters uncovered (name/outlet resolution edge cases).
- Gunicorn workers needed SIGKILL to pick up new code; server left healthy
  with 1 worker - full `./runlocal.sh` restart restores worker parity.
- Workstreams 2-5 of the plan unstarted (unnecessary for the 8,000 target).
