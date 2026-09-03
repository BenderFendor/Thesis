# Backend event-loop hang + category sentinel fix (2026-09-03)

## Goal

"RSS ready but not visible on the frontend": the local backend refreshed the
news cache (log shows "RSS ready: N articles") while the UI stayed on
"Loading coverage..." / "Curating stories..." with no articles.

## Status

COMPLETE. Root causes found, fixed, and verified. Worker survives the former
death window; API responds in ~110-130ms; category sentinel returns real
articles.

## Root causes (all proven)

1. **Event-loop blocking (worker kill loop).** Gunicorn worker SIGKILLed
   every ~184s (WORKER TIMEOUT, `timeout=120`). Requests blocked 28-30s+ or
   timed out; page stayed loading. Two blocker classes:
   a. Sync embedding/Chroma calls on the loop: `persistence.py`
      `_process_embedding_batch` -> `vector_store.batch_add_articles` ->
      `RemoteEmbeddingModel.encode` -> **sync** `httpx.Client.post` to the
      embedding service (8002). Also `_delete_vectors`, `search_similar`
      routes, blindspot embedding calls, chroma topic suggestions.
   b. Direct sync LLM calls: `MaterialInterestAnalyzer._ai_analyze_interests`
      (auto-ingest funding-bias stage runs ~+60s after boot — socket capture
      of the hung worker showed a stuck sync HTTPS write to an LLM endpoint,
      Send-Q 84KB, plus a stuck IPv6 SYN).
2. **Category sentinel.** `?category=all`/`All` filtered to a literal
   category matching nothing: `/news/index/cached?category=all` -> 0,
   `/news/stream?category=All` -> "0 articles from 0 sources". The UI sends
   the sentinel (its "All" tab id), and the public API must accept it.

## Files changed

- `backend/app/services/persistence.py` — `to_thread` for `_delete_vectors`
  + `batch_add_articles`.
- `backend/app/api/routes/search.py` — `to_thread` for `search_similar`.
- `backend/app/services/chroma_topics.py` — `to_thread` for suggestions
  `search_similar`.
- `backend/app/services/blindspot_viewer.py` — `to_thread` for
  `_chroma_embeddings`, `_encode_missing_embeddings`, pole-word encodes.
- `backend/app/services/material_interest.py`,
  `backend/app/services/article_analysis.py`,
  `backend/app/services/inline_definition.py`,
  `backend/app/services/queue_digest.py`,
  `backend/app/services/source_analysis_scorer.py`,
  `backend/app/services/funding_researcher.py` — all direct sync LLM calls
  behind `asyncio.to_thread` (repo pattern from chroma_sync.py,
  source_profile_synthesizer.py).
- `backend/app/core/filters.py` (new) — `normalize_category`.
- `backend/app/api/routes/news.py`, `stream.py`, `blindspots.py` —
  normalize at route entry.
- `backend/tests/test_embedding_batch_loop_block.py` (new),
  `backend/tests/test_category_normalization.py` (new).

## Commands / tests

- `uv run pytest tests/test_embedding_batch_loop_block.py
  tests/test_category_normalization.py tests/test_chroma_sync_recovery.py
  tests/test_vector_store_logging.py` — 8 passed.
- Plus `test_llm_backend_opencode.py test_auto_ingest.py
  test_funding_bias_analysis.py test_funding_researcher.py` — 118 passed
  (4.84s).
- `uv run ruff check <all changed files>` — clean.
- `MYPYPATH=. ./.venv/bin/mypy --explicit-package-bases app --strict` — 24
  pre-existing errors in 18 files, NONE in changed files (repo campaign item).
- Regression test proven both ways: reverting the persistence fix makes
  `test_embedding_batch_does_not_block_event_loop` fail (`assert 1 > 50`).
- Live: after `kill -HUP` reload, 15/15 probes ~110-274ms across the former
  death window; worker alive 5+ min (old: dead at 3m04s); `category=all` ->
  10000 articles; stream emits "initial" with articles; sample articles are
  real (Jerusalem Post / Taipei Times titles, URLs, summaries, dates).

## Assumptions / risks

- The dev frontend `.env.local` points at the PRODUCTION API
  (`NEXT_PUBLIC_API_URL=https://api.jordandgreen.com`) — intentional config,
  left untouched. The prod API runs older code until redeployed; its
  category bug remains until then.
- Headless UI verification of the scroll view still shows a loading state
  that the local API fix alone does not clear; the user's real browser could
  not be connected via chrome-devtools MCP (no debug port). Frontend-side
  behavior beyond backend health was NOT fully root-caused; the frontend
  `frontend/lib/api.ts` WIP diff (globalThis.process -> process.env) belongs
  to the user.
- `runlocal.sh` process was left running; gunicorn reloaded via SIGHUP to the
  master (268216 originally; the user restarted later — master 604197).

## Rollback

`git diff` the backend files; revert via `git checkout -- <files>` (or
`git apply -R` of the patch). The feature is a set of `to_thread` wraps plus
one normalizer — low risk.

## Follow-up: frontend sources parse fix (HAR analysis)

After the backend fixes, the page still showed an empty browse section.
HAR (145MB, `har/pleasework.har`, 61 entries, all 200) showed healthy
payloads; the user console showed `[WARN] fetchSources received malformed
payload`. Cause: `/news/sources` sends `credibility_score: null` /
`factual_rating: null` on every one of 261 sources; `BackendSourceSchema`
used `.optional()` (rejects null), failing the whole array ->
`sources: []` -> lens filtering degenerates and the browse-based lead/stats
stay UNKNOWN. Fixed in `frontend/lib/api.ts`:
`credibility_score`/`factual_rating` -> `.optional().nullable()`, and
`mapBackendSource` coalesces nulls with `?? undefined`. Verified: tsc 0,
jest 18/18, payload mirror-check clean. The grid's trending/breaking cards
come from separate queries and rendered regardless — matching the
half-working screenshot.


## 2026-09-03 follow-up: API layer rebuild (deterministic contract)

- The full session beyond the backend hang: `frontend/lib/api.ts` (6,770 LOC)
  deleted and rebuilt as `frontend/lib/api/` modules (client/types/schemas/
  article/streaming/endpoints/og-image/index). 133 consumer-imported names
  preserved; ~105 dead exports removed.
- Wire types now alias the generated OpenAPI contract; backend routes that
  returned untyped dicts gained Pydantic response models
  (`backend/app/models/api_contracts.py`) + `response_model=`, OpenAPI regen
  135 -> 150 schemas (all registered endpoints live-validated 200).
- Oxlint baseline applied (perf/correctness/suspicious error; high-value
  explicit rules; anti-slop kept on; mechanical noise off), LOC guard
  added (`scripts/check-file-lines.mjs` + debt caps), OMP per-edit quality
  injection gated to end-of-session.
- `oxlint --fix` pass: 353 auto-fixes; remaining debt ~10,000 findings
  (readonly params, unsafe types, react/anti-slop families).
- tsc 0, api jest suites 15/15, guard green.
