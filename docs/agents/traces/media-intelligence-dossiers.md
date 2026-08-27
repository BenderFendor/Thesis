# Media Intelligence Dossiers

## Goal and done criteria

Build dossier-first media intelligence on SCOOP's existing evidence spine. Make ingestion observable, preserve exact entity and relationship distinctions, add primary-source adapters and reproducible measurements, replace the generic inspector with direct answers, and enforce a real offline 20-case replay gate.

## Status

Implementation and repository verification are complete. The public corpus has 20 pinned primary-source cases, hashes, request metadata, normalized records, expectations, and negative assertions. Release remains blocked on independent approval of those 20 cases and five independently authored hidden cases. Automated replay uses an explicitly non-review test identity and does not modify the release manifest. Browser visual verification remains blocked because Chrome has no `DevToolsActivePort` and the required Chrome DevTools connection cannot attach.

## Files changed

- Evidence schema and migration: `backend/app/models/evidence.py`, `backend/alembic/versions/20260721_0004_organization_subsidiaries.py`, `backend/alembic/versions/20260721_0005_evidence_dossiers.py`
- Atlas contracts and services: `backend/app/models/atlas.py`, `backend/app/api/routes/wiki_atlas.py`, `backend/app/services/atlas_entity.py`, `backend/app/services/atlas_evidence_projection.py`, `backend/app/services/atlas_graph.py`
- Ingestion and policy: `backend/app/services/auto_ingest.py`, `backend/app/services/evidence_ingest.py`, `backend/app/services/primary_source_adapters.py`, `backend/app/services/evidence_policy.py`, `backend/app/services/evidence_spine.py`, `backend/app/services/entity_resolver.py`
- Measurements and replay: `backend/app/services/media_measurements.py`, `backend/app/scripts/replay_evidence_corpus.py`, `backend/scripts/capture_evidence_corpus.py`, `backend/tests/evidence_corpus/`, `scripts/scoop`
- Frontend: `frontend/features/intelligence-atlas/`, generated OpenAPI contracts
- Documentation: `README.md`, `docs/intelligence-atlas.md`, `docs/scoop-evidence-spine.md`, `docs/Log.md`, `docs/agent/learnings.md`, GitHub Wiki

## Commands and tests run

- Applied Alembic `20260721_0005` to the configured PostgreSQL database.
- Captured all 20 public primary-source cases with deterministic HTTP retrieval; all stored responses returned HTTP 200 and have checked SHA-256 hashes.
- Ran the replay engine against a private temporary PostgreSQL cluster: 20 cases, Alembic head, 22 documents, 22 observations, 22 accepted claims, six measurements, policy/materialization, dossier projection, and claim-bundle export passed.
- `./scripts/scoop evidence replay`: expected exit 2 listing only missing independent signoffs.
- Focused backend Atlas, adapter, parser, measurement, replay, startup-lock, and ingest-ledger tests: passed.
- Focused backend Ruff and strict mypy: passed.
- Frontend dossier/schema tests and ESLint: passed.
- Live API on port 8126: ingestion status, CNN search, CNN dossier, and media measurements returned HTTP 200. CNN measurements covered 2,847 indexed articles; the dossier did not promote the legacy parent-company claim.
- `scripts/self-test`: passed. Frontend build and lint, TypeScript, OpenAPI/CLI parity, strict mypy, Ruff, formatting, Rust, and 627 backend tests passed; 3 tests were deselected by the repository suite.
- Chrome desktop/mobile verification: blocked before navigation because Chrome was not running with a discoverable `DevToolsActivePort`. Component tests and the production frontend build passed, but no screenshot claim is made.
- GitHub Wiki: updated Architecture, User Workflows, and Release Notes; pushed commit `fe09821`.

## Assumptions and risks

- `relation_type` remains for one compatibility cycle and is marked deprecated. Reasoning uses exact predicates.
- Adapters create candidates only. Policy and materialization remain the only accepted-relationship path.
- Companies House requires `COMPANIES_HOUSE_API_KEY`; missing credentials are recorded as blocked and no fallback source is used.
- The benchmark records are not called reviewed until an independent person approves them. The checked records name only entities, amounts, and relationships present in their pinned primary sources; the release gate still requires a second person to verify every locator and expectation.
- SEC recapture requires `SCOOP_SEC_USER_AGENT` with real contact information. A missing value blocks that source instead of substituting another provider.
- Five hidden cases must not share parser authorship and are outside this repository work.

## Remaining blocker

Obtain independent reviewer identities and approval for all 20 public records and expectations, then commission five hidden cases from non-parser authors. After those external actions, rerun `./scripts/scoop evidence replay`. Reconnect Chrome and repeat the desktop/mobile directory, dossier, evidence, and graph journey for visual signoff.

## Rollback

Downgrade Alembic revision `20260721_0005`, revert API and frontend contract fields together, and remove the new adapter, measurement, and replay modules. The capture corpus is immutable test data and can be removed independently if the benchmark is withdrawn.
