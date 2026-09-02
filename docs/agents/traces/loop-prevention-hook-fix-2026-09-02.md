# Trace: loop-prevention-hook-fix-2026-09-02

## Goal
Mine the last two long Codex sessions (2026-08-31 16:02, 192 MB, and
2026-09-01 19:44, 114 MB) to explain the quality-hardening loop (per-file
errors -> split file -> more files -> more errors -> fan-out) and fix the
harness mechanics that cause it.

## What the sessions did (evidence from transcripts)
Both sessions were the `quality/crap-mi-oxlint-hardening` campaign on Thesis.

- 2026-08-31 session: 44 prompts, 5,270 shell calls, 43 compactions; fixed
  TypeScript baseline, rewrote big functions (api.ts fetchNews, stream parser,
  controller splits), drove CCCC hard violations 371 -> 0, MI/oxlint down to
  13,565 errors / 378 warnings; stop hook fired 28 times.
- 2026-09-01 session: implemented
  `QUALITY-HARDENING-MULTI-OBJECTIVE-AGENT-ARCHITECTURE.md` controller
  (measurements, queue grouped by rule, writer claims, ledger); user
  interrupts at "why are you looping on cccc.mjs?" and "work on the repo
  itself"; ended on rule-clustered fixes (readonly, no-null) with gate at
  12,413 oxlint errors / 315 warnings / 288 CRAP; CCCC 0. One stale
  type-aware oxlint worker ran 90 minutes at 99% CPU ("likely the 'looping'
  behavior you were seeing").
- Modal refactor: 5,136-line article-detail-modal split into wiki/reader/
  actions/analysis/chrome/handlers/language modules; parent 887 -> 97
  diagnostics, children each carry 40-116; aggregate moved 14,356 -> 12,413
  over ~10 hours.

## Loop mechanics identified
1. Stop gate blocked on ANY per-file metric delta (MI 52->50.5, CC 6->9)
   instead of floor crossings -> agents churned behavior-preserving refactors
   back and forth inside a turn ("raise MI above 52", "restore three
   regressed files to turn-start metrics").
2. PostToolUse re-linted every turn-changed file after every edit; type-aware
   oxlint over 14-file changed sets made each edit multi-minute; lingering
   tsgolint workers piled up (90-min, 99% CPU stale worker).
3. Rule set entanglements: one-var deny + sort-vars deny + sort-imports deny
   + no-magic-numbers + no-ternary + jsx-max-depth + max-lines/deps. Fixing
   one rule materializes the next in the same declaration block ("declaration
   chain interrupted by type interfaces -> every declaration after a type
   block flagged"). This is the "delete 1 line, add 2" effect.
4. Splits multiply per-file surfaces: each new module is a separate row in
   every hook message and stop report; aggregate improves slower than the
   parent looks like it should; total files x2-ish per big component.
5. Different analyzers disagree: CCCC says InteractiveGlobe CC 6,
   code-multivitals says 56; CRAP coverage line-mapping moved attribution on
   splits (812-CRAP regression on an untested extracted method) -> reverts.
6. verify.sh full gate 6+ minutes; agents re-ran it once per turn and at
   every stop; no incremental output -> "is it looping?" uncertainty.

## Changes made
- `~/.codex/hooks/quality_metrics.py::fmt_stop`: block only on floor-crossing
  regressions (MI below 50 after being at/above it, CC/cog above 10/15 or
  cross, below-floor files worsening). Lint error/warning increase still
  blocks unless a claimed structural task allows the rule for the path.
- `~/.codex/hooks/stop_dispatch.py`: `lint_changed_files` memoizes python and
  JS/TS lint per file (content + config signature) via SQLite analysis cache;
  typechecks stay grouped.
- `~/.codex/hooks/test_hooks.py`: added `StopQualitySemanticsTests` (7) and
  `LintCacheTests` (3); updated deleted-path lint expectation.
- `docs/agents/quality-hardening/QUALITY-HARDENING-MULTI-OBJECTIVE-AGENT-ARCHITECTURE.md`:
  contradictions 3 and 11 marked RESOLVED with semantics.
- `docs/Log.md`: dated entry.

## Commands run
- `/usr/bin/python3 -m unittest test_hooks` -> 40 tests OK.
- Session mining: python jsonl extraction to /tmp/s1_*.txt, /tmp/s2_*.txt.

## Assumptions
- The approved architecture policy (floor 50 per-turn, MI 60 at cluster close)
  is the authority for stop-gate semantics; final goals are not per-turn
  lanes.
- Lint-cache safety relies on the config-signature list covering all files
  that can change lint results; new lint configs must be added there.

## Risk tier / rollback
- Low: hook behavior only; authored edits in the repo were not touched.
- Rollback: `git -C ~/.codex/hooks diff` not under git; restore via backups
  or re-apply the two functions' prior bodies (see transcripts/session
  summary). For the repo docs, revert the two edited files from the working
  tree state.

## Follow-up: controller scheduling + advisory hook (same session)

Goal: implement the plan's section 14 scheduling and remove the remaining
stop-gate loop per user decision ("make the hook itself a warning").

Files changed:
- `scripts/quality-hardening/schedule.mjs`: rewritten - strict P0-P4 classes,
  Pareto dominance within a class (gate-distance L-infinity, hard findings,
  blast radius, measured success, verification cost, rollback clarity),
  deterministic 14.3 tie-break, effect-history frontier influence.
- `scripts/quality-hardening/queue.mjs`: gate_distance/hard_findings on task
  drafts, effects.jsonl read + schedule wiring, campaign head + state counts.
- `scripts/quality-hardening/cli.mjs`: effect records carry cluster_key and
  repair_class; Task typedef extended.
- `scripts/tests/quality-hardening/schedule.test.mjs`: 6 new tests.
- `~/.codex/hooks/stop_dispatch.py`: quality stop is advisory
  ("Quality advisory (non-blocking)" systemMessage); hard checks still block.
- `~/.codex/hooks/test_hooks.py`: updated advisory test; suite 40/40.
- Docs: architecture doc status, `docs/Log.md`, `docs/agent/known-errors.md`.

Verification: `node --test scripts/tests/quality-hardening/*.mjs` 17/17;
`npm run cli:typecheck` clean; `quality-hardening.mjs validate` and `summary`
against live ledger (173 tasks); hook suite 40/40.

Friction recorded: repo-pinned oxlint hangs >280s per file (tsgolint worker);
Edit tool cannot quote literal `<SM:FIND>` text - Python replacement used.

## Status
Hook tests green (40/40). Controller tests 17/17; scripts typecheck clean.
Branch WIP untouched beyond the controller files above.
