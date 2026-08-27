# Scoop Source Review And Contradiction Slice Trace

Date: 2026-05-31

## Scope

- Implement the first roadmap slice from the Scoop idea notes.
- Preserve the existing source filter, topic cluster, and saved queue flows.
- Keep `/sources/add-rss` compatible while adding reviewed intake endpoints.
- Avoid a new LLM dependency for contradiction panels.

## Changes

- Backend source intake now has RSS validation and promotion endpoints, source type and paywall metadata, and compatibility promotion through `/sources/add-rss`.
- Source credibility scoring now includes correction-history and methodology-transparency dimensions from analysis scores and catalog policy signals.
- Topic clusters expose deterministic contradiction panels at `/trending/clusters/{cluster_id}/contradictions`.
- Reading queue items now store why an article was saved, the unresolved question, and an optional shelf. Reading shelves have create, update, and list endpoints.
- Frontend browse has News Lens filtering, source sidebar lens controls, reviewed RSS promotion fields, and contradiction panels in expanded clusters.
- Frontend saved articles has research shelf creation and shelf listing.
- OpenAPI artifacts were refreshed from the FastAPI app.

## Verification

- `python -m py_compile backend/app/api/routes/sources.py backend/app/api/routes/trending.py backend/app/services/contradiction_extractor.py backend/app/services/reading_queue.py backend/app/services/source_credibility.py backend/app/models/reading_queue.py backend/app/models/news.py backend/app/database.py`: passed.
- `uv run pytest backend/tests/test_contradiction_extractor.py backend/tests/test_sources_intake.py backend/test_reading_queue.py -q`: 22 passed, 8 warnings.
- `npm --prefix frontend test -- news-lens.test.ts --runInBand`: 6 passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run build`: passed.
- `npm run openapi:refresh`: passed.
- `scripts/self-test`: passed via `./verify.sh`; frontend build and lint passed, backend mypy passed, formatting passed, Rust RSS parser bindings built, and backend tests reported 412 passed, 3 deselected, 9 warnings.
- Visual check: captured desktop source lens drawer, mobile source lens drawer, and saved workspace empty state. Adjusted the saved empty state so Research Shelves remains visible when there are no saved articles.
- `git diff --check`: passed.

## Notes

- Backend warnings during focused tests were existing SQLAlchemy, Pydantic, and datetime deprecations.
- Full self-test warnings were existing SQLAlchemy, Pydantic, FastAPI `on_event`, and MBFC deprecations.

## Follow-On Slice

Implemented the Story Lineage foundation after the first source/contradiction slice:

- Added durable `StoryCluster`, `ArticleEdge`, `ExtractedClaim`, `ClaimEdge`, and `Correction` models.
- Added `/trending/clusters/{cluster_id}/lineage`.
- Added `StoryLineagePanel` to expanded topic clusters.
- Added `backend/tests/test_story_lineage.py`.
- Refreshed OpenAPI artifacts.

Focused checks:

- `uv run pytest backend/tests/test_story_lineage.py backend/tests/test_contradiction_extractor.py backend/tests/test_sources_intake.py backend/test_reading_queue.py -q`: 24 passed, 8 warnings.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`: passed.
- `npm --prefix frontend run lint`: passed.
- `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`: passed.
- `uvx ruff check backend/app/services/story_lineage.py backend/app/api/routes/trending.py backend/tests/test_story_lineage.py`: passed.
- `npm --prefix frontend run build`: passed.
- `scripts/self-test`: passed via `./verify.sh`; backend tests reported 414 passed, 3 deselected, 9 warnings.
- `git diff --check`: passed.
- Visual follow-up: attempted to start `npm --prefix frontend run dev` after the lineage UI change. Next.js reported a stale `.next/dev/lock` from another dev instance and no listener was present on ports 3000 or 3001, so the lineage panel did not get a fresh browser screenshot in this pass.
