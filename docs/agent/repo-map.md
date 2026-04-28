# Repository Map

## Purpose

This map helps Codex agents orient quickly before editing.

## Top-Level Layout

- `backend/`: FastAPI app, services, scripts, and tests.
- `frontend/`: Next.js app, UI components, hooks, and tests.
- `docs/`: project docs, including `docs/agent/` operational guidance.
- `scripts/`: repo-local Codex helper commands.
- `verify.sh`: strongest full-stack verification path.

## Backend Hotspots

- `backend/app/main.py`: FastAPI entrypoint.
- `backend/app/api/routes/`: API routes grouped by domain.
- `backend/app/services/`: business logic and orchestration.
- `backend/app/data/rss_sources.json`: curated RSS catalog.
- `backend/tests/`: backend regression tests.
- `backend/scripts/validate_rss_sources.py`: RSS health validation.
- `backend/scripts/backfill_rss_ownership_labels.py`: ownership label backfill.

## Frontend Hotspots

- `frontend/app/`: route-driven pages.
- `frontend/components/`: reusable UI and feature components.
- `frontend/lib/`: API wrappers and helpers.
- `frontend/hooks/`: query/state hooks.
- `frontend/__tests__/`: frontend tests.

## Verification Entry Points

- Preferred: `scripts/self-test`.
- Strongest path in this repo: `./verify.sh` (invoked by `scripts/self-test`).
- Orientation command: `scripts/agent-summary`.
- Triage helper: `scripts/diagnose`.

## Notes For Future Agents

- Treat `AGENTS.md` as the short map and `docs/agent/*` as detailed operational docs.
- If verification fails with reusable patterns, update `docs/agent/known-errors.md`.
- If you learn a repeatable repo-specific practice, update `docs/agent/learnings.md`.
