# Codex Harness Restructure Plan

## Goal

Make the repository easier for future Codex agents by establishing a clear orientation path, a single self-test entrypoint, and reusable troubleshooting/learning docs.

## Implemented Changes

- Replaced root `AGENTS.md` with a concise Codex-first map.
- Added `scripts/self-test` as repo-local verification entrypoint.
- Added `scripts/agent-summary` as repo-local orientation command.
- Added `scripts/diagnose` as lightweight triage helper.
- Added `docs/agent/` operational docs:
  - `repo-map.md`
  - `testing.md`
  - `workflows.md`
  - `known-errors.md`
  - `learnings.md`

## Why This Split

- `AGENTS.md` stays small, stable, and high-signal.
- `scripts/` holds executable behavior.
- `docs/agent/` holds detailed, updateable operations knowledge.

## Validation Strategy

- Run `scripts/agent-summary` to confirm orientation output.
- Run `scripts/self-test` to execute strongest verification path.
- Record recurring failures and lessons for future agent runs.
