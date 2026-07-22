# OpenAPI CLI Parity
Goal: Give agents deterministic access to the same backend capabilities used by Scoop's frontend.
Status: Complete and smoke-tested against a running FastAPI server.
Risk tier: Medium; developer CLI, generated contracts, database migration, structured external-data extraction, and live profile writes.
Primary command: `./scripts/scoop --help`
Schema source: `backend/openapi.json`, generated from `app.main.app.openapi()`.
Rollback: Remove the CLI files and package/verify entries, then remove `add_protocol_extensions(app)`.

## Files changed

- `scripts/scoop` and `scripts/scoop.ts`: TypeScript CLI entry point and transport implementation.
- `scripts/tsconfig.json` and `scripts/tests/scoop.test.ts`: strict typecheck and HTTP transport tests.
- `backend/app/openapi_contract.py`: generated WebSocket metadata for non-OpenAPI transport parity.
- `backend/scripts/export_openapi.py`: schema export and drift check.
- `backend/tests/test_openapi_cli_contract.py`: HTTP and WebSocket route coverage contract.
- `backend/app/main.py`: installs protocol extensions after route registration.
- `package.json` and `verify.sh`: CLI commands and required verification gates.
- `backend/openapi.json` and `frontend/lib/generated/openapi.ts`: regenerated shared contracts.
- `frontend/lib/api.ts`: corrected source credibility route.
- `frontend/app/wiki/ownership/source-intelligence-operations.tsx`: corrected RSS parser test route.
- `README.md`, `docs/agent/testing.md`, and `docs/Log.md`: usage, verification, and change record.

## Commands run

- `scripts/agent-summary`
- `npm run openapi:refresh`
- `npm run cli:typecheck`
- `npm run cli:test`
- `./scripts/scoop schema check`
- `backend/.venv/bin/pytest backend/tests/test_openapi_cli_contract.py -q`
- `uvx ruff format backend/app/openapi_contract.py backend/scripts/export_openapi.py backend/tests/test_openapi_cli_contract.py`
- `uvx ruff check backend/app/openapi_contract.py backend/scripts/export_openapi.py backend/tests/test_openapi_cli_contract.py`
- `backend/.venv/bin/mypy --strict backend/app/openapi_contract.py`
- `./scripts/scoop api smoke health_check_health_get --base-url http://127.0.0.1:8765 --expect-status 200 --expect-json /status=healthy`
- `./scripts/scoop ws listen websocket_endpoint_ws_ws --base-url http://127.0.0.1:8765 --count 0 --timeout 5 --include-meta`
- `scripts/self-test` through command watchdog: passed in 87.869 seconds; 601 backend tests passed, 3 deselected.
- `backend/.venv/bin/alembic current`: `20260721_0004 (head)`.
- Watchdog report: `.agent/traces/openapi-cli-self-test.json`.

## Tests added

- Ten Node tests cover generated inventory, parameter placement and coercion, real HTTP transport, smoke assertions, required-input failures, and all four curated investigation workflows.
- Backend tests cover schema-visible routes, WebSockets, structured organization extraction, cached response completeness, forced-refresh upserts, source labels, and reporter source filtering.

## Failures encountered

- The extracted exporter initially ran as a file and could not import `app`; invoking it as `python -m scripts.export_openapi` fixed the package root.
- The first live smoke inherited the local llama.cpp setting and stopped because port 8080 was unavailable. The isolated smoke used the existing OpenRouter mode with database and vector startup disabled.
- The frontend parity audit found and corrected two stale endpoint paths before the full gate.
- A live Larry Ellison lookup initially adopted The Larry Ellison Foundation's nonprofit tax profile. Wikidata had already identified the subject as human, so nonprofit merge data is now rejected for person types.

## Unverified

- No external RSS, LLM, search-provider, or database-dependent feature was invoked. The CLI transport was exercised against the real FastAPI process through health and WebSocket operations; endpoint-specific feature smokes remain available through `scoop api smoke`.

## Assumptions and limits

- Presentation-only frontend state such as grid versus globe view has no CLI equivalent.
- HTTP streams use the generated OpenAPI operation with `--stream`.
- WebSocket routes use generated `x-scoop-websockets` metadata because OpenAPI 3.1 does not describe WebSockets.
- The CLI contains transport, formatting, and verification logic only. Domain logic remains in backend routes and services.
- The live smoke server disabled database, vector-store, and local llama.cpp startup so the transport path could run without unrelated services.

## Deterministic investigation extension

### Files changed

- `scripts/scoop.ts` and `scripts/tests/scoop.test.ts`: curated organization, ownership, source, and reporter workflows.
- `backend/app/services/funding_researcher.py`: deterministic Wikidata, SEC, and pending-transaction extraction.
- `backend/app/services/entity_wiki_service.py`: labeled organization, funding, parent, and ad-supply source fields.
- `backend/app/api/routes/entity_research.py`: complete cached profiles, refresh upsert, subsidiary responses, and source-value labels.
- `backend/app/api/routes/wiki.py`: reporter directory filtering by source or career history.
- `backend/app/database.py` and `backend/alembic/versions/20260721_0004_organization_subsidiaries.py`: persisted direct subsidiaries.
- `backend/tests/test_funding_researcher.py`, `backend/tests/test_source_profile_completeness.py`, `backend/tests/test_entity_research_routes.py`, and `backend/tests/test_wiki_sources.py`: focused behavior coverage.

### Runtime evidence

- `scoop investigate ownership CNN --max-depth 10` returned `CNN -> Warner Bros. Discovery`; Paramount Skydance remained a proposed change.
- WBD returned `org_type=public company`, no current parent, SEC CIK `0001437107`, EIN `352333914`, FY2025 revenue `37296000000`, and eight direct Wikidata subsidiaries.
- The New York Times Company returned `org_type=public company`, no self-parent, CIK `0000071691`, EIN `131102020`, and annual revenue `2824918000`.
- CNN source research returned `Current parent: Warner Bros. Discovery`, `Organization type: cable news channel`, 935 authorized ad sellers, and ads.txt owner domain `wbd.com`.
- Anderson Cooper resolved as a matched reporter with CNN, ABC News, and Channel One News career entries.
- Larry Ellison resolved as `org_type=human` with no current parent, nonprofit classification, EIN, revenue, or Atlas media-ownership edges.

### Limits

- ads.txt and sellers.json identify authorized ad sellers. They do not identify advertiser customers, so `major_advertisers` stays empty.
- Public parent companies such as WBD have no single ownership percentage. P1107 percentages are returned only when a Wikidata ownership statement supplies that qualifier.
- Private-company revenue and beneficial ownership remain empty without a public filing or qualified ownership statement.
- Reporter source filtering exposes duplicate reporter records already present in storage; record consolidation is outside this change.
