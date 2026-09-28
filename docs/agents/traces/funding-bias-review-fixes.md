# Funding-bias PR #36 review fixes

## Goal / done criteria

Fix seven review findings on `rust/funding-bias-statistics` (PR #36):
1. HIGH -- Python public reader (`load_latest_funding_bias_analysis`) loaded
   the wrong preregistration for v2 traces.
2. MEDIUM -- Rust `resolve_funding_bias_attribute` treated `Some("")` legacy
   as present instead of falling through to catalog.
3. MEDIUM -- Python `_collect_outlet_sample` double-prefixed the outlet
   evidence entity lookup, so accepted claims were silently unused.
4. MEDIUM -- `thesis-funding-bias` enabled serde_json's workspace-wide
   `preserve_order` feature.
5. LOW -- `thesis-funding-bias` duplicated (less exactly) normalization
   logic that already existed in `thesis-api`.
6. LOW -- undocumented compile-time catalog baking and v1/v2 trace-id hash
   incompatibility.
7. LOW -- weak Kani/Verus proofs that didn't exercise real overflow/guard
   behavior.

Done: each finding fixed with a regression test where applicable, focused
Rust/Python verification run, and this trace plus `docs/Log.md` updated for
the behavior change in finding 3.

## Status: done, with two flagged blockers

- Findings 1-7: code changes complete, focused tests pass.
- Blocker A: Kani (`cargo-kani`) and Verus (`verus`) are not installed in
  this environment (`command -v cargo-kani verus` found neither). The
  strengthened harnesses/proofs for finding 7 build and typecheck but have
  not been executed. Documented explicitly in
  `docs/agents/formal-audit/verification-manifest.json` rather than
  claiming a pass.
- Blocker B: `thesis-api` and `thesis-db` have large pre-existing
  compile/clippy failures on the unmodified branch (`git stash` verified),
  unrelated to this task's files (`gdelt.rs`, `jobs_image.rs`,
  `wiki_atlas/stats.rs` missing the `sqlx` crate in scope, missing `zip`
  crate, `utoipa` attribute-syntax mismatches, and separate pre-existing
  Clippy findings in `atlas_materialization.rs` / `thesis-db/src/lib.rs` /
  `verification_cache.rs`). `cargo test -p thesis-api --lib wiki_atlas`
  cannot run in this environment as a result. Not fixed -- out of the
  surgical scope of this review-fix task; confirmed identical on the base
  commit before any of my changes.
- Blocker C (process, not code): three early commits
  (`f63ff45`, `d2da14f`, `d74b4a5`) were made before the coordinator's
  no-trailer instruction landed and still carry a
  `Co-Authored-By: Claude <noreply@anthropic.com>` trailer. Rewriting them
  was denied by the environment's git-destructive-action guard
  (`git filter-branch`/rebase blocked). All later commits omit the
  trailer. The orchestrator needs to rewrite those three hashes.

## Files changed

- `backend/app/services/funding_bias_analysis.py` -- findings 1, 3
- `backend/tests/test_funding_bias_analysis.py` -- findings 1, 3 (new tests)
- `docs/Log.md` -- finding 3 behavior-change log entry
- `backend/crates/thesis-db/src/wiki.rs` -- finding 2 (+ test)
- `backend/crates/thesis-funding-bias/Cargo.toml` -- finding 4 (indexmap in,
  preserve_order out, sha1/unicode-general-category out)
- `backend/crates/thesis-funding-bias/src/lib.rs` -- findings 4, 5, 6
  (IndexMap catalog parse, dropped duplicate normalize/stable-id functions,
  CATALOG_JSON doc comment)
- `backend/Cargo.lock` -- finding 4 (indexmap gains the serde feature; no
  crates named "preserve_order" dependency to remove, since it's a
  serde_json feature flag, not a separate crate)
- `backend/crates/thesis-search/src/entity_id.rs` (new) -- finding 5, moved
  Python-faithful `casefold`/`normalize_entity_label`/`sha1_digest`/
  `hex_prefix`/`stable_source_id` here from `thesis-api`
- `backend/crates/thesis-search/src/lib.rs` -- finding 5 (new `entity_id`
  module declaration)
- `backend/crates/thesis-api/src/wiki_atlas/graph/ids.rs` -- finding 5
  (deleted duplicated functions, now re-exports from `thesis_search`)
- `backend/crates/thesis-api/src/wiki_atlas/graph.rs` -- finding 5 (deleted
  the now-duplicate `sha1_ids_match_the_python_digest_contract` /
  `casefold_matches_python_full_unicode_semantics` tests)
- `docs/architecture/rust-backend-migration.md` -- finding 6 (new
  "Funding-bias runner notes" section)
- `backend/crates/thesis-search/src/funding_bias.rs` -- finding 7 (two new
  Kani harnesses, replacing the vacuous u8-bounded one)
- `backend/crates/thesis-search/verus/funding_bias_guard.rs` -- finding 7
  (two new Verus proofs)
- `docs/agents/formal-audit/verification-manifest.json` -- finding 7
  (updated scope text, honest "not_run_this_session" status for
  kani/verus)

## Commands run and results

- `cd backend && /home/bender/classwork/Thesis/backend/.venv/bin/pytest
  tests/test_funding_bias_analysis.py -q` -- 12 passed (reused the main
  worktree's existing `.venv` read-only; this worktree has none and
  `uv`/pip installs were out of scope for a focused fix).
- `cargo test -p thesis-funding-bias -p thesis-search --lib` -- 63 + 4 = 67
  passed, 0 failed.
- `cargo test -p thesis-db --lib funding_bias_resolution_tests` -- 3
  passed (the DB-dependent `thesis-db` suite otherwise needs
  `DATABASE_URL`, unrelated to this task and confirmed unset in this
  environment).
- `cargo fmt --all -- --check` -- clean (after `cargo fmt --all` fixed one
  formatting diff in the new `entity_id.rs`).
- `cargo clippy -p thesis-search --all-targets -- -D warnings` -- clean.
- `cargo clippy -p thesis-funding-bias --all-targets --no-deps -- -D
  warnings` -- clean (per `docs/agent/testing.md`'s own `--no-deps` usage
  for this crate, because `thesis-db` fails clippy on unrelated
  pre-existing files even without `--no-deps`, confirmed via `git stash`).
- `cargo clippy -p thesis-db --all-targets --no-deps -- -D warnings` --
  fails with pre-existing errors in `atlas_materialization.rs`, `lib.rs`,
  `verification_cache.rs`; confirmed identical (same error set) with
  `git stash` against the unmodified branch tip.
- `cargo build -p thesis-api` / `cargo test -p thesis-api --lib wiki_atlas`
  -- ~186-200 pre-existing compile errors (missing `sqlx`/`zip` crates in
  scope, `RefreshWorkerError` undeclared, `utoipa` attribute mismatches),
  confirmed identical via `git stash` against the unmodified branch tip.
  Not fixed; out of this task's surgical scope.
- `command -v cargo-kani verus` -- neither found; Kani/Verus were not run.
- `git diff --check main...HEAD` -- clean.
- `rg -n '<<<<<<<|=======|>>>>>>>'` across changed files -- no real
  conflict markers (one unrelated doc line in `docs/agent/testing.md`,
  not touched by this session, mentions the pattern itself).

## Decisions

- Reused the main worktree's `.venv/bin/pytest` read-only from this
  worktree (`Thesis-pr36` has no venv of its own) rather than creating a
  new one, since the task forbade touching the main worktree but reading
  its already-installed interpreter is not a mutation.
- Moved `casefold`/`normalize_entity_label`/`sha1_digest`/`hex_prefix`/
  `stable_source_id` into `thesis_search::entity_id` rather than
  `thesis-db`, since `thesis-search` is already a shared dependency of
  both `thesis-api` and `thesis-funding-bias` with no cycle risk (see the
  workspace dependency graph in `docs/architecture/rust-backend-migration.md`).
- Kept `edge_id`/`confidence_tier` in `thesis-api`'s `ids.rs` (not moved);
  only the functions explicitly named as duplicated in the finding moved.
- For finding 4, chose `indexmap::IndexMap` over alternatives (already in
  `Cargo.lock` at 2.14.2 with the needed `serde` feature already enabled
  by another workspace crate).
- Did not attempt to fix the pre-existing `thesis-api`/`thesis-db`
  compile/clippy failures: confirmed via `git stash` they exist
  identically on the unmodified branch tip, and are unrelated to any of
  the seven findings (missing crate scope, unrelated modules).

## Failed approaches

- Attempted `git filter-branch --msg-filter` (then considered
  `git rebase --exec`) to strip the `Co-Authored-By: Claude` trailer from
  the three commits made before the no-trailer instruction landed. Both
  are blocked by this environment's git-destructive-action policy hook.
  Stopped per the coordinator's explicit instruction not to look for
  workarounds; reported the three hashes for the orchestrator to rewrite
  instead.

## Follow-up verification (2026-09-28)

- The co-author trailers on the first three commits were removed with a
  `git rebase --exec` script; the tree was byte-identical afterwards.
- Kani 0.68.0 is installed at `~/.cargo/bin` (not on the default `PATH`).
  The first rectangularity harness used `String`, `BTreeSet`, `HashMap`,
  and symbolic `Vec` sizes; CBMC used about 18 GiB and nearly froze the
  workstation. `build_contingency_table` now sorts borrowed categories and
  feeds index pairs to a pure `count_cells` kernel, and the harness checks
  that kernel on a concrete 2x2 table. Both funding-bias harnesses pass
  (3.1 s and 14.1 s) under `systemd-run --user --scope -p MemoryMax=8G`.
- Verus 0.2026.09.20.aef82ed: `funding_bias_guard.rs` reports 14 verified,
  0 errors.
- Criterion, 20,000 pairs: table build 3.90 ms before, 2.61 ms after
  (-33%). Cramer V is unchanged within noise.

## Remaining risks / blockers

- No live PostgreSQL run of the CLI yet.
- `thesis-api` build restoration is tracked separately on branch
  `rust/restore-api-build`.
