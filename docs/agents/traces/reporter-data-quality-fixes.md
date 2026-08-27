# Reporter data-quality fixes

## Goal and done criteria
Implement the five recommendations of
reporter-coverage-quality-audit.md so reporter research coverage reflects
real humans with correct outlet attribution. Reversible (soft-retire /
claim retraction, evidence spine append-only), idempotent, auto-ingest
wired.

## Status
Done, 2026-07-22. Applied to live `newsdb`. Migration
`20260722_0006_reporter_data_quality` (adds merged_into / is_collective /
raw_name and related columns).

Live stats after (verified by orchestrator via /api/wiki/atlas/stats):
- research_coverage: 10,287 / 10,509 (was 11,612 / 11,712)
- reporter coverage: 10,068 / 10,190 (98.8%; was 11,392 / 11,395)
- Denominator dropped 1,205 reporters (merges + splits + agency rows) -
  the drop is the honesty gain, not a regression.

## Per-fix results
1. Feedburner site_url collision: real site_urls set for The Atlantic -
   National, The Atlantic Wire, RealClearPolitics, Breitbart,
   Ekathimerini (backend/app/data/rss_sources.json); catalog scanned, no
   other bad collisions. `reporter_outlet_repair.py` retracted the 120
   wrong claims (67 Ekathimerini + 53 Breitbart, exact audit match) and
   re-minted against correct outlet entities. Spot-checked 5.
2. Multi-author split: `reporter_name_splitter.py` (conservative;
   specimen "ALANNA DURKIN RICHER and GENE JOHNSON, Associated Press" ->
   2 people + agency context) wired into reporter_indexer for new
   bylines; `reporter_split_backfill.py` split 874 existing composite
   rows (75 new children, 1,984 reused, 247 new article links).
   Limitation: pure comma-only lists without and/& left unsplit.
3. Duplicate merge: `reporter_merge.py`, exact-normalized-name groups,
   winner = most articles/oldest/lowest id; re-points article_authors /
   reporter_claims / identity_edges; 376 groups, 402 rows soft-retired
   with merged_into. Eric Tucker / Lisa Mascaro / Joey Cappelletti each
   4 -> 1. Reporter API serves the winner for retired ids
   (`redirected_from_id`), no 404s on old links.
4. Agency flag: `reporter_agency_flag.py`, explicit list; 16 rows
   flagged is_collective (13 agencies + AP/RT/SG stubs), 16 misleading
   authored_by claims retracted; excluded from projection, denominator,
   and future byline minting.
5. Dirty names: `reporter_name_cleanup.py`; 185 names cleaned (BY /
   (earlier) prefixes, trailing emails, title runs), originals kept in
   `raw_name`. "(earlier) Lucy Campbell" -> "Lucy Campbell", then merged
   into the pre-existing row (cleanup stage ordered before merge stage).

## Files
New services: reporter_outlet_repair, reporter_name_cleanup,
reporter_agency_flag, reporter_name_splitter, reporter_split_backfill,
reporter_merge (backend/app/services/). Migration
backend/alembic/versions/20260722_0006_reporter_data_quality.py. Stages
added to auto_ingest.STAGES. 7 new test files.

## Commands and results
- `cd backend && uv run pytest tests/ -q` - 697 passed, 3 skipped
  (baseline 643/3 + 54 new, 0 regressions).
- Full 5-stage pipeline run 4x live: pass 2 real work, pass 3 two
  residual items, pass 4 complete no-op (fixed point confirmed).

## Remaining / risks
- openapi.json / generated TS not regenerated for additive
  `redirected_from_id` (non-breaking).
- Frontend not browser-exercised for this change (backend-focused).
- Comma-only multi-author lists remain unsplit (conservative by design).
