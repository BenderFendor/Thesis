# Testing And Verification

## Preferred Command

- `scripts/self-test`

`scripts/self-test` uses `./verify.sh` as the strongest path when present.

## Current Commands

- setup command
  - `./runlocal.sh setup`
  - Environment keys: copy `.env.example` to `backend/.env` and set required keys.

- test command
  - Full path: `./verify.sh`
  - Backend focused: `bash -lc 'cd backend && .venv/bin/pytest tests -m "not slow"'`
  - Frontend focused: `npm --prefix frontend test`

- lint command
  - Frontend: `npm --prefix frontend run lint`
  - Backend: `uvx ruff check backend/ --fix`

- typecheck command
  - Frontend: `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`
  - Backend: `bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'`

- build command
  - Frontend: `npm --prefix frontend run build`

- e2e command
  - TODO: no stable repo-local e2e command documented yet.

## Known Missing Checks

- No canonical root-level command for focused frontend unit-only pass besides npm scripts under `frontend/`.
- No canonical root-level command for focused backend lint-only/typecheck-only pass besides explicit shell commands.
- No codified Playwright e2e command.

## Known Environment Requirements

- Python environment under `backend/.venv` with requirements installed.
- `uv` and `uvx` available for Python tooling workflows.
- Node/npm installed for frontend checks.
- Rust toolchain available for `backend/rss_parser_rust` checks.
- Optional but common local services: PostgreSQL and ChromaDB (via `runlocal.sh` flow).

## Failure Handling

- If `scripts/self-test` or `./verify.sh` fails, diagnose root cause before editing.
- Re-run the failed command after each fix.
- Re-run full `scripts/self-test` before final handoff.
- Record reusable failures in `docs/agent/known-errors.md`.
- For merge repairs, also run `rg -n '<<<<<<<|=======|>>>>>>>'` on touched files and `git diff --check`.
