# Research model selector and activity UI

## Goal and done criteria

Make research failures truthful and actionable, expose the configured model choice, and show the agent's available live activity instead of only `Starting research...`.

Done criteria:

- The backend publishes configured research models and accepts a validated per-request selection.
- Rate-limit responses identify the selected model and tell the user what to do.
- The frontend renders model selection and thought/tool activity while preserving the existing completion and persistence flow.
- Focused tests and frontend checks pass without weakening repository quality rules.

## Status

Implemented for the source tree. The backend now emits event-level thought, tool-start, and tool-result updates, and the frontend renders those updates in the assistant card and Research Log.

The LangGraph boundary now requests both `updates` and `messages`. Provider-exposed reasoning
and text deltas are carried as typed `model_delta` events; hidden chain-of-thought is not
invented or exposed when the provider does not return it.

## Files changed

- Backend research request/catalog models, route, service wrapper, and model resolution in `backend/app/models/research.py`, `backend/app/api/routes/research.py`, `backend/app/services/news_research.py`, `backend/app/services/research_models.py`, and `backend/news_research_agent.py`.
- Refreshed `backend/openapi.json` and `frontend/lib/generated/openapi.ts` for the new catalog route and optional model fields.
- Frontend research stream types/parser, model hook/selector, workspace, message body, and activity timeline under `frontend/app/search/research/`.
- Regression coverage in `backend/tests/test_research_models.py` and `frontend/__tests__/search-research-stream.test.ts`.
- `docs/Log.md`.

## Commands and tests

- `python -m compileall -q app news_research_agent.py` — passed.
- `backend/.venv/bin/pytest -q tests/test_research_models.py tests/test_news_research_agent_stream.py tests/test_llm_backend_opencode.py` — 26 passed.
- `npx tsc --noEmit --pretty false` — passed.
- `npm run lint` — passed.
- `npx jest --runInBand __tests__/search-research-stream.test.ts` — 2 passed.
- `npm test -- --runInBand` — 57 suites and 201 tests passed.
- `npm run build` — passed.
- `npm run cli:schema:check` — passed after refreshing the checked-in OpenAPI artifacts.
- `node scripts/check-file-lines.mjs backend/news_research_agent.py` — passed; the touched agent is 2,075 lines and no longer exceeds its 2,081-line cap.
- `git diff --check` — passed.
- A live direct probe tested all seven OpenCode `-free` model IDs; three returned 200 and four
  returned provider errors.
- A live local `/api/news/research/stream` request using Ling completed in 31.7 seconds with
  `status`, `model_delta`, `tool_start`, `thinking_step`, `tool_result`, article, and `complete`
  events.

The open localhost browser page previously showed the native research-model selector and
actionable rate-limit message in a stored error state. Chrome DevTools could not attach for a
fresh screenshot, so the live event proof is from the local HTTP stream rather than a browser
visual check.

The full backend suite reached 827 passed and 3 skipped, but fails in the existing `tests/test_article_contract.py` tests `test_browse_and_cached_articles_share_canonical_keys` and `test_semantic_search_wraps_a_canonical_article_without_aliases`. Those failures are outside the research files and were left untouched to preserve the user's unrelated worktree changes.

The repository self-test still fails its repo-wide quality gate: the final verifier reports 2 CCCC violations and 139 maintainability-index violations. The touched source, frontend lint/typecheck, focused backend tests, and OpenAPI parity are green; this task did not broaden into the unrelated quality-hardening backlog.

After the stop-hook replay, the changed backend files also pass the hook's unpinned Ruff check and 35 focused research tests pass. The remaining hook block is isolated to `frontend/lib/generated/openapi.ts`: the hook runs Oxlint one file at a time and reports `No files found` for this generated/ignored file, while `npm run lint` passes the normal directory scan. The hook implementation, not application source, must skip ignored generated files or treat that no-file result as a skip.

The follow-up React warning was reproduced from duplicate streamed observations. The activity-step key now combines step type, timestamp, content, and occurrence count; the focused regression test passes with both identical observations rendered.

## Assumptions and risks

- The catalog exposes models for the active backend. The local runtime was restarted with the
  checked-in source and returned Ling plus the two verified Nemotron alternatives.
- The production frontend `.env.local` still points at `https://api.jordandgreen.com`; deploying
  the backend/frontend changes is still required for that remote browser session to receive the
  new catalog and stream events.
- Backward-compatible stream parsing remains necessary because older services may omit the new activity fields.

## Rollback or next executable step

Rollback is a source revert of the research catalog/event changes. The next executable step is a
Chrome DevTools smoke test against the deployed API after deployment; the connector was not
available in this run.
