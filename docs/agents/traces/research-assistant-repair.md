# Research Assistant Repair

## Goal and done criteria

Restore the OpenCode-backed research assistant, stop the research page from remaining in its
running state after provider failures, repair the liked/bookmark response contract, bound remote
embedding batches, and remove the narrow-screen header grouping defect.

Done means the focused regression tests, backend lint, frontend TypeScript, and affected Oxlint
checks pass; the API response shape is verified through a running FastAPI process; and remaining
provider or browser limitations are stated with evidence.

## Status

Code repair complete. Focused checks pass. `/api/liked` returned HTTP 200 with seven flat entries.
The OpenCode key and `/models` endpoint work, and a real request with the required headers reaches
the gateway. The current free account is rate limited, so a successful model completion is not
runtime-verified.

## Files changed

- `backend/app/core/config.py`
- `backend/news_research_agent.py`
- `backend/agentic_search.py`
- `backend/app/api/routes/research.py`
- `backend/.env.example`
- `backend/app/models/api_contracts.py`
- `backend/app/embedding_client.py`
- `backend/openapi.json`
- `backend/tests/test_llm_backend_opencode.py`
- `backend/tests/test_news_research_agent_stream.py`
- `backend/tests/test_embedding_service_boundary.py`
- `frontend/app/news-page-header.tsx`
- `docs/Log.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`

## Commands and tests run

- `uv run pytest tests/test_llm_backend_opencode.py tests/test_news_research_agent_stream.py tests/test_research_stream.py tests/test_liked.py tests/test_embedding_service_boundary.py -q`
- `uv run ruff check` on all touched Python files
- `frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit`
- focused Oxlint on `frontend/app/news-page-header.tsx`
- running FastAPI process: `GET /api/liked` returned `200`
- `python -m json.tool backend/openapi.json`
- `git diff --check` on the focused files
- `scripts/self-test` (repository verifier completed with the backlog below)
- `MYPYPATH=. backend/.venv/bin/mypy --explicit-package-bases app --strict`

## Assumptions and risks

The OpenCode request headers are based on the official OpenCode client behavior and the Zen
gateway's current response. Free model availability and quota are upstream state. The research
client uses a fresh OpenCode-compatible LangChain client for each model phase so its session
header cannot be shared between concurrent research runs.

## Remaining failures or blockers

- OpenCode free completion is currently rate limited; a paid model was not selected because that
  could incur user charges.
- Chrome DevTools MCP still reports `Could not find DevToolsActivePort` even though the disposable
  Chrome process exposes port 9222; browser visual proof is therefore pending connector repair.
- The fresh repository verifier reports 0 Oxlint errors and 0 warnings, 2 CCCC violations, and
  136 code-multivitals violations. Strict backend mypy reports 20 errors across 17 untouched
  backlog files; the five errors in files changed by this repair were removed. The repository is
  therefore not green overall.

## Rollback or next executable step

Revert the focused checkpoint commit to roll back this repair. To finish runtime proof, retry one
free OpenCode completion after the provider quota resets and attach Chrome DevTools through a
supported remote-debugging session, then run `scripts/self-test` after the backlog is repaired.
