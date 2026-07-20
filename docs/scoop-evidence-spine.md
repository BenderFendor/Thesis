# Scoop evidence spine

This implementation turns the existing Intelligence Atlas from a graph of mixed catalog metadata into a two-layer system:

1. **Candidate layer:** legacy `Organization`, `SourceMetadata`, RSS, Wikidata, and old `SourceClaim` rows remain visible as unresolved or candidate information.
2. **Accepted-fact layer:** only relationships that trace through an immutable snapshot, locator-backed observation, claim, predicate-specific evidence gate, and relationship materialization are marked accepted.

The governing chain is:

```text
raw artifact -> snapshot -> observation -> claim -> accepted relationship -> measurement
```

## What is implemented

- Minimal base record kinds and dated roles/classifications through claims.
- Graded external identifiers and reviewable entity-resolution decisions.
- Raw snapshot storage metadata, canonical-text hashes, extraction versions, OCR confidence, and non-blocking archive requests.
- Bitemporal claims and relationships with separate world-valid and Scoop-knowledge time.
- Locator-backed observations with a separate entailment state.
- Predicate-specific acceptance gates and evidence-root deduplication through document lineage.
- Normalized contradiction comparison before opening an adjudication item.
- Safe economic/voting-interest mathematics with ranges, share classes, cycle detection, and calculation traces.
- External material-event registry, external preregistration records, validation cards, and corpus-coverage windows.
- BODS-shaped JSON, PROV JSON-LD, RO-Crate metadata, deterministic ZIP packaging, and human-readable proof reports.
- A 20-case public benchmark registry, 15 canonical assertions, six mutation classes, hidden-case manifest support, and a static clean-room scanner.
- Atlas `as_of`, `known_at`, and `accepted_only` query controls. Accepted evidence edges preserve exact predicates, claim IDs, qualifiers, snapshot hashes, locators, and policy versions.
- A dry-run-first legacy migration that produces candidate claims and a contradiction report; it never upgrades catalog metadata into accepted ownership.

## Database migration

From `backend/`:

```bash
alembic upgrade head
```

The evidence-spine tables are migration-managed. Existing table initialization remains in place for legacy tables during the transition; new schema changes should be added as Alembic revisions rather than `ADD COLUMN IF NOT EXISTS` startup patches.

## Legacy migration

Dry run:

```bash
PYTHONPATH=. python scripts/migrate_legacy_ownership_to_evidence.py
```

Apply candidate rows after reviewing the JSON report:

```bash
PYTHONPATH=. python scripts/migrate_legacy_ownership_to_evidence.py --apply
```

No relationship produced by this script is accepted. Acceptance requires captured source evidence and the relevant predicate gate.

## API

- `GET /api/wiki/evidence/policies`
- `GET /api/wiki/evidence/claims/{claim_id}`
- `POST /api/wiki/evidence/claims/evaluate`
- `POST /api/wiki/evidence/claims/{claim_id}/materialize`
- `GET /api/wiki/evidence/relationships?as_of=...&known_at=...`
- `GET /api/wiki/evidence/relationships/{id}/proof`
- `GET /api/wiki/atlas/graph?accepted_only=true&as_of=...&known_at=...`

## Proof-suite workflow

Truth files are not stored in parser code and do not contain answers written from memory. A case answer key must be generated from retrieved snapshots, include a SHA-256 and locator for every expected edge, and be signed off by a reviewer. Before a run, derived observations, claims, relationships, resolutions, and measurements are cleared while raw snapshots remain.

Run the focused checks:

```bash
PYTHONPATH=. pytest -q \
  tests/test_evidence_policy.py \
  tests/test_evidence_export.py \
  tests/test_ownership_math.py \
  tests/test_claim_comparison.py \
  tests/test_proof_suite_registry.py \
  tests/test_clean_room_scanner.py
PYTHONPATH=. python scripts/check_proof_suite_clean_room.py app
```

The public registry deliberately names benchmark cases and their failure modes but contains no expected ownership path. Fifteen cases can be used during development; five remain hidden for final evaluation.

## Deliberate non-claims

This PR creates the general evidence and evaluation machinery. It does **not** claim that all 20 benchmark truth bundles, five hidden cases, or the random 250-relationship gold set have already been captured and human-reviewed. Those require actual filing snapshots and reviewer signatures; the code now enforces the format and clean-room rules they must satisfy.

`app.proof_suite.runner.evaluate_case_against_database` can now run a case's 15 assertions against what the pipeline actually materialized for a given truth bundle (not just check the truth bundle's own shape, which is all `assert_snapshot_pinned_truth` does) -- but running it for real still needs the same missing pieces: retrieved snapshots for the 20 public cases, a human-reviewed truth bundle pinned from them, and the 5 hidden cases commissioned from a reviewer who didn't write the adapters. See docs/agents/traces/fix-evidence-spine-issues-10-11-12-13.md for what changed and what remains blocked on that human step.
