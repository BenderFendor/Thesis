# Repository root cleanup

## Goal

Reduce tracked repository-root clutter and keep local agent state, debug bundles, and temporary placeholders out of GitHub.

## Starting state

- Branch `main`, commit `55c1c75`.
- The worktree was clean except for the untracked user-owned `har/` directory. Preserve it.
- `debug-bundles/` contains only a tracked `.gitignore` marker. No bundle data is present.
- `runtime-data/` contains 549 MB of local data; only its `.gitignore` marker is tracked. Preserve its contents locally.
- `aaa-temp.txt`, `temp-ignore.txt`, and `zzz-temp.txt` contain only one newline each and have no source references.
- `lint-fix.patch.gz.b64` contains only `PLACEHOLDER` and has no source references.
- `.github/skills/` has 22 tracked files. References outside that directory are limited to an audit item that says to remove the skill templates.
- `.serena/` has three tracked local-tool files and no live references outside historical planning notes.
- Root `papercuts.md` and `.papercut-resolutions.jsonl` are tracked local friction state.

## Plan

1. Delete `.github/skills/`, `.serena/`, the `debug-bundles/` marker, and the empty or placeholder root files listed above.
2. Remove `papercuts.md` and `.papercut-resolutions.jsonl` from the Git index while keeping their local copies unchanged. Stage only these two deletions so the next commit stops tracking them.
3. Ignore the local Papercut files, `runtime-data/`, and other removed local/generated paths so they do not reappear in Git status or the GitHub root listing.
4. Update the quality audit to mark the `.github/skills/` removal complete, add a concise entry to `docs/Log.md`, and keep this trace as the before-and-after record.
5. Move `cccc.toml` and both quality-hardening policy files into `scripts/quality-hardening/`. Update the loader, CCCC runner, and current documentation references.
6. Move the root `chroma.log` into `log/` under a distinct name because `log/chroma.log` already exists. Update the diagnostic script to check the log directory.
7. Keep package manifests, `.env.example`, Docker config, `runlocal.sh`, and `verify.sh` at the root where the repo expects them. Do not move unrelated root files.
8. Preserve `har/`, local caches, worktrees, Papercut files, and all files not listed above.

## Verification

- `node scripts/quality-hardening.mjs validate` passed after relocating the policy and taxonomy.
- `node --test scripts/tests/quality-hardening/*.test.mjs` passed: 25 tests.
- `bash -n scripts/check-complexity scripts/diagnose runlocal.sh` passed.
- `scripts/diagnose` found the Chroma logs under `log/`; `./runlocal.sh help` reports `./log` as the default.
- `git diff --check` and `git diff --cached --check` passed. `git check-ignore --no-index -v` matched the removed local paths, retained Papercut files, moved Chroma log, and `runtime-data/`.
- `papercuts.md` and `.papercut-resolutions.jsonl` have the same SHA-256 hashes as `HEAD`, remain present locally, and are staged for removal from the Git index.
- The watchdog-wrapped `scripts/self-test` exited 1 after 136.67 seconds at `node scripts/quality-hardening.mjs verify --scope repo`. Report: `.quality-hardening/reports/repo-root-cleanup-self-test.json`.
- The verifier report found 2 CCCC violations and 141 code-multivitals violations. The previous report `45a906ba276cb0bde413fee6.json` had the same counts. `scripts/quality-hardening/config.mjs::loadPolicy` remained at MI 47.9 in both reports. The relocated CCCC config loaded and produced a report; the verifier failure is the existing repository-wide quality backlog.

## Changed files

- `.gitignore`: ignore the local skills directory, Serena state, Papercut files, debug bundles, named placeholders, and `runtime-data/`.
- `.env.example`: removed; `backend/.env.example` is the documented setup template.
- `.jscpd.json`: moved to `scripts/quality-hardening/.jscpd.json`; the package command points to the new path.
- `.github/skills/`, `.serena/`, `debug-bundles/.gitignore`, empty root placeholders, and the `PLACEHOLDER` patch: removed.
- `papercuts.md` and `.papercut-resolutions.jsonl`: removed from the Git index only; local copies retained and ignored.
- `cccc.toml`, `quality-hardening.config.json`, and `quality-hardening.rules.json`: moved to `scripts/quality-hardening/`.
- `scripts/quality-hardening/config.mjs`, `scripts/check-complexity`, and `scripts/diagnose`: updated to use the new paths.
- `runlocal.sh`: corrected help text to match its existing `log/` default.
- `docs/Log.md`, `docs/agent/code-quality-audit.md`, `docs/agent/lean-codebase-plan.md`, and the quality-hardening architecture doc: updated current guidance.
- `log/chroma-root-2026-09-16.log`: moved from the root without replacing the existing `log/chroma.log`.
- Untracked user data in `har/` and local contents of `runtime-data/` were preserved.

## Status

Requested cleanup and path migration are complete. The repository-wide quality gate still reports the same 2 CCCC and 141 code-multivitals violations as the prior measurement.

## Follow-up root audit plan and outcome

- Remove root `.env.example`: setup uses `backend/.env.example`; the root sample has unused Jira placeholders and frontend variables with no application consumers.
- Move `.jscpd.json` into `scripts/quality-hardening/` and update its package command and active architecture documentation.
- Keep `.oxlintrc.json`, `.pre-commit-config.yaml`, `.dockerignore`, `.gitignore`, manifests, Docker Compose, license, documentation, workflows, and source directories in their conventional or required locations.
- Preserve ignored local state and the untracked `har/` directory.

Follow-up audit outcome: removed the root template, relocated jscpd config, corrected the setup command and active quality architecture references. `git diff --check` passed; searches found no active references to the removed root template or old jscpd config path.
