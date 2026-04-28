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
- Before committing broad cleanup, check staged deletions against live references and keep package manifests aligned with tracked lockfiles.
- Before ending a merge or push-repair task, run `rg -n '<<<<<<<|=======|>>>>>>>'` on touched text files.

## Documentation Health

Treat `README.md`, `docs/`, and the GitHub Wiki as part of repo health.

Check documentation when a task changes public behavior, setup steps, install commands, config files, environment variables, CLI commands, public APIs, UI workflows, architecture, troubleshooting steps, dependencies, screenshots, or release behavior.

Documentation surfaces:
- `README.md`: short repo front page for what the project is, quick start, core commands, and links to deeper docs.
- `docs/`: developer, maintainer, and agent-facing documentation that should be reviewed with code.
- GitHub Wiki: longer end-user documentation, guides, workflows, troubleshooting, architecture explanations, and release notes. The wiki is a separate Git repository at `OWNER/REPO.wiki.git`; editing `docs/` does not update it.

Before editing documentation, read:
1. `docs/documentation-maintenance.md`
2. `docs/documentation-style-guide.md`

Before finishing a task, include one of:
- `Docs updated:` list changed README/docs/wiki pages and wiki commit hash if pushed.
- `Docs checked, no update needed:` give the concrete reason.
- `Docs update needed but not pushed:` explain the blocker and the exact pages that need changes.

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

For frontend dependency changes:
- use npm manifests and lockfiles as the source of truth
- do not leave stale alternate package-manager lockfiles in the repo

## Done Means

A task is done only when:
- requested changes are complete
- strongest available verification ran
- failures are fixed or explicitly marked blocked with reason
- reusable failures are recorded in `docs/agent/known-errors.md`
- reusable lessons are recorded in `docs/agent/learnings.md`
- `docs/Log.md` is updated when behavior/process changed
