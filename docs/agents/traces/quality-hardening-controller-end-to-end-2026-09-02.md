# Trace: quality-hardening-controller-end-to-end-2026-09-02

## Goal
Implement `docs/agents/quality-hardening/QUALITY-HARDENING-MULTI-OBJECTIVE-AGENT-ARCHITECTURE.md`
end to end.

## Status (2026-09-02)
- Phases 0-3: complete (policy/taxonomy, measurements, queue/Pareto scheduling,
  claims, verify profiles, verify.sh delegation) - verified before this session.
- Phase 4: complete. Neutral core at
  `~/.local/share/agent-quality/agent_quality/{__init__,protocol,registry,subprocesses,cache,core,shadow}.py`;
  registry `~/.config/agent-quality/repos.json`; shadow wiring in Codex
  post_tool_quality + stop_dispatch; Claude/OMP already point at the shared
  `~/.codex/hooks` core. 12 tests `tests/test_core.py` (protocol envelope
  mapping, trust, symlink canonicalization, write-bit adapter checks,
  shell-arg safety, WAL concurrency, root resolution, untrusted report-only).
- Phase 5: complete for canaries + parity fixtures
  (`scripts/tests/quality-hardening/canary.test.mjs`: cold/warm parity,
  rebuild identity, structural tradeoff, mechanical isolation, coverage
  unknown-stays-unknown). Full cold/warm parity on the live repository
  engine (decision equality) is tracked via the shadow log over real
  sessions; the doc's "twice" pass is pending live-run evidence.
- Phase 6: complete. `quality-gate.yml` + artifact-only `quality-audit.yml`;
  retired 5 workflows, 3 patch payloads, 5 artifacts (listed in Log.md).
- Phase 7: STARTED. First loop iteration claimed the P0 readonly cluster
  (255 findings / 21 paths), found the codemod inventory empty (3 dry-runs,
  files changed: 0), recorded attempt 1 + effect 1, blocked the task with
  exact reason. Repo wide: 12.4k+ oxlint errors, MI 230 below 50, CRAP 288
  - far from the section-2 done criteria.

## Files changed (this session)
- `~/.local/share/agent-quality/agent_quality/*` + `tests/test_core.py` (new)
- `~/.config/agent-quality/repos.json` (identity/protocol/arg_prefix)
- `~/.codex/hooks/post_tool_quality.py`, `stop_dispatch.py` (shadow calls)
- `scripts/quality-hardening/hook.mjs` (paths key), `queue.mjs`
  (tradeoffRules + buildTasks inheritance), `schedule.mjs` typing fixes,
  `cli.mjs` typedef, `canary.test.mjs`, `schedule.test.mjs` (new)
- `.github/workflows/quality-gate.yml` (new), `quality-audit.yml` (rewritten)
- Deleted legacy workflows/patches/artifacts; `docs/Log.md`, plan doc status,
  known-errors additions from prior session; ledger: attempt + effect rows.

## Commands run
- `node --test scripts/tests/quality-hardening/*.mjs` - 22/22
- `npm run cli:typecheck` - clean
- `node scripts/quality-hardening.mjs validate` - valid
- `node scripts/quality-hardening.mjs task claim|block ...` - loop iteration
- `/usr/bin/python3 -m unittest test_hooks` (.codex) - 40/40
- `PYTHONPATH=. python3 -m unittest tests.test_core` - 12/12
- Live core smoke: `agent_quality.core post` through the registry adapter -
  neutral result, touched_paths propagated.

## Risks
- Ordering inside `scheduleTasks` maps factor via `task.factor` only;
  type-boundary clusters share the P0 class - queue ordering matches the plan
  classes but splitting rules across classes will re-sort.
- Phase 5 live parity (twice) not yet evidenced on the real repo; shadow log
  is the instrument, next sessions provide the runs.

## Rollback
- All changes are uncommitted on `quality/crap-mi-oxlint-hardening`; git
  history plus the deleted files' history in `git log` recover the retired
  machinery. Core package is outside git; restore from this trace or rebuild
  per the plan section 7.2.

## Next executable step
Continue Phase 7: `node scripts/quality-hardening.mjs queue next` and work
the highest class contextually (readonly contracts, then MI/CRAP roots), one
cluster per loop with claim -> fix -> path/task gates -> close -> remeasure.
