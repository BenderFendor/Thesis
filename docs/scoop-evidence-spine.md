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
- Required public `entity_kind` values remain separate from broad storage `record_kind` values.
- Accepted relationships carry a lifecycle state separate from acceptance: current, historical, proposed, pending, disputed, rejected, or superseded.
- `evidence_ingest_runs` records adapter scope, version, counts, network mode, completion state, credentials, and exact failures.
- Candidate-only adapters cover official corporate records, GLEIF, Companies House company/PSC/officer records, IRS Form 990, USAspending, FCC ownership and political files, article JSON-LD/bylines/profiles, ads.txt, sellers.json, and sponsorship disclosures. Source-native parsers normalize records before the shared spine writer runs.
- Publication cadence, corrections/retractions, byline/coauthor networks, original-versus-syndicated coverage, reporter movement, and ownership concentration persist as `CalculationTrace` rows with a corpus window, denominator, coverage, method version, inputs, and result.

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
- `GET /api/wiki/atlas/ingestion-status`
- `GET /api/wiki/atlas/analysis/media-measurements?source_name=...`

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

From the repository root, validate the checked corpus:

```bash
./scripts/scoop evidence replay
```

The command validates all hashes and review gates before it creates a private temporary PostgreSQL cluster. It runs Alembic to head, bootstraps the legacy tables through the application metadata, forces offline mode, runs the real resolver, adapters, policy, materializer, calculations, dossier projection, and assertions, and exports claim bundles in its JSON report. It never connects to or clears `DATABASE_URL`.

The checked corpus contains primary-source response bodies, request metadata, hashes, normalized records, expectations, and negative assertions for all 20 public cases. Each case remains `review.status=pending`; the public command exits with code 2 only because an independent reviewer has not approved the records and expectations. Automated tests exercise the replay engine under an explicitly non-review test identity without modifying that release gate.

To refresh corpus captures, run `PYTHONPATH=backend uv run python backend/scripts/capture_evidence_corpus.py`. SEC requests also require `SCOOP_SEC_USER_AGENT` with real contact information, following SEC fair-access guidance. The capture command fails that source explicitly when the value is missing.

The public registry deliberately names benchmark cases and their failure modes but contains no expected ownership path. Fifteen cases can be used during development; five remain hidden for final evaluation.

## Deliberate non-claims

This implementation does **not** claim that the 20 benchmark bundles or five hidden cases have been independently approved. The public captures and expectations are present; reviewer signatures and independently authored hidden cases remain external release gates.

`app.proof_suite.runner.evaluate_case_against_database` and `./scripts/scoop evidence replay` exercise complementary assertion sets. Release still requires an independent reviewer for the 20 public cases and five hidden cases commissioned from people who did not write the parsers.
