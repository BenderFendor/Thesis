## Task

Fix latest reporter verification review findings.

## Changes

- Tightened `verified` so only official or archived person-level author/profile citations qualify.
- Kept RSS, repeated byline, and Wikidata employer matches as supporting evidence for `strong`, not `verified`.
- Preserved Rust parser `author_urls` through Python article models, persistence, API output, and ArticleAuthor backfill.
- Blocked dirty local-byline rows from high-confidence scoring when names contain source labels, combined bylines, or role/location/email residue.
- Updated profile, alias, coverage, and source-enrichment audits so identity keys use real author/profile URLs.
- Updated docs and tests for the corrected evidence model.

## Verification

- `uvx ruff check ...`: passed for touched Python files.
- Focused pytest for reporter confidence, intelligence, coverage, planner, and byline tests: 63 passed.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-quality`: passed, `quality_failures=0`.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-profiles`: passed, `profile_quality_failures=0`.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-aliases`: passed, `identity_quality_failures=0`.
- `PYTHONPATH=backend uv run python backend/scripts/verify_reporter_intelligence.py --audit-eligible-cohort`: still fails the broader coverage target honestly, with 3,561 of 8,901 eligible reporters verified and 4,785 likely reporters remaining.
- `scripts/self-test`: passed via `./verify.sh`, including Next build/lint, mypy, ruff, Rust checks/build, and 407 backend tests.
