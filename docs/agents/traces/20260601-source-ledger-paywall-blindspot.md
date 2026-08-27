# 2026-06-01 Source Ledger And Paywall Blindspot Trace

## Scope

Implemented the next Scoop roadmap layer after story lineage:

- Source Ledger aggregation for source wiki pages.
- Paywall-concentration metrics on blindspot viewer cards.
- Frontend surfacing for source-level ledger metrics and paywall-heavy blindspots.

## Code Changes

- Added `backend/app/services/source_ledger.py`.
- Extended `backend/app/api/routes/wiki.py` source profile responses with `source_ledger`.
- Extended `backend/app/services/blindspot_viewer.py` and `backend/app/api/routes/blindspots.py` with `paywall_concentration`.
- Updated `frontend/lib/api.ts` and regenerated `frontend/lib/generated/openapi.ts`.
- Updated `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx` with Source Ledger cards and quick facts.
- Updated `frontend/components/blindspot-view.tsx` with paywall badges and free-alternative text.
- Added backend tests for Source Ledger and paywall concentration.

## Verification

- `python -m py_compile backend/app/services/source_ledger.py backend/app/services/blindspot_viewer.py backend/app/api/routes/wiki.py backend/app/api/routes/blindspots.py`: passed.
- `uv run pytest backend/tests/test_source_ledger.py backend/tests/test_blindspot_viewer.py backend/tests/test_blindspots_api.py backend/tests/test_wiki_sources.py -q`: 36 passed, 9 warnings.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`: passed.
- `npm --prefix frontend run lint`: passed.
- `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`: passed.
- `npm run openapi:refresh`: passed.
- `npm --prefix frontend run build`: passed.
- `scripts/self-test`: passed through `./verify.sh`; 416 passed, 3 deselected, 9 warnings.

## Visual Check

- `npm --prefix frontend run dev` was blocked by stale `frontend/.next/dev/lock`; port 3000 was not responding.
- `npm --prefix frontend run start -- -p 3002` served the built app after the production build.
- Local backend startup with default environment failed because `LLM_BACKEND=llamacpp` required an unavailable `localhost:8080` llama.cpp server.
- Backend startup with `LLM_BACKEND=openrouter` then waited for unavailable PostgreSQL.
- Backend startup with `LLM_BACKEND=openrouter ENABLE_DATABASE=0` served, but DB-backed endpoints returned `Database access requested but ENABLE_DATABASE=0`.
- Source Ledger and blindspot paywall UI states were visually checked in Chrome with browser-side mocked API responses for the changed endpoints.
- Screenshots saved under `/tmp/source-ledger-desktop.png`, `/tmp/source-ledger-mobile-ledger.png`, and `/tmp/blindspot-paywall-desktop.png`.
