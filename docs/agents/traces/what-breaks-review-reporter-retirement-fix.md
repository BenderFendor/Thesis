# What-Breaks Review + Fixes — 2026-08-27

## Goal
Review the full uncommitted bundle (complexity refactor + reporter data
quality + atlas worker replacement + evidence policy additions) for
failure-mode risks, then fix every finding and commit.

## Status
Complete. Four findings fixed, all gates green, one commit created.

## Findings and fixes
1. P1: Soft-retired reporters leaked through wiki directory, dossier,
   articles, and entity-research list endpoints. Fixed by filtering
   `retirement_reason IS NULL` in `list_wiki_reporters`, `get_source_reporters`,
   `_load_wiki_reporters` (wiki.py) and `list_reporters`
   (entity_research.py), and following the `merged_into` chain in
   `get_reporter_dossier` + `get_reporter_articles`.
2. P2: `_wikidata_document_id` format change (readable -> stable hash)
   would orphan existing documents on re-ingest. Fixed with
   `_get_or_create_wikidata_document` probing the legacy id first.
3. P3: Atlas force layout lost the worker's `onerror` fallback when moved to
   the main thread. Fixed: rAF loop catches and falls back to the ring layout.
4. P4: `.chroma.corrupt-*/` (537 MB dump) and `.omp/` were not gitignored.
   Added both to `.gitignore`; dump left on disk.

## Files changed (this task)
- backend/app/api/routes/wiki.py
- backend/app/api/routes/entity_research.py
- backend/app/services/evidence_ingest.py
- frontend/features/intelligence-atlas/hooks/use-atlas-layout.ts
- .gitignore
- docs/Log.md
- backend/tests/test_reporter_retirement.py (new, 6 tests)

## Verification
- New `backend/tests/test_reporter_retirement.py`: 6 passed.
- Scoped pytest (11 passed), frontend jest 33 + 5 atlas suites (147 tests),
  strict mypy 180 files clean, tsc clean, ruff pinned check + format clean.

## Assumptions / risks
- Split composite rows still answer direct dossiers (they keep their article
  links); only listings hide them. Chosen over redirecting 1->N splits, which
  has no single canonical target.
- The corrupt Chroma dump was gitignored but not deleted (waiting on owner).

## Rollback
- `git revert HEAD` or soft-reset; all fixes are additive filters/redirects.
