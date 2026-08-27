# 2026-06-01 Language Forensics Diagnostics

## Scope

Implemented the next Scoop roadmap slice: deterministic article language forensics for passive voice, actor omission, euphemisms, and sanitized language.

## Changes

- Added `backend/app/services/language_diagnostics.py`.
- Added `LanguageDiagnosticsRequest` and `LanguageDiagnosticsResponse` models.
- Added `POST /api/article/language-diagnostics`.
- Added `language_diagnostics` to `POST /api/article/analyze` responses after article extraction.
- Added a Language Forensics card to the expanded article detail workspace.
- Refreshed `backend/openapi.json` and `frontend/lib/generated/openapi.ts`.

## Verification

- `python -m py_compile backend/app/services/language_diagnostics.py backend/app/api/routes/article_analysis.py backend/app/models/article_analysis.py`: passed.
- `uv run pytest backend/tests/test_language_diagnostics.py -q`: 3 passed, 9 warnings.
- `npm run openapi:refresh`: passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`: passed.
- `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`: passed.
- `npm --prefix frontend run lint`: passed.

## Remaining

Run frontend build, visual verification, repository hygiene checks, and full `scripts/self-test` before handoff.
