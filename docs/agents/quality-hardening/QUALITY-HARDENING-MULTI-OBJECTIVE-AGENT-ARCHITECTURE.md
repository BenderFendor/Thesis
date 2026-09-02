# Quality Hardening Controller: Architecture and Implementation Plan

## Document status

This is the canonical implementation plan for the Thesis quality-hardening
controller and its shared agent-hook integration.

- Plan state: approved for implementation.
- Implementation state 2026-09-02:
  - Phases 1-3 implemented: canonical policy + taxonomy with validation,
    normalized measurements with provenance (SQLite cache, path/content/
    config-version keys), rule-grouped queue with structural/mechanical/
    coverage clusters, writer claims with scope expansion, path/task/changed/
    repo verification profiles, non-mutating `verify.sh` delegation, campaign/
    tasks/attempts/effects ledgers.
  - Section 14 scheduling implemented (Pareto frontier, gate-distance L-infinity
    deficit, deterministic tie-break, effect-history influence within a class).
  - Phase 3 hook integration: the shared `~/.codex/hooks` core runs one
    ordered Stop coordinator; per-file quality results are ADVISORY
    (2026-09-02 user decision) - metric/lint deltas never block, compile/lint/
    type/conflict Stop checks still do. Post-edit lint memoization is per-file
    content + config-version keyed.
  - Phase 4 implemented (2026-09-02): harness-neutral core at
    `~/.local/share/agent-quality/agent_quality/` (protocol, registry trust
    with realpath/identity/ownership checks, safe subprocess adapter
    invocation, WAL SQLite cache with the section-11 tables), registry at
    `~/.config/agent-quality/repos.json`, Codex/Claude/OMP quality events
    point at the shared core, shadow comparisons record mismatches
    (`~/.cache/agent-quality/shadow-mismatches.jsonl`). 12 core tests.
  - Phase 5 canaries implemented and passing: cold/warm task-order parity,
    structural tradeoff declaration, mechanical isolation, unknown-coverage
    no-fabricated-CRAP (`scripts/tests/quality-hardening/canary.test.mjs`).
  - Phase 6 implemented: `.github/workflows/quality-gate.yml` (hard gate,
    no continue-on-error, no commit/push) and artifact-only
    `quality-audit.yml`; legacy workflows, patch payloads, and superseded
    artifacts removed (section 22 lists dates).
  - Open: Phase 7 repository cleanup campaign (active).
- Observed branch: `quality/crap-mi-oxlint-hardening`.
- Observed commit: `16c3a14` (uncommitted controller work on top).
- Baseline date: 2026-09-01.
- Scope: the Thesis repository plus the user-level quality hook shared by
  Codex, Claude Code, and Oh My Pi.

The baseline numbers in this document are a planning snapshot. Re-run the
measurements before implementation if the branch head or worktree changes.
Do not treat a listed path as implemented until it exists in the worktree.

## 1. Outcome

Build one closed-loop quality controller that:

1. Measures the repository through named, versioned analyzers.
2. Maps related findings to root-cause clusters instead of making one task per
   metric or lint line.
3. Gives one session exclusive write ownership while allowing read-only
   analysis to run in parallel.
4. Lets a structural repair make a bounded intermediate tradeoff inside its
   claimed cluster without weakening final gates.
5. Uses the same trusted repository adapter from Codex, Claude Code, and Oh My
   Pi.
6. Keeps compact campaign state in Git and raw analyzer output outside Git.
7. Replaces conflicting scripts and workflows with one policy and one
   verification path.
8. Drives the repository to all final quality gates, tests, type checks, and
   builds passing.

The controller optimizes code behavior and maintainability. Metrics are
evidence and gates. They are not independent goals and are not combined into a
single invented quality score.

## 2. Done criteria

The work is complete only when all of the following are true:

- `node scripts/quality-hardening.mjs verify --scope repo` passes.
- `./verify.sh` delegates to the same repo verification profile and does not
  modify tracked source files.
- Oxlint reports 0 errors and 0 warnings.
- CCCC reports 0 methods above cyclomatic 10 or cognitive 15.
- Every measured function has Maintainability Index at least 60.
- Every function with usable coverage has CRAP at most 8. The scheduling target
  is 6.
- Functions without usable coverage have an explicit `unknown` coverage and
  CRAP state. They are never assigned a fabricated CRAP value.
- Import resolution, cycle, dead-export, duplicate-export, unused-dependency,
  duplication, type, schema, test, build, Python, and Rust gates pass.
- No threshold, lint rule, analyzer scope, exclusion, or warning level was
  weakened to obtain a pass.
- No new `oxlint-disable`, `eslint-disable`, `noqa`, or `#[allow]`
  suppression was added to avoid a finding.
- Codex, Claude Code, and Oh My Pi call the same hook core.
- Other repositories use a safe generic hook path unless they are present in
  the trusted adapter registry.
- Cold-cache and warm-cache parity checks pass twice.
- Structural, mechanical, and coverage canaries pass.
- Obsolete quality workflows, patch payloads, generated inventories, and
  superseded handoffs are removed after parity is proven.
- The final repository verification leaves the tracked worktree unchanged.

Setup, a partial queue, a passing changed-file check, or a report-only workflow
does not meet these criteria.

## 3. Current system

### 3.1 Repository gates

The current repository has useful analyzers, but policy and orchestration are
split across scripts and workflows.

| Concern | Current source | Current behavior |
|---|---|---|
| Owned frontend files | `scripts/quality-source-files.mjs` | Defines first-party frontend scope and exclusions |
| Cyclomatic and cognitive complexity | `scripts/check-complexity`, `cccc.toml` | Fails above cyclomatic 10 or cognitive 15 |
| Maintainability Index | `scripts/check-maintainability.mjs` | Hard failure below 50, warning below 60 |
| CRAP | `scripts/check-crap.mjs` | Uses complexity and coverage when coverage can be mapped |
| Oxlint | `.oxlintrc.json`, `frontend/package.json` | Type-aware lint with repository plugins and 0-warning intent |
| Duplication | `.jscpd.json` | Fails above 3 percent |
| Imports | `scripts/check-imports.mjs` | Checks owned frontend imports |
| Cycles | `scripts/check-cycles` | Checks dependency cycles |
| Dead code | frontend dead-code command | Reports unused and duplicate exports and dependencies |
| Full verification | `verify.sh` | Runs frontend, CLI, backend, Rust, tests, and quality checks |
| Aggregate quality | root `package.json` `quality:all` | Runs cycles, duplication, MI, CCCC, dead code, and CRAP |

`verify.sh` now delegates to the repository controller's `repo` verification
profile. The profile uses Ruff formatting with `--check` and records tracked
worktree state before and after verification. Full repository verification is
still expected to fail until the cleanup campaign closes its reported debt.

`scripts/check-complexity` now accepts the controller's JSON/report/path
arguments and returns a normalized CCCC result without changing source. The
controller still owns the output contract and calls analyzers through explicit
adapters.

### 3.2 Planning baseline

The following values were measured or taken from the latest branch handoff
during the 2026-09-01 planning audit:

| Signal | Snapshot |
|---|---:|
| Owned frontend imports | 200 files, all aliases resolved |
| CCCC | 0 hard violations across 10,236 functions |
| Maintainability Index | 3,896 functions; 230 below 50; 499 from 50 through 59 |
| Oxlint | 13,056 errors; 338 warnings |
| CRAP, last recorded usable report | 51 of 2,630 measured methods above 30; maximum 110; 1,408 methods without mapped coverage |
| Dead-code report | 105 unused exports; 3 duplicate exports; 1 unused development dependency; 11 hints |
| Duplication | 1.10 percent of lines and 1.14 percent of tokens |

The lowest recorded MI functions were:

| Function or component | MI | Analyzer cyclomatic |
|---|---:|---:|
| `InteractiveGlobe` | 12.8 | 56 |
| `useReadingQueueController` | 16.7 | 35 |
| `NewsPage` | 17.7 | 37 |
| `ArticleDetailModalContent` | 18.2 | 5 |
| `BlindspotView` | 19.3 | 21 |

These cyclomatic values came from `code-multivitals`. CCCC reported
`InteractiveGlobe` at cyclomatic 6. The controller must retain the analyzer
name on every metric. It must never display analyzer-specific values as though
they were interchangeable.

The most common Oxlint rules in the snapshot were:

| Rule | Findings |
|---|---:|
| `typescript/prefer-readonly-parameter-types` | 2,545 |
| `no-magic-numbers` | 1,504 |
| `react/jsx-max-depth` | 1,115 |
| `sort-vars` | 1,114 |
| `no-ternary` | 763 |
| `func-style` | 696 |
| `strict-boolean-expressions` | 570 |
| `one-var` | 518 |
| `no-null` | 406 |
| `react/function-component-definition` | 324 |

The snapshot is evidence for queue design. It is not an accepted baseline that
permits those findings to remain at campaign completion.

### 3.3 Shared hook installation

The machine currently uses:

- `~/.codex/hooks/quality_metrics.py` as the quality metric engine.
- Codex wrappers under `~/.codex/hooks/`.
- Duplicated Claude wrappers under `~/.claude/hooks/`.
- `~/.omp/agent/extensions/post-tool-quality.ts` for Oh My Pi.
- JSON state under `~/.cache/omp-quality/`.

Codex and Claude currently register separate commands for quality baseline,
pre-tool quality, post-tool lint, post-tool quality, stop dispatch, and stop
quality. Codex runs handlers registered for the same event concurrently. The
current Stop event therefore has no defined ordering between the general stop
dispatcher and the quality stop hook.

## 4. Contradictions to remove

Implementation must resolve these conflicts before trusting the controller:

1. `quality_metrics.py` labels `CC squared plus CC` as CRAP even when no
   coverage exists. Actual CRAP requires coverage.
2. The global hook uses MI 60 as a direct per-file goal while the repo gate
   fails below 50 and warns below 60.
3. ~~The stop hook rejects any per-file metric increase. A structural repair can
   validly reduce complexity while creating temporary mechanical lint inside
   the same cluster.~~ RESOLVED 2026-09-02: `fmt_stop` now blocks only on
   floor-crossing regressions (MI drops below the cluster floor 50, CC/cog
   cross above 10/15, or a below-floor file gets worse). Deltas that stay
   inside a floor (MI 52 -> 50.5, CC 6 -> 9) never block, matching the policy
   that the floor is the per-turn bound and final goals (MI 60, CRAP 8) bind
   only at cluster close and repo finish. Lint-error increases still block
   unless a claimed structural task allows the rule for the path
   (`allows_structural_lint_tradeoff`). Tests: `StopQualitySemanticsTests` in
   `~/.codex/hooks/test_hooks.py`.
4. Hook records keep maxima, minima, and aggregate lint counts but lose factor,
   rule, source-unit, coverage, and root-cause information.
5. The JSON cache is keyed mainly by content hash. It omits path-sensitive
   configuration, tool version, policy version, and analyzer version.
6. Concurrent hook processes can replace the same JSON cache without a
   transactional lock.
7. Git blob SHA-1 values and content SHA-256 values are compared as if they used
   the same hash function.
8. A clean-HEAD fallback analyzes a temporary path, which can bypass path-based
   lint overrides.
9. Lint state is compared as an `(errors, warnings)` tuple. That
   lexicographic comparison can hide an increase in warnings when errors fall.
10. The Python MI path expects Radon even though it is not available in the
    observed environment, and its result shape is not covered by hook tests.
11. ~~Post-tool lint can re-lint every turn-changed file after each edit and can
    repeat expensive type checks.~~ RESOLVED 2026-09-02: `lint_changed_files`
    now memoizes python-lint and js/ts-lint results per file, keyed on file
    content + lint configuration signature (`.oxlintrc.json`, package/tsconfig
    manifests, pyproject/ruff configs) via the SQLite analysis cache
    (`~/.cache/omp-quality/state.sqlite3`). Repeated edits re-run only the
    files whose bytes changed; typechecks (pyright/tsc/cargo) remain grouped
    project checks. Tests: `LintCacheTests` in `~/.codex/hooks/test_hooks.py`.
12. Hook tests cover general dispatch behavior but do not cover the metric
    engine, cache provenance, quality baseline, or quality Stop decision.
13. `verify.sh` changes Python files while it verifies them.
14. CI workflows duplicate thresholds, use branch-specific scopes, tolerate
    failures with `continue-on-error`, generate commits, or apply stored
    patches.
15. Large generated inventories are tracked as planning state even though they
    become stale after structural edits.

## 5. Fixed decisions

These decisions are settled for the implementation:

| Topic | Decision |
|---|---|
| Hook ownership | One harness-neutral user-level core with thin Codex, Claude Code, and Oh My Pi wrappers |
| Repository integration | A trusted Thesis adapter invokes the repository controller |
| Other repositories | Generic report-only fallback unless registered as trusted |
| Mutation model | One mutable checkout and one active writer claim |
| Parallel work | Read-only analyzers and verifiers may run concurrently |
| Scheduling | Priority class, then Pareto dominance, then measured leverage and deterministic tie-breaks |
| Intermediate acceptance | Cluster-aware; only declared tradeoffs inside an active structural cluster |
| Final acceptance | Every final gate passes with no tradeoff |
| MI | 50 is the active structural-cluster floor; 60 is required to close a cluster and finish the repo |
| CRAP | 30 is the legacy observation line; changed and final measured methods must be at most 8; target is 6 |
| Unknown coverage | Stored separately; never converted to a CRAP number |
| Lint | 0 errors and 0 warnings at task closure for the affected scope and at repo completion |
| CCCC | Cyclomatic at most 10 and cognitive at most 15 |
| Duplication | At most 3 percent |
| State | Compact tracked ledger; raw measurements and caches ignored |
| CI | One hard gate and one manual or scheduled artifact-only audit |
| Retirement | Remove legacy branch machinery after two parity runs and three canaries |
| Dependencies | Reuse Node, Python standard library, SQLite, and installed analyzers; add no service |

Do not replace these decisions with environment-variable-only policy or
workflow-local copies.

## 6. Source-of-truth model

### 6.1 Canonical policy

Add `quality-hardening.config.json` at the repository root. It owns:

- schema and policy version;
- owned source roots and exclusions;
- analyzer names and commands;
- threshold semantics;
- verification profiles;
- task and cluster policy;
- allowed intermediate tradeoffs;
- ledger and raw-artifact locations;
- trusted adapter protocol version.

Existing analyzer configs remain authoritative for analyzer-native settings:

- `.oxlintrc.json` owns Oxlint rules and overrides.
- `cccc.toml` owns CCCC exclusions and native configuration.
- `.jscpd.json` owns jscpd matching configuration.
- TypeScript, Jest, Ruff, MyPy, Cargo, and package manifests own their native
  settings.

The controller reads those files and includes their hashes in measurement
provenance. It must not duplicate full rule sets into the controller policy.

### 6.2 Rule taxonomy

Add `quality-hardening.rules.json` at the repository root. Each known Oxlint
rule has:

- exact rule ID;
- quality factor;
- repair class;
- default cluster key;
- whether a deterministic fix can be attempted;
- required verification profiles;
- whether a structural task may temporarily create the finding;
- notes for known unsafe transformations.

Quality factors are:

- `correctness`;
- `type_integrity`;
- `structural_maintainability`;
- `architecture_api`;
- `testing`;
- `mechanical_convention`.

Repair classes are:

- `structural`;
- `coverage`;
- `mechanical_safe`;
- `mechanical_contextual`.

`queue rebuild` inventories all emitted rules and all explicitly enabled
rules that the installed Oxlint version exposes. It exits nonzero if any rule
has no taxonomy entry. An unknown rule must not silently fall into
`mechanical_convention`.

### 6.3 No second policy

Workflows, package scripts, hooks, and documentation may call the controller.
They may not carry independent thresholds. Analyzer-native config is allowed
only where the analyzer requires it.

## 7. Planned files

### 7.1 Repository

Create:

```text
quality-hardening.config.json
quality-hardening.rules.json
scripts/quality-hardening.mjs
scripts/quality-hardening/
  adapters/
    cccc.mjs
    code-multivitals.mjs
    crap.mjs
    deadcode.mjs
    jscpd.mjs
    oxlint.mjs
    verifier.mjs
  cache-key.mjs
  cli.mjs
  cluster.mjs
  config.mjs
  ledger.mjs
  measure.mjs
  protocol.mjs
  queue.mjs
  schedule.mjs
  source-units.mjs
  writer-claim.mjs
scripts/tests/quality-hardening/
docs/agents/quality-hardening/ledger/
  campaign.json
  tasks.jsonl
  attempts.jsonl
  effects.jsonl
```

The exact module split may shrink during implementation if adjacent modules do
not need separate state. The public CLI, schemas, and ownership boundaries are
fixed.

Add `.quality-hardening/` to `.gitignore`. Store these untracked items
there:

```text
.quality-hardening/
  locks/
  measurements/
  reports/
  tmp/
```

Do not commit raw Oxlint JSON, full per-function analyzer dumps, build output,
or caches.

### 7.2 Shared user-level hook core

Create:

```text
~/.local/share/agent-quality/
  agent_quality/
    __init__.py
    cache.py
    core.py
    protocol.py
    registry.py
    subprocesses.py
~/.config/agent-quality/repos.json
~/.cache/agent-quality/metrics.sqlite3
```

The existing Codex and Claude files become thin event-envelope adapters. The
Oh My Pi extension maps its event object to the same neutral request and maps
the neutral result back to its API.

Do not create a repository-local `.claude/` directory.

## 8. Runtime architecture

```text
Codex event       Claude event       Oh My Pi event
     |                 |                  |
     +------- thin harness adapters ------+
                       |
                       v
            shared user-level hook core
              |                    |
              | untrusted repo     | trusted repo
              v                    v
       generic report-only     fixed adapter registry
                                    |
                                    v
                     Thesis quality-hardening CLI
                       |       |        |
                       v       v        v
                  measurement queue verification
                       |       |        |
                       +--- compact ledger
```

The user-level core owns:

- harness payload parsing;
- trust lookup;
- event ordering;
- cache access;
- timeouts;
- safe subprocess execution;
- neutral decisions;
- harness response mapping.

The repository controller owns:

- source scope;
- analyzer commands;
- policy;
- metric normalization;
- taxonomy;
- clusters;
- task state;
- writer claims;
- verification profiles.

The shared core must not interpret Thesis-specific metrics.

## 9. Trust and subprocess rules

`~/.config/agent-quality/repos.json` maps a canonical repository realpath to:

- adapter protocol version;
- fixed executable path;
- fixed argument prefix;
- expected repository identity;
- optional policy-file hash pin.

Before invoking an adapter, the core:

1. Resolves the current working directory and repository root to realpaths.
2. Requires an exact registry match.
3. Confirms that the adapter and policy are regular files owned by the current
   user.
4. Rejects group-writable or world-writable adapter files.
5. Uses an argument array with `shell=false`.
6. Sends the event request on standard input.
7. enforces an event-specific timeout and output-size limit.
8. Treats invalid JSON, protocol mismatch, or timeout as a hook failure record.

An unregistered repository may receive generic diagnostics from installed
tools. It cannot provide commands for the core to execute and cannot block a
session through a repository adapter.

## 10. Neutral hook protocol

### 10.1 Request

The shared core normalizes harness events to:

```json
{
  "protocol": 1,
  "harness": "codex",
  "event": "post",
  "session_id": "opaque",
  "turn_id": "opaque",
  "cwd": "/absolute/path",
  "tool": {
    "name": "apply_patch",
    "input": {},
    "result": {}
  },
  "stop_hook_active": false
}
```

Tool input and result fields are filtered to the path and status data needed by
the adapter. Secrets, full file contents, and unrelated command output are not
stored.

### 10.2 Result

The repository adapter returns:

```json
{
  "protocol": 1,
  "decision": "allow",
  "severity": "advisory",
  "message": "quality: frontend/example.tsx lint 2e/0w",
  "reason_code": "task_scope_passed",
  "touched_paths": ["frontend/example.tsx"],
  "evidence_refs": [".quality-hardening/reports/turn-id.json"]
}
```

`decision` is `allow` or `block`. The wrapper alone translates that result
to the documented Codex, Claude Code, or Oh My Pi response envelope.

### 10.3 Event behavior

#### User prompt submit

- Resolve the repository and trust mode.
- Record content hashes for dirty files.
- Record the active task and writer owner.
- Do not run full analyzers.

#### Pre tool

- Resolve the target path from a recognized edit or write operation.
- Analyze the current file through the repository adapter if no valid cached
  record exists.
- Report the active task, thresholds, worst local source units, and relevant
  findings.
- Deny a write when another live session owns the repository writer claim.
- Remain advisory for untrusted repositories.

#### Post tool

- Inspect only paths touched by the completed tool call.
- Reuse results by provenance-aware cache key.
- Run the smallest relevant path-level checks.
- Record a compact before-and-after effect.
- Do not re-run every file changed earlier in the turn.

#### Stop

- Use one ordered quality coordinator.
- Determine all turn-touched paths once.
- Evaluate writer ownership, task scope, changed-file checks, cluster policy,
  and stop-loop state in a fixed sequence.
- Return one quality decision and one concise message.
- Preserve the harness stop-loop guard.

For Codex, fold quality Stop handling into
`~/.codex/hooks/stop_dispatch.py` and remove the standalone
`stop_quality.py` registration after parity. Do the equivalent in the Claude
wrapper. This removes reliance on ordering between concurrent same-event
commands.

## 11. Cache design

Replace `~/.cache/omp-quality/state.json` with SQLite in WAL mode.

Minimum tables:

- `analysis`: normalized analyzer result by provenance key;
- `turn`: repository, session, turn, start time, and active claim;
- `turn_file`: start hash, current hash, baseline analysis key, and touched
  state;
- `hook_failure`: bounded failure fingerprint and last occurrence;
- `schema_meta`: database and protocol versions.

An analysis cache key includes:

- repository realpath;
- repository-relative path;
- content SHA-256;
- analyzer name and version;
- controller policy hash;
- relevant native config hashes;
- source-scope version;
- adapter protocol version.

SQLite writes use transactions, a busy timeout, and WAL. Cache entries are
immutable. Retention removes least-recently-used rows only after they are not
referenced by an active turn.

Use SHA-256 for content everywhere. Store Git object IDs in a separate field
with their algorithm name.

Do not analyze a Git baseline through a path that changes lint override
semantics. If no path-correct pre-edit or turn-start measurement exists, record
the baseline as unknown. Current-state hard checks still run.

## 12. Measurement model

### 12.1 Record envelope

Each measurement record contains:

```json
{
  "schema_version": 1,
  "policy_version": "1",
  "repository": {
    "root": "/home/bender/classwork/Thesis",
    "head": "full-commit-id",
    "worktree_fingerprint": "sha256"
  },
  "tools": {
    "oxlint": {"version": "resolved", "config_sha256": "resolved"},
    "cccc": {"version": "1.6.0", "config_sha256": "resolved"}
  },
  "scope": {
    "kind": "task",
    "paths": ["frontend/example.tsx"]
  },
  "units": [],
  "lint": {
    "errors": 0,
    "warnings": 0,
    "by_factor": {},
    "by_rule": {}
  },
  "verification": []
}
```

### 12.2 Source-unit identity

A source unit is a function, method, component, hook, module initializer, or
file-level unit emitted by an analyzer.

Its stable ID is derived from:

- language;
- repository-relative path;
- symbol kind;
- AST-qualified symbol path;
- normalized declaration signature hash when needed to distinguish anonymous
  or repeated units.

Line numbers and byte offsets are locations, not identity. If a symbol moves to
another file or changes identity, queue rebuild marks the old task stale and
creates a new source unit.

### 12.3 Namespaced metrics

Store metrics under their analyzer:

```json
{
  "unit_id": "qh-unit:...",
  "path": "frontend/example.tsx",
  "symbol": "InteractiveGlobe",
  "location": {"line": 120, "column": 1},
  "metrics": {
    "cccc": {"cyclomatic": 6, "cognitive": 9},
    "code_multivitals": {"cyclomatic": 56, "mi": 12.8},
    "crap_typescript": {
      "coverage_state": "measured",
      "coverage_percent": 42.0,
      "crap": 110.0
    }
  }
}
```

Never merge `cccc.cyclomatic` and
`code_multivitals.cyclomatic` into one field.

### 12.4 CRAP

For a measured method:

```text
CRAP = CC^2 * (1 - coverage_fraction)^3 + CC
```

Coverage states are:

- `measured`;
- `unmapped`;
- `not_collected`;
- `analyzer_error`.

Only `measured` has a numeric CRAP value. The other states use `null`.
Coverage improvement must come from tests that execute behavior and contain
meaningful assertions.

## 13. Root-cause clusters

### 13.1 Structural clusters

A structural cluster is anchored to a source unit or cohesive module when
complexity, MI, CRAP, nesting, long-function, JSX-depth, conditional, or
related findings describe the same design problem.

The cluster absorbs findings inside its source span when the rule taxonomy says
the finding is structurally related. It may also include tightly coupled helper
units when a dependency edge and shared responsibility are recorded.

### 13.2 Mechanical clusters

Mechanical findings are grouped by:

- exact rule;
- syntax shape;
- directory and active override;
- candidate transform;
- required verifier profile.

Examples include import ordering, variable ordering, component declaration
form, safe readonly annotations, and named constants. A cluster may be promoted
to a codemod only after representative positive and negative fixtures pass and
the transform is idempotent.

### 13.3 Type-boundary clusters

Type findings that cross modules are grouped around the shared API, schema, or
domain symbol. They are not split into isolated call-site tasks when the root
cause is one weak boundary type.

### 13.4 Cluster invalidation

A cluster has an input fingerprint made from:

- policy and taxonomy versions;
- source-unit IDs;
- member diagnostic fingerprints;
- dependency edges;
- relevant analyzer versions.

`queue rebuild` marks an open task `stale` when that fingerprint changes. It
does not silently carry an old task over a structural rewrite.

## 14. Scheduling

Scheduling uses no weighted quality sum.

### 14.1 Priority classes

1. **P0:** compiler, build, test, schema, correctness, safety, and type-integrity
   failures.
2. **P1:** structural units below hard thresholds and measured CRAP above 30.
3. **P2:** architecture, cycles, dead exports, duplicate exports, and shared
   type-boundary debt.
4. **P3:** proven mechanical clusters with deterministic transforms.
5. **P4:** contextual mechanical tail and low-risk coverage gaps.

### 14.2 Pareto selection

Within the highest nonempty priority class, retain non-dominated tasks across:

- gate distance;
- user-facing and dependency reach;
- number of findings explained by the root cause;
- measured repair success for the same transformation;
- expected verification cost;
- blast radius;
- rollback clarity.

A task is dominated when another available task is no worse on every selected
dimension and better on at least one.

### 14.3 Deterministic tie-break

Choose among the Pareto frontier by:

1. higher count of explained hard findings;
2. higher prior success rate for the repair pattern;
3. lower measured verification cost;
4. smaller declared write scope;
5. lexical task ID.

Historical effects inform selection. They do not relax a hard gate.

## 15. Task and ledger model

### 15.1 Task states

Valid states are:

- `queued`;
- `claimed`;
- `in_progress`;
- `verifying`;
- `accepted`;
- `blocked`;
- `stale`.

Only the controller changes task state.

### 15.2 Task record

`tasks.jsonl` contains one current, deterministically sorted record per task:

```json
{
  "task_id": "qh:structural:...",
  "state": "queued",
  "priority": "P1",
  "repair_class": "structural",
  "cluster_fingerprint": "sha256",
  "scope": ["frontend/example.tsx"],
  "unit_ids": ["qh-unit:..."],
  "factors": ["structural_maintainability"],
  "gates": ["mi-final", "cccc", "lint"],
  "created_from": "measurement-id",
  "blocked_reason": null
}
```

Do not store full analyzer output in a task row.

### 15.3 Attempt record

`attempts.jsonl` stores one compact row per completed attempt:

```json
{
  "attempt_id": "qh-attempt:...",
  "task_id": "qh:structural:...",
  "started_at": "ISO-8601",
  "ended_at": "ISO-8601",
  "session_id_hash": "sha256",
  "paths": ["frontend/example.tsx"],
  "before_measurement": "measurement-id",
  "after_measurement": "measurement-id",
  "outcome": "accepted",
  "verifiers": [{"profile": "task", "status": "passed"}],
  "failure_fingerprint": null
}
```

### 15.4 Effect record

`effects.jsonl` stores bounded transformation results:

- repair-pattern ID;
- repair class;
- factor deltas;
- gate outcome;
- files and source units affected;
- verification duration;
- success or failure fingerprint;
- whether rollback was required.

This history supports later scheduling and codemod promotion. It is not a
general session transcript.

### 15.5 Campaign record

`campaign.json` stores:

- schema and policy version;
- branch and base commit;
- current phase;
- final thresholds;
- latest accepted repository measurement ID;
- active task ID;
- counts by task state;
- parity and canary results;
- retirement readiness.

Git history provides ledger history. Raw reports remain ignored.

## 16. Single-writer ownership

One live session may own a write claim for the repository.

A claim contains:

- repository realpath;
- task ID;
- allowed path scope;
- harness and hashed session ID;
- process and host identity;
- acquisition and heartbeat times;
- policy version.

The live lock is stored under `.quality-hardening/locks/` and acquired
atomically. The tracked campaign record stores only the active task ID and
hashed owner identity.

Rules:

1. `task claim` acquires the writer lock before setting the task to
   `claimed`.
2. Pre-tool hooks block writes from a different session while the claim is
   live.
3. Writes outside the claimed path scope require
   `task expand-scope <task> <path>`, which records the reason.
4. Read-only measurement and verification may run in parallel.
5. A stale lock is not reclaimed from age alone. The controller checks process
   liveness and session state, then requires an explicit `task release
   --stale`.
6. Release, close, and block operations clear the live lock transactionally.

This plan does not use multiple writable worktrees or agent swarms for the
cleanup campaign.

## 17. Cluster-aware acceptance

### 17.1 No active structural task

Touched files must not worsen any hard factor. Errors and warnings are compared
independently. Unknown analyzer state cannot be presented as a pass.

### 17.2 Active structural task

An intermediate attempt may be accepted while its parent cluster remains open
only when:

- compiler, type, build, test, correctness, safety, schema, and architecture
  gates do not regress;
- every changed structural unit remains at MI 50 or higher;
- CCCC hard thresholds pass in the affected scope;
- any new lint finding is inside the claimed cluster;
- the taxonomy permits that rule as an intermediate structural tradeoff;
- each new finding becomes a child task before the attempt is accepted;
- total unexplained debt does not increase;
- the affected behavior has characterization coverage when risk requires it.

This permits a sound structural split to create temporary import-order or
declaration-style work. It does not permit new correctness or type debt.

### 17.3 Mechanical or coverage task

A mechanical task must close its assigned findings without worsening
complexity, MI, measured CRAP, types, tests, architecture, or other lint
factors.

A coverage task may lower CRAP through real behavioral coverage, but it does
not close a separate structural task when complexity or MI still fails.

### 17.4 Cluster closure

A structural cluster closes only when:

- all affected units have MI at least 60;
- CCCC thresholds pass;
- every changed or created measured method has CRAP at most 8;
- affected-scope lint has 0 errors and 0 warnings;
- all child tasks are accepted or invalidated by remeasurement;
- required behavioral tests pass;
- no complexity was merely moved to a new untracked helper.

The repo closes only under the stricter final criteria in section 2.

## 18. Public CLI

The user-facing command is:

```bash
node scripts/quality-hardening.mjs <command>
```

Commands:

```text
measure --scope repo|changed|task [--task TASK_ID] [--json]
queue rebuild [--from MEASUREMENT_ID]
queue next [--json]
queue inspect TASK_ID [--json]
task claim TASK_ID
task expand-scope TASK_ID PATH --reason TEXT
task release TASK_ID
task release TASK_ID --stale
task close TASK_ID
task block TASK_ID --reason TEXT
verify --scope task|changed|repo [--task TASK_ID] [--json]
summary [--json]
hook pre|post|stop --payload -
```

Exit codes:

| Code | Meaning |
|---:|---|
| 0 | Command completed and requested gates passed |
| 1 | A quality or verification gate failed |
| 2 | Configuration, taxonomy, protocol, or command usage is invalid |
| 3 | Writer claim conflict or invalid task transition |
| 4 | Analyzer unavailable, timed out, or returned unparseable output |

`--json` writes one JSON object to standard output. Human diagnostics go to
standard error. Hook mode always writes the neutral hook result to standard
output.

## 19. Verification profiles

### 19.1 Path profile

Used after a tool changes a file:

- path-specific Oxlint or Ruff;
- parser or type syntax check when cheap;
- affected per-file metrics;
- relevant custom structural checks.

### 19.2 Task profile

Used before closing an attempt:

- all claimed paths;
- affected tests;
- affected TypeScript project or Python module;
- affected analyzer metrics;
- task factor gates;
- generated child-task check.

### 19.3 Changed profile

Used before a session stops:

- all turn-touched paths;
- repository import and cycle checks when relevant;
- frontend type check for TypeScript changes;
- backend MyPy for Python contract changes;
- relevant tests;
- cluster-aware gate evaluation.

### 19.4 Repository profile

The repository profile runs:

- frontend TypeScript with incremental output disabled;
- frontend import checks;
- frontend production build;
- Oxlint with 0 warnings;
- cycles;
- duplication;
- MI in final mode;
- CCCC;
- dead and duplicate exports and unused dependencies;
- CRAP and coverage-state audit;
- CLI type check, tests, and schema parity;
- backend strict MyPy;
- Ruff check;
- Ruff format with `--check`;
- Rust Clippy with warnings denied;
- Rust format with `--check`;
- native Rust extension build or install needed by backend tests;
- frontend tests and custom Oxlint-rule tests;
- backend non-slow tests;
- any repository regression workflow checks that are not already in those
  suites.

The profile records the Git status before and after. Generated build artifacts
may change only in ignored locations. A tracked worktree change fails the
verification.

Refactor `verify.sh` to call this profile. Remove Ruff `--fix`, replace Ruff
formatting with `--check`, and remove manual native-library copying when the
normal build/install command provides the module.

## 20. CI design

### 20.1 Hard gate

Create one required `.github/workflows/quality-gate.yml` that:

- installs pinned dependencies from tracked manifests and lockfiles;
- runs `node scripts/quality-hardening.mjs verify --scope repo`;
- fails on any final gate;
- uploads bounded logs on failure;
- never uses `continue-on-error` for a required check;
- never edits, commits, or pushes repository files.

### 20.2 Advisory audit

Keep one `.github/workflows/quality-audit.yml` for manual or scheduled use.
It:

- runs a repository measurement;
- emits the compact summary and raw artifact bundle;
- uploads artifacts with finite retention;
- does not change task state;
- does not commit generated reports;
- does not hide analyzer failure.

No other workflow owns quality thresholds.

## 21. Migration phases

### Phase 0: freeze and remeasure

1. Confirm branch, head, and clean or intentionally dirty paths.
2. Run the current analyzers without changing source.
3. Save raw output under `.quality-hardening/measurements/`.
4. Record tool versions, config hashes, commands, durations, and exit codes.
5. Compare the new results with the snapshot in this document.
6. Update only the compact campaign record.

Exit: current measurements are reproducible and every unavailable analyzer is
recorded as an error or explicit unknown.

### Phase 1: policy and normalized measurement

1. Add the canonical policy and rule taxonomy schemas.
2. Implement config validation.
3. Wrap existing analyzers without changing thresholds.
4. Implement stable source units and namespaced metrics.
5. Correct CRAP handling so coverage is required.
6. Add parser regression tests for every analyzer.
7. Add provenance-aware raw measurement IDs.

Exit: `measure --scope repo --json` produces one schema-valid record and
repeated runs on unchanged input are equal apart from declared timestamps and
durations.

### Phase 2: clustering, queue, and ledger

1. Implement taxonomy completeness checks.
2. Build structural, mechanical, and type-boundary clusters.
3. Implement stable task IDs and invalidation.
4. Implement priority, Pareto filtering, and tie-breaks.
5. Implement the compact ledger.
6. Add fixtures for overlapping MI, CCCC, CRAP, and lint findings.

Exit: queue rebuild explains every actionable finding exactly once as a root
task or child member, with no unknown lint rule.

### Phase 3: writer and verification controller

1. Implement claim acquisition and path scope.
2. Implement valid task transitions.
3. Implement path, task, changed, and repo verification profiles.
4. Make `verify.sh` non-mutating and delegate to the repo profile.
5. Route `quality:all` through the controller without creating a dependency
   cycle.
6. Add worktree-mutation and concurrent-claim tests.

Exit: a second session cannot write while a live claim exists, and the repo
profile cannot change tracked files.

### Phase 4: shared hook core in shadow mode

1. Add the harness-neutral Python core and SQLite cache.
2. Add the trusted Thesis registry entry.
3. Convert Codex, Claude Code, and Oh My Pi wrappers to the neutral protocol.
4. Leave old quality decisions authoritative during shadow comparison.
5. Record decision mismatches without blocking on the new path.
6. Add tests for payload parsing, path trust, cache keys, concurrency, timeouts,
   output limits, and decision mapping.

Exit: every supported event has a bounded neutral result and untrusted
repositories cannot execute an adapter.

### Phase 5: parity, canaries, and cutover

Run two full parity passes on an unchanged fixture and the Thesis repository:

1. cold SQLite cache;
2. warm SQLite cache.

Both passes compare:

- touched-path discovery;
- before and after hashes;
- analyzer success and failure state;
- lint counts by severity;
- metric values by analyzer;
- Stop decision;
- timeout and fail-open or fail-closed behavior.

Run these canaries:

1. **Structural canary:** reduce a fixture's complexity and MI debt while
   deliberately creating a permitted mechanical finding. Confirm that the
   active cluster stays open, a child task is created, and correctness gates
   remain hard.
2. **Mechanical canary:** fix one isolated lint cluster. Confirm 0 assigned
   findings and no metric regression.
3. **Coverage canary:** increase meaningful behavioral coverage without
   changing complexity. Confirm numeric CRAP falls, then remove coverage data
   and confirm CRAP becomes `null`, not `CC squared plus CC`.

After all five checks pass:

- make the shared core authoritative;
- remove standalone quality Stop registration;
- retain rollback copies until one normal full repository session passes;
- then remove the old engine and duplicate wrappers.

### Phase 6: CI replacement and legacy retirement

1. Add the hard quality gate.
2. Convert the audit workflow to artifact-only behavior.
3. Confirm local and CI repo profiles use the same policy hash.
4. Remove legacy workflows and stored patch machinery.
5. Remove stale generated inventories and superseded handoffs after their
   durable facts are present here or in the compact ledger.
6. Check all remaining references before deletion.

Exit: one hard workflow and one advisory workflow remain, with no automatic
quality-report commits or patch-application jobs.

### Phase 7: full repository cleanup campaign

Use the controller loop in section 23 until every final gate passes. Do not stop
after the controller infrastructure is green.

Exit: all criteria in section 2 pass from a clean checkout.

## 22. Retirement list

REMOVED 2026-09-02 after Phase 5 canaries passed and live-reference checks
were cleared (Log.md references updated; git history keeps every file):

### Workflows

- `.github/workflows/complexity-groups.yml`
- `.github/workflows/complexity-snapshot.yml`
- current `.github/workflows/quality-audit.yml`, replaced by the artifact-only
  definition
- `.github/workflows/quality-hardening-targeted.yml`
- `.github/workflows/apply-quality-hardening-patch.yml`
- `.github/workflows/apply-quality-refactor.yml`

### Stored patch payloads

- `.github/quality-hardening.patch`
- `.github/quality-refactor-payload.part-001.b64`
- `.github/quality-refactor-payload.part-002.b64`

### Generated or superseded planning artifacts

- `docs/agents/quality-hardening/OXLINT-ERROR-INVENTORY-2026-09-01.md`
- `docs/agents/quality-hardening/combined-driver.json`
- `docs/agents/quality-hardening/mi-by-file.json`
- `docs/agents/quality-hardening/wave3-manifest.md`
- `docs/agents/quality-hardening/HANDOFF-PLAN.md`
- `docs/agents/quality-hardening/HANDOFF-2026-08-31.md`

Git history preserves these artifacts. Do not rewrite history.

Before deletion:

```bash
rg -n 'complexity-groups|complexity-snapshot|quality-hardening-targeted|apply-quality-hardening-patch|apply-quality-refactor|OXLINT-ERROR-INVENTORY|combined-driver|mi-by-file|wave3-manifest|HANDOFF-PLAN|HANDOFF-2026-08-31' .
```

Update every live reference or keep the referenced file.

## 23. Cleanup campaign loop

Each implementation session follows this loop:

1. Read this plan, the repository agent docs, and the current campaign record.
2. Confirm the current policy hash and worktree state.
3. Run `summary`.
4. Run `queue next`.
5. Inspect the task and its evidence.
6. Claim the task before any write.
7. Add or strengthen behavioral characterization tests when the change is
   structural or coverage-sensitive.
8. Make the smallest cohesive repair inside the claimed scope.
9. Run the path profile.
10. Run the task profile.
11. Remeasure the task.
12. Record the attempt and effects.
13. Close the task, leave the structural parent open with generated children,
    or block it with an exact reproducible reason.
14. Release the writer claim.
15. Run the changed profile before ending the session.
16. Update the required trace and project docs.

Do not select work from a stale static inventory. Rebuild the queue after every
accepted structural task.

## 24. Cleanup order

The scheduler chooses individual tasks, but the campaign uses this broad order:

### 24.1 Restore hard correctness

- Keep the compiler, builds, tests, schema, MyPy, Ruff, and Rust checks green.
- Fix any newly exposed failure immediately.
- Add a regression test for each non-trivial defect found.

### 24.2 Repair structural roots

- Start with units below MI 50 and high measured CRAP.
- Separate policy, state, data preparation, and rendering only where behavior
  supports that boundary.
- Avoid helper extraction that only moves complexity.
- Re-run CCCC, code-multivitals, coverage, CRAP, and lint after each accepted
  cluster.
- Require MI 60 before cluster closure.

The initial candidates include `InteractiveGlobe`,
`useReadingQueueController`, `NewsPage`,
`ArticleDetailModalContent`, and `BlindspotView`, but a fresh measurement
and scheduler decision take precedence over this snapshot.

### 24.3 Close coverage risk

- Map coverage to stable source units.
- Add behavior tests for changed high-risk methods.
- Keep unmapped coverage visible.
- Do not use test-only CRAP improvement to close a failing structural task.

### 24.4 Apply proven mechanical transforms

- Start with high-volume, low-context clusters.
- Test each transform on positive, negative, and idempotence fixtures.
- Apply bounded batches.
- Type-check and lint each batch.
- Stop and encode any repeated failure as a negative fixture.

### 24.5 Resolve contextual lint

- Fix type-boundary, boolean, React, API, and architecture findings with local
  reasoning.
- Do not silence rules or weaken config.
- Re-cluster after changes to shared types or component structure.

### 24.6 Remove dead and duplicate code

- Verify references before removing exports or dependencies.
- Keep manifests and lockfiles consistent.
- Re-run imports, cycles, tests, and builds after each bounded group.

### 24.7 Final repository closure

- Run the full repo profile.
- Fix every reachable failure.
- Run it again from an unchanged worktree.
- Run `git diff --check`.
- Scan touched text files for conflict markers.
- Confirm the verifier did not mutate tracked files.

## 25. Retry and failure policy

An attempt is not repeated unchanged.

After a failure:

1. Record the smallest reproducible failure fingerprint.
2. Determine whether the fault is measurement, transformation, scope,
   behavior, or environment.
3. Add a parser fixture, negative codemod fixture, regression test, or hook test
   before retrying when the failure can recur.
4. Remeasure before another structural attempt.
5. Split the task only when the new boundary represents separate root causes.

A task may be marked `blocked` only with:

- the exact command and failure;
- three distinct evidence-backed attempts when retry is safe;
- the unaffected work completed;
- the external state or authority needed to continue;
- the next executable command after the blocker clears.

Large scope, high finding count, or slow verification is not a blocker.

## 26. Tests required for the controller

### Configuration and provenance

- invalid schema;
- missing analyzer;
- changed native config hash;
- changed analyzer version;
- same content at different path overrides;
- Git object ID kept separate from content SHA-256.

### Analyzer adapters

- valid empty result;
- valid findings;
- nonzero gate result with parseable output;
- timeout;
- malformed JSON;
- truncated output;
- coverage unmapped;
- analyzer-qualified complexity mismatch.

### Taxonomy and clustering

- unknown rule fails queue rebuild;
- one structural root absorbs correlated findings;
- mechanical findings cluster by syntax and override;
- cross-module type findings cluster on the boundary;
- structural change invalidates stale tasks.

### Scheduling

- priority classes are strict;
- dominated tasks are excluded;
- tie-break is deterministic;
- effect history changes ordering but never a hard gate.

### Writer claims

- atomic acquisition;
- second owner denied;
- same owner idempotent renewal;
- out-of-scope write denied;
- explicit scope expansion recorded;
- stale lock not reclaimed from time alone.

### Acceptance

- errors and warnings compared independently;
- structural canary tradeoff allowed only in-cluster;
- new correctness finding always blocks;
- MI below 50 blocks an intermediate structural attempt;
- MI below 60 blocks cluster closure;
- changed measured CRAP above 8 blocks closure;
- unknown CRAP stays unknown;
- helper-soup and complexity-migration cases stay open.

### Hook core

- each harness envelope maps to the same neutral request;
- same neutral result maps back correctly;
- same-event Stop logic executes once in fixed order;
- trusted exact realpath works;
- symlink or unregistered path cannot select a trusted adapter;
- shell metacharacters remain data;
- SQLite concurrent reads and writes do not corrupt state;
- stop-loop guard prevents repeated identical blocking messages.

### Verification and CI

- verifier leaves tracked files unchanged;
- required workflow has no `continue-on-error`;
- workflows contain no commit or push step;
- local and CI policy hashes match.

## 27. Documentation and traces during implementation

For each substantial phase:

- maintain `docs/agents/traces/<task-slug>.md` with goal, status, files,
  commands, tests, risks, failures, rollback, and next executable step;
- update `docs/Log.md` for process or behavior changes;
- add reusable failures to `docs/agent/known-errors.md`;
- add reusable lessons to `docs/agent/learnings.md`;
- update this document when an approved architectural decision changes;
- do not create standalone summary files.

Provider-supported opaque reasoning state may be preserved only through the
provider's documented continuation mechanism. The trace contains explicit
hypotheses, evidence, decisions, and command results. It must not claim access
to hidden chain-of-thought.

## 28. Review gates for each phase

Before advancing a phase:

1. Review the complete diff for the phase.
2. Run targeted regression tests.
3. Run the strongest affected verification profile.
4. Run `git diff --check`.
5. Confirm no policy or analyzer config was weakened.
6. Confirm no new suppression was added.
7. Confirm tracked ledgers contain summaries, not raw dumps.
8. Confirm the worktree contains no temporary files.
9. Update the campaign phase only after the exit criteria pass.

## 29. First executable session

The first implementation session should:

1. Read the files required by `AGENTS.md`.
2. Confirm the branch, head, and worktree.
3. Create the task trace.
4. Run the Phase 0 baseline commands without mutating source.
5. Add `quality-hardening.config.json` and its schema validation test.
6. Add the CLI entry point with `measure --scope repo --json`.
7. Wrap one analyzer at a time, starting with the existing source-scope helper
   and CCCC.
8. Add fixtures before adding the next adapter.
9. End only after the Phase 1 exit criteria pass or an exact external blocker
   is recorded.

Do not begin the lint cleanup from the old inventory before normalized
measurement and queue invalidation work.

## 30. Sources

Repository facts in this plan come from the files named in sections 3 and 22
and from the 2026-09-01 local audit.

External implementation references:

- [Codex hooks](https://developers.openai.com/codex/hooks) for event envelopes,
  project trust, concurrent same-event commands, and Stop decisions.
- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html) for
  native rule, category, override, plugin, and configuration behavior.
- [CCCC](https://github.com/moznion/cccc) for analyzer output and threshold
  capabilities.
- [crap-typescript](https://github.com/fabian-barney/crap-typescript) for
  TypeScript CRAP and coverage behavior.

Verify current tool versions and APIs before implementation. Pin versions in
the repository where repeatability requires it.

## 31. Final rule

The controller may accept a bounded intermediate tradeoff. The completed
repository gets no tradeoff. Every final gate must pass, behavior must remain
correct, and the same policy must govern local checks, hooks, and CI.
