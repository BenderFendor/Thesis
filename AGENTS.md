# AGENTS.md

## Purpose

This repository is intended for Codex agents.

Target loop:

```txt
orient -> inspect -> edit -> self-test -> diagnose -> fix -> verify -> record learning
```

Codex-only conventions:
- Use `AGENTS.md` for durable instructions.
- Do not create `CLAUDE.md`.
- Do not create `.claude/`.

## Read First

Before editing code, read:
1. `docs/agent/repo-map.md`
2. `docs/agent/testing.md`
3. `docs/agent/workflows.md`
4. `docs/agent/known-errors.md`
5. `docs/agent/learnings.md`

## Orientation

Run:

```bash
scripts/agent-summary
```

If the script fails, inspect `README.md`, `verify.sh`, and stack manifests manually.

## Core Rules

- No emojis in logs, UI, docs, or notes.
- Use `uv` instead of `pip` for Python work.
- Keep writing concise and concrete.
- Never create markdown summary files (`*_SUMMARY.md`, `*-summary.md`, similar variants).
- Log meaningful process or behavior changes in `docs/Log.md`.
- Do not write standalone session logs to `./log/` for normal code changes.

## Self-Test Requirement

Before finishing any coding task, invoke:

```txt
$self-test
```

Or run:

```bash
scripts/self-test
```

In this repo, `scripts/self-test` uses `./verify.sh` as the strongest verification path when available.

## When To Use Websearch or Exa-Code

Use websearch for:
- official docs
- migration guides
- package manager behavior
- framework/test/build tooling updates

Use exa-code for:
- current API examples
- real GitHub usage patterns
- SDK and MCP setup examples
- unfamiliar framework conventions

Do not guess unfamiliar API payload shapes or tool behavior.

## Domain Pointers

For RSS catalog changes in `backend/app/data/rss_sources.json`:
- validate with `python backend/scripts/validate_rss_sources.py`
- backfill ownership labels with `python backend/scripts/backfill_rss_ownership_labels.py` when needed

## Done Means

A task is done only when:
- requested changes are complete
- strongest available verification ran
- failures are fixed or explicitly marked blocked with reason
- reusable failures are recorded in `docs/agent/known-errors.md`
- reusable lessons are recorded in `docs/agent/learnings.md`
- `docs/Log.md` is updated when behavior/process changed
