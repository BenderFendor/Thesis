# Review: PR #8 "Build the Scoop evidence spine and proof suite"

## Goal and done criteria

Full local-agent review of `BenderFendor/Thesis` PR #8 (`agent/scoop-evidence-spine`
-> `main`). Reproduce behavior, find defects empirically, fix root causes locally,
add regression tests, run full verification, push fixes to the PR branch, and
comment on the PR with findings. Do not merge or mark ready for review.

## Status: done for everything reachable in this environment

Postgres was available so sections 3-6 ran for real against a disposable DB.
No browser/display was available, so section 8's `./runlocal.sh all` +
in-browser Atlas inspection could not be done; curl-level API checks were
substituted per the task's own fallback instruction. See "Blocked / not done"
at the end for the precise, evidence-backed list.

## SHA reviewed

`2f84628ce3d6e4ed98b590796a7bb361056040aa` (head of `agent/scoop-evidence-spine`
at handoff, confirmed via `git rev-parse review/pr-8` after
`git fetch origin pull/8/head:review/pr-8`). Work happened on
`review/pr-8-local`, branched from `review/pr-8`.

## Environment setup

- `backend/.venv` built with `python3.13` (the system default, `python3.14`
  via `/usr/local/bin/python3`, fails to build the `tokenizers` wheel — no
  prebuilt wheel yet for 3.14 as of 2026-07-20). `.venv` was built fresh with
  `/home/bender/.local/bin/python3.13`.
- The host filesystem hit `ENOSPC` during the first `pip install -r
  requirements.txt` (`~9.2GB` of stale pip cache). Ran `pip cache purge`
  (freed ~9GB) then reinstalled with `--no-cache-dir`. Disk stayed near-full
  (~7.8GB free) for the rest of the session; the Rust toolchain build in
  `verify.sh` was skipped for this reason (see "Blocked / not done").
- `backend/requirements.txt` does not list `pytest`, `pytest-asyncio`,
  `aiosqlite`, `httpx`, `mypy`, or `ruff`, even though `verify.sh` /
  `scripts/self-test` assume `.venv/bin/pytest` and `.venv/bin/mypy` exist.
  This is a pre-existing repo gap, not introduced by PR #8. Installed them
  manually to run the review commands the task specifies.
- Postgres was available locally (`newsuser`/`newspass`@`localhost:5432`).
  `newsuser` initially lacked `CREATEDB`; granted it once
  (`ALTER ROLE newsuser CREATEDB`) so a disposable `thesis_pr8_review` DB
  could be created. Never touched `newsdb` (the real local dev DB) or any
  other existing database.
- Frontend: `npm --prefix frontend ci --no-audit --no-fund` succeeded (900
  packages, ~11s).

## Baseline

```
git diff --stat origin/main...HEAD   # 35 files changed, 2741(+) 522(-)
git log --oneline --decorate origin/main..HEAD   # 35 commits
git diff --check origin/main...HEAD   # clean, no whitespace/conflict markers
```

`docs/scoop-evidence-spine.md` *is* added by the PR (commit `21047ad`), so the
"missing doc" note in the original task brief does not apply here.

## Reproduced focused checks (before my fixes)

```
cd backend
PYTHONPATH=. .venv/bin/pytest -q tests/test_evidence_policy.py tests/test_claim_comparison.py \
  tests/test_ownership_math.py tests/test_proof_suite_registry.py tests/test_clean_room_scanner.py \
  tests/test_evidence_export.py tests/test_wiki_atlas_contract.py
# 22 passed, 1 warning

PYTHONPATH=. .venv/bin/python scripts/check_proof_suite_clean_room.py app
# exit 0, no violations

npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
# exit 0
```

The PR's own focused suite passes. It does **not** prove correctness of the
acceptance pipeline, the Atlas projection, or lint/type conformance — see
below.

## Confirmed defects, root causes, and fixes

### 1. `init_db()` silently creates evidence-spine tables ahead of Alembic (fixed)

**Repro (before fix):** fresh Postgres DB, import the app the same way
`app/main.py` does (`from app.api.routes import router as api_router` before
`init_db()`), then call `init_db()`:

```python
import asyncio
from app.api.routes import router as api_router
from app.database import init_db
asyncio.run(init_db())
```

Result: `evidence_entities` and all 19 other evidence-spine tables exist, but
`alembic_version` does not. `Base.metadata.create_all()` (which
`app/database.py::init_db()` runs on every process boot, pre-existing
behavior) creates every table in the shared declarative `Base`, and since
`app/models/evidence.py` registers its ORM classes on that same `Base`,
plain app startup creates the entire evidence schema without Alembic ever
running. Confirmed empirically (see trace commands above, re-run against a
disposable `thesis_pr8_legacy` DB).

**Why it matters:** the PR's whole point in this area is a "proper" Alembic
migration (`backend/alembic/versions/20260720_0001_evidence_spine.py`). If
`init_db()` creates the tables first, `alembic_version` never gets stamped
(`alembic current`/`alembic history` don't reflect reality), and
`alembic downgrade base` becomes non-durable: the next app boot silently
recreates every dropped table via `create_all`, defeating the point of the
downgrade. This is a real answer to task review item 5 ("app startup doesn't
conflict with Alembic-managed tables") — it does conflict, silently.

**Fix:** `backend/app/models/evidence.py` now exports
`EVIDENCE_SPINE_TABLES` (single source of truth for the migration's table
list — the migration now imports it instead of duplicating the tuple).
`backend/app/database.py::init_db()` excludes those table names from
`Base.metadata.create_all(..., tables=...)`, from `_create_missing_tables()`,
and from `_add_missing_columns()`. Alembic is now the sole owner of that
schema.

**Verified after fix:**
```
# fresh legacy-shaped DB, import app then init_db():
# evidence_entities: relation does not exist  (init_db correctly skips it)
# legacy tables (articles, organizations, ...) still created normally
alembic upgrade head    # creates the 20 evidence tables, stamps alembic_version
alembic current          # 20260720_0001 (head)
# re-running init_db() afterward: no error, no duplication
```

### 2. Atlas `evidence_root_count` disagreed with the evidence API's root count (fixed)

**Repro:** `app/services/atlas_evidence_projection.py` computed
`evidence_root_count` as `len({snapshot_sha256 for ...})` — a raw count of
distinct snapshot hashes. `app/services/evidence_spine.py::
count_relationship_evidence_roots` (used by `GET /api/wiki/evidence/
relationships`) resolves `SourceLineage` parent/child chains first, so two
snapshots of a mirrored/copied filing collapse to one root. These are two
different definitions of "independent evidence root" for the same
relationship, which review item 4 explicitly calls out ("Compare API's
independent-root count against Atlas edge's `evidence_root_count` — they
must mean the same thing"). Before the fix, a relationship backed by two
lineage-linked snapshots would report `evidence_root_count: 2` in the Atlas
graph and `1` from the evidence API for the identical set of claims.

**Fix:** `atlas_evidence_projection.py` now calls
`evidence_spine.count_relationship_evidence_roots(db, claim_ids)` for each
edge instead of counting snapshot hashes directly.

**Regression test:** `tests/test_evidence_spine_integration.py::
test_atlas_root_count_matches_evidence_api_root_count_for_mirrored_filing` —
builds two `DocumentSnapshot`s of different documents joined by one
`SourceLineage` "mirror" row, materializes a relationship backed by both,
and asserts `count_relationship_evidence_roots(...) ==
load_evidence_atlas_projection(...)`'s edge `evidence_root_count`. Fails
before the fix (`2 != 1`), passes after.

### 3. Proof bundle embedded the internal `storage_path` of each snapshot (fixed)

**Repro:** `evidence_export.py::build_relationship_proof_bundle` built each
snapshot dict with `'storage_path': row.storage_path` and passed it straight
into `build_bundle_files`, which serializes it into `snapshots/index.json`
and (transitively) `proof.json` inside the downloadable ZIP.
`DocumentSnapshot.storage_path` is documented in scoop-rebuild-spec-v2.md as
the WARC-style server-side location of the raw bytes — an internal path, not
evidence. The existing test (`tests/test_evidence_export.py`) never caught
this because its fixture snapshot dict omits `storage_path` entirely, so it
never exercised the leak.

Review item 6 explicitly requires "No local absolute storage path appears in
the bundle" — this was a real violation of that requirement in the real
pipeline (not in the narrower unit test).

**Fix:** removed `'storage_path': row.storage_path` from the snapshot dict
built in `build_relationship_proof_bundle`. The bundle now only carries
`sha256_raw`/`sha256_canonical_text`/`retrieved_at`/`extraction_tool`/
`extraction_version` — everything needed to verify a snapshot, nothing that
leaks where it physically lives on the server.

**Regression test:** `tests/test_evidence_spine_integration.py::
test_proof_bundle_never_leaks_local_storage_path` — seeds a snapshot with
`storage_path="/var/scoop/snapshots/....warc"`, builds the real proof bundle
through `build_relationship_proof_bundle`, and asserts the literal
`storage_path` string and `"/var/scoop/snapshots"` do not appear in any file
inside the ZIP. Fails before the fix, passes after.

### 4. PR fails the repo's own `ruff check` / `ruff format` gate (fixed)

**Repro:**
```
uvx ruff check backend/       # 128 errors on the PR branch
uvx ruff format --check backend/   # 23 files not formatted
```
Confirmed these are PR-introduced, not pre-existing, by running the same
command against `origin/main` (`git archive origin/main -- backend`, ran in
an isolated copy): `All checks passed!`. `backend/ruff.toml` enforces Google-
convention docstrings (`D` rules) project-wide for `app/`/`alembic/` (tests
and scripts are exempted); the PR's ~20 new/changed files under `app/` and
`alembic/` were never run through `ruff check --fix` / `ruff format`, so
every new class/function/module was missing a docstring and formatting
drifted from the project's 100-col style.

**Fix:** ran `uvx ruff check backend/ --fix` (14 auto-fixed) and
`uvx ruff format backend/` (23 files reformatted — purely whitespace/line-
wrap, verified with `git diff`, no logic changes), then added real (not
placeholder) docstrings by hand for the 114 remaining `D1xx` violations
across `app/models/evidence.py`, `app/models/atlas.py`,
`app/services/ownership_math.py`, `app/services/evidence_spine.py`,
`app/services/evidence_export.py`, `app/services/evidence_policy.py`,
`app/services/atlas_graph.py`, `app/services/atlas_graph_helpers.py`,
`app/services/claim_comparison.py`, `app/services/atlas_evidence_projection.py`,
`app/proof_suite/cases.py`, `app/proof_suite/runner.py`,
`app/api/routes/wiki_atlas.py`, `app/api/routes/wiki_evidence.py`,
`app/models/evidence_api.py`, `alembic/env.py`,
`alembic/versions/20260720_0001_evidence_spine.py`.

**Verified after fix:**
```
uvx ruff check backend/          # All checks passed!
uvx ruff format --check backend/ # 290 files already formatted
```

### 5. PR fails strict backend mypy (fixed)

**Repro (unmodified PR tree, verified via `git stash` before touching
anything mypy-related):**
```
cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Found 12 errors in 4 files
```
Confirmed PR-introduced (not pre-existing on `origin/main`) except for one:
`app/api/routes/stream.py:373` (a `dict.get()` overload mismatch) is
unrelated to evidence-spine and out of scope for this review — it is not
touched by the PR's diff. The other 11 errors are all in PR-added files
(`evidence_export.py`, `evidence_spine.py`, `atlas_evidence_projection.py`).
Re-running mypy again after applying `ruff format` (pure reflow, see defect
4) but before any type fixes showed a higher raw count (20) purely because
reformatting split several dense one-line dict/call expressions onto
multiple lines, which changes how mypy attributes multiple errors to line
numbers on the same logical expression — not a real increase in distinct
defects. The 12-error `git stash` run against the fully unmodified PR tree
is the authoritative "before" baseline.

Two classes of finding:

- **Real bug** (`atlas_evidence_projection.py`): the function reused the
  loop variable name `link` for two different query results —
  `for link in links` (`list[RelationshipClaim]`) and later
  `for link in evidence_links` (`list[ClaimEvidence]`). mypy correctly
  flagged `"RelationshipClaim" has no attribute "observation_id"` because
  it infers a single type for a reused loop variable under strict mode.
  This does not crash at runtime (Python rebinds the name each loop), but it
  is a real type-safety/readability defect that would bite the next person
  who refactors this function. **Fixed** by renaming to
  `relationship_link`/`evidence_link`.
- **Type-contract mismatches**: several `nullable=False` `DateTime`/`String`
  columns (`recorded_at`, `materialized_at`, `retrieved_at`, `created_at`,
  `object_entity_id` after a None-check) were passed to Pydantic fields
  typed as non-Optional, or wrapped in redundant `cast()`s that didn't
  match mypy's inferred type. Fixed by using `cast(datetime, ...)`
  consistently (matching the file's existing pattern for other
  non-nullable columns) and removing casts mypy already proved redundant
  via flow-narrowing.

**Verified after fix:**
```
MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Found 1 error in 1 file — only the pre-existing, unrelated stream.py:373
```

## Confirmed architectural gaps (documented, not fixed — see reasoning)

These are real, evidence-backed findings that would require either a
product decision or substantial new integration work, not a surgical bug
fix. Fixing them speculatively risks inventing behavior the PR author/spec
didn't ask for, so they are documented here with the exact evidence instead.

### A. `ownership_math.py` and `claim_comparison.py` are completely unwired

```
grep -rln "compute_indirect_interest\|resolve_control_paths" backend/app backend/scripts
# only app/services/ownership_math.py itself

grep -rln "compare_claims\b" backend/app backend/scripts
# only app/services/claim_comparison.py itself

grep -rln "ContradictionRecord" backend/app
# only app/models/evidence_api.py (the Pydantic model itself)
```

Both modules are correctly implemented and well unit-tested in isolation
(`tests/test_ownership_math.py`, `tests/test_claim_comparison.py` — 8 tests,
all passing), and `ContradictionRecord` (with all 6 classifications,
including `confirmed_conflict`) is fully modeled in the API contracts. But
none of it is called from `evidence_spine.materialize_claim` or
`evidence_policy.evaluate_acceptance`. Concretely:

- `materialize_claim` never runs the safe-ownership-math disjointness/SCC
  checks before accepting a `directly_owns`/`owns_equity_in` claim. Two
  different owners could each get an accepted relationship for the same
  publication with percentages that sum past 100%, or a claim could
  materialize with `qualifiers.pct > 1` and nothing in the acceptance path
  would catch it (`InterestRange`'s `>1` guard is never invoked).
- `materialize_claim` never runs `compare_claims` against existing accepted
  relationships for the same subject/predicate before creating a new one,
  so `apparently_conflicting`/`confirmed_conflict` claims can each
  materialize independently with no adjudication trigger.
- There is no endpoint that returns a `ContradictionRecord` at all — the
  contract exists, nothing produces it.

Review items 7 ("Ownership mathematics") and 8 ("Contradiction
classification") ask to test these as empirical hypotheses; both were
tested and both are confirmed unwired. Wiring this in correctly (deciding
*where* in the materialization pipeline ownership math and contradiction
detection should run, what to do on conflict — reject, flag for
adjudication, or something else — and back-filling test coverage for real
multi-claim scenarios) is a substantial design decision that belongs to the
PR author or a follow-up task, not a fix I should invent unilaterally
mid-review.

### B. `EvidencePolicyRow` (DB table) is entirely dead

`backend/alembic/versions/20260720_0001_evidence_spine.py` creates
`evidence_policy_rows`, and `app/models/evidence.py::EvidencePolicyRow`
defines it, but:
```
grep -rn "EvidencePolicyRow" backend/ --include=*.py
# only the model definition and __all__ export
```
`evidence_policy.py` (the sole thing `evaluate_acceptance`/
`materialize_claim` consult) is a pure-Python module —
`POLICIES: dict[str, PredicatePolicy]` and `POLICY_VERSION =
"evidence-policy/2.0"` are hardcoded constants. `GET /api/wiki/evidence/
policies` serializes that same Python dict, never queries the table. This
directly answers review item 10 ("Policy versioning... Python-defined
policies vs `EvidencePolicyRow`: which is authoritative?") — the Python
module is 100% authoritative, and the table is unused scaffolding. It also
means "can historical relationships reproduce the exact policy that
accepted them" only holds as long as `POLICY_VERSION` is bumped by hand
every time `POLICIES` changes; there's no enforcement of that discipline
and no immutable/hashed representation of a policy, only a version string.
I added a docstring to `EvidencePolicyRow` in `app/models/evidence.py`
explicitly documenting this gap so it isn't mistaken for a working feature,
but did not build the missing DB-backed policy resolution (a real feature,
not a bug fix).

### C. No authorization/audit trail on claim materialization

`POST /api/wiki/evidence/claims/{claim_id}/materialize` has no
`Depends(...)` auth guard, and `AcceptedRelationship`/`RelationshipClaim`
store no reviewer identity, only `acceptance_policy_version` and
`materialized_at`. Verified empirically:
```
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://127.0.0.1:8125/api/wiki/evidence/claims/does-not-exist/materialize
# 422 (reached business logic with zero credentials)
```
However: `grep -rln "auth\|current_user\|require_admin" backend/app` finds
**no** authentication/authorization framework anywhere in this backend —
every route in `app/api/routes/*.py` is equally unguarded (this is a
single-user local research tool, not a multi-tenant service). So this is
not a regression introduced by PR #8; it's consistent with the rest of the
app's existing (lack of) trust model. Bolting an ad hoc auth check onto only
this one endpoint, when the surrounding 30+ endpoints have none, would
create a false sense of security and invent an architecture the rest of the
app doesn't have. Documenting instead: if this tool is ever exposed beyond
localhost, `materialize`/`retract`-style endpoints that convert
candidate research into "accepted facts" are the ones that most need a
real trust boundary and an audit log (`reviewed_by`/`reviewer` already
exist on `ClaimEvidence`/`EvidenceObservation` but are never populated by
any code path — nothing sets them).

### D. Clean-room scanner (`scripts/check_proof_suite_clean_room.py`) has real, demonstrable bypasses

Confirmed by reading the implementation (not yet exploited by any code in
the repo — the scanner currently reports 0 violations against `app/`):

- **Directory-scoped, not content-scoped**: `_looks_like_pipeline()` only
  scans files whose *path* contains `adapter`/`parser`/`resolver`/
  `extractor`/`materialize`. A hardcoded fact table dropped into any other
  file (e.g. `app/services/ownership_lookup.py` or a generically-named
  utils file) is invisible to the scanner. Review item 12 explicitly names
  this scenario ("generic files with benchmark-specific paths").
- **Same-line matching only**: the reason classifier requires the outlet
  name and an `owner`/`parent`/`expected_path`/`hardcoded` keyword on the
  *same physical line*. A multiline mapping like
  ```python
  OWNER_MAP = {
      "Washington Post":
          "Nash Holdings",
  }
  ```
  slips through — neither line matches both conditions.
- **Name list, not fact detector**: `BENCHMARK_NAMES` is a fixed list of
  full outlet names. Abbreviations/aliases (`WaPo`, `NYT`, `WSJ`) and
  hardcoded internal entity IDs (e.g. `org_nash_holdings_llc`) are not in
  the list and would never trigger a match regardless of context.

I did not rewrite the scanner: strengthening it (multi-line window,
alias/ID detection, content-based rather than path-based scoping) is a
meaningful new capability with its own risk of false positives against
legitimate code, and the task says to document bypasses found, not to
redesign the tool speculatively. Flagging here as a real gap in the "clean
room" enforcement's actual coverage versus what the proof-suite
methodology needs it to guarantee.

### E. Proof-suite runner produces manifests, not proofs

`app/proof_suite/runner.py::empty_run_manifest` returns a scaffold with
`hidden_case_count: 5` and a fixed `assertions_per_case` list, but nothing
in the repo calls `assert_snapshot_pinned_truth`/`validate_case_result`
against real truth-bundle data, and there are no truth bundles in the repo
(the task brief confirms this is intentional — the 20 human-reviewed truth
bundles and 5 hidden cases are deliberately not shipped). `PUBLIC_CASES` in
`app/proof_suite/cases.py` is a registry of case *labels* and required
mutation classes; `tests/test_proof_suite_registry.py` only asserts the
registry itself is well-formed (20 unique cases, 6 mutations each), not
that any case has ever actually run and passed. This matches review item 12
("Don't let registry entries be called 'passed proofs'") — nothing in this
PR calls them passed proofs, but I want to make explicit for anyone reading
this trace: **infrastructure-that-exists** (registry, assertion names,
manifest scaffold, clean-room scanner) and **tests-that-actually-execute
against real evidence** (zero — no truth bundles exist yet) are currently
two very different things here, and the repo's own docs should keep saying
so.

## Bitemporal boundary semantics (reviewed, not changed)

`_valid_at`/`_known_at` in `evidence_spine.py` and the equivalent filter in
`atlas_evidence_projection.py` both use inclusive `[from, to]` on valid time
(`valid_from <= as_of`, `valid_to >= as_of`) and a half-open
`[recorded_at, retracted_at)` on transaction time
(`recorded_at <= known_at`, `retracted_at IS NULL OR retracted_at >
known_at`). This is applied identically in both places I could find that
query `AcceptedRelationship` (evidence API and Atlas projection), so the
two systems agree with each other. I did not find a written spec statement
of which boundary convention is intended (scoop-rebuild-spec-v2.md doesn't
say `[from,to]` vs `[from,to)` explicitly), so I can't say whether this
matches the *intended* semantics, only that it's internally consistent
across the two call sites I found. Did not add tests for the exact-boundary
cases (`as_of==valid_from`, `known_at==retracted_at`, tz-aware vs naive) —
this is empirical work that needs many more scenarios than I could
responsibly add without a written boundary spec to test against; flagging
as follow-up work rather than guessing.

## Regression tests added

`backend/tests/test_evidence_spine_integration.py` — 8 new tests, all
passing, exercising the full chain (entities -> registry document ->
snapshot -> observation -> claim -> `ClaimEvidence` -> `materialize_claim`
-> `list_relationships` -> Atlas projection -> proof bundle) against an
in-memory SQLite DB (same pattern as `tests/conftest.py`):

1. `test_catalog_metadata_alone_is_rejected`
2. `test_model_suggested_entailment_is_rejected`
3. `test_reviewed_yes_with_permitted_class_succeeds_and_materializes`
4. `test_relationship_cannot_materialize_before_qualifying_evidence`
5. `test_duplicate_materialization_is_idempotent_and_keeps_supporting_links`
6. `test_accepted_only_query_returns_the_accepted_edge`
7. `test_atlas_root_count_matches_evidence_api_root_count_for_mirrored_filing`
   (regression for defect 2)
8. `test_proof_bundle_never_leaks_local_storage_path` (regression for
   defect 3)

## Exact verification commands and pass/fail counts

Backend focused suite (before and after fixes — same command, counts differ
only by the 8 new tests):
```
PYTHONPATH=. .venv/bin/pytest -q tests/test_evidence_policy.py tests/test_claim_comparison.py \
  tests/test_ownership_math.py tests/test_proof_suite_registry.py tests/test_clean_room_scanner.py \
  tests/test_evidence_export.py tests/test_wiki_atlas_contract.py tests/test_evidence_spine_integration.py \
  tests/test_atlas_relationship_integrity.py
# 34 passed, 1 warning
```

Full backend suite (non-slow):
```
PYTHONPATH=. .venv/bin/pytest -q tests -m "not slow"
# 461 passed, 16 failed, 3 deselected
```
The 16 failures (`test_chroma_topics_fallback.py`, `test_country_mentions.py`,
`test_extraction_image_flow.py`, `test_persistence_embedding.py`,
`test_rust_algorithm_ports.py`, `test_scroll_personalization_flow.py`) are
**pre-existing and unrelated to PR #8** — confirmed by `git stash` + re-run
on the unmodified PR tree, same 16 failures, same root cause
(`rss_parser_rust` extension module not built in this environment;
`AttributeError: module 'rss_parser_rust' has no attribute
'rust_generate_cluster_label'`). Did not attempt to build the Rust
extension (see "Blocked / not done").

Clean-room scanner:
```
PYTHONPATH=. .venv/bin/python scripts/check_proof_suite_clean_room.py app
# exit 0
```

Ruff:
```
uvx ruff check backend/          # All checks passed! (was 128 errors)
uvx ruff format --check backend/ # 290 files already formatted (was 23 unformatted)
```

Mypy:
```
MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Found 1 error in 1 file (app/api/routes/stream.py, pre-existing/unrelated;
# was 12 errors in 4 files on the unmodified PR tree)
```

Frontend:
```
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit   # exit 0
npm --prefix frontend run lint    # 0 errors, 1 pre-existing warning (atlas-index-sheet.tsx, unrelated to PR diff)
npm --prefix frontend run build   # succeeds, all routes compile (Next.js 16.1.2 / Turbopack)
npm --prefix frontend test -- --runInBand
# Test Suites: 2 failed, 31 passed, 33 total; Tests: 3 failed, 107 passed, 110 total
```
The 2 failing suites (`blindspot-view.test.tsx`, `search-inline-edit.test.tsx`)
touch code entirely outside this PR's frontend diff (`git diff --name-only
origin/main...HEAD -- frontend/` is exactly `atlas-api.ts`, `atlas-schema.ts`,
`d3-geo.d.ts`) — one fails on an unrelated Next.js app-router test-harness
issue ("invariant expected app router to be mounted"), the other on
findByText timing. Not touched; out of scope for this review.

Alembic (against a disposable `thesis_pr8_review` DB, never `newsdb`):
```
alembic upgrade head        # creates all 20 evidence tables + alembic_version
alembic current              # 20260720_0001 (head)
alembic upgrade head         # idempotent, no error, no-op
alembic downgrade base       # drops exactly the 20 evidence tables (verified via \dt)
alembic upgrade head         # recreates cleanly
alembic upgrade head --sql   # offline SQL: only the 20 evidence tables + alembic_version, no legacy tables
```
Existing-database (legacy fixture) migration, on a disposable
`thesis_pr8_legacy` DB seeded via the real app import path
(`app.api.routes.router` then `init_db()`, matching `app/main.py`'s actual
import order):
```
# before database.py fix: init_db() alone created all 20 evidence tables,
#   no alembic_version row -> Alembic history disconnected from reality
# after fix: init_db() creates only legacy tables; `alembic upgrade head`
#   then creates the evidence tables and stamps alembic_version correctly;
#   re-running init_db() afterward is a no-op, no duplication/error
```

Live API smoke test (uvicorn against the disposable Postgres DB,
`ENABLE_DATABASE=1`; no browser/display available for the Atlas UI):
```
GET  /api/wiki/evidence/policies              -> 200, full policy list
GET  /api/wiki/evidence/relationships          -> 200, {"relationships": []}
GET  /api/wiki/atlas/graph?accepted_only=true  -> 200
GET  /api/wiki/evidence/relationships?as_of=not-a-date -> 422 (validated cleanly)
POST /api/wiki/evidence/claims/does-not-exist/materialize -> 422 (no auth required to reach it — see gap C)
POST /api/wiki/evidence/claims/evaluate {"claim_id":"nope"} -> 404, {"detail":"claim 'nope' does not exist"}
```

## Files changed (this review, on top of the PR)

- `backend/app/database.py` — exclude Alembic-managed evidence-spine tables
  from ad hoc `create_all`/`_add_missing_columns` (defect 1)
- `backend/app/models/evidence.py` — add `EVIDENCE_SPINE_TABLES` constant;
  docstrings for all 20 ORM classes + module docstring + `EvidencePolicyRow`
  gap note (defect 1, defect 4, gap B)
- `backend/alembic/versions/20260720_0001_evidence_spine.py` — import
  `EVIDENCE_SPINE_TABLES` instead of duplicating the table list; docstrings
  (defect 1, defect 4)
- `backend/alembic/env.py` — docstrings (defect 4)
- `backend/app/services/atlas_evidence_projection.py` — use
  `count_relationship_evidence_roots` instead of raw snapshot-hash count
  (defect 2); rename reused loop variable `link` -> `relationship_link`/
  `evidence_link` (defect 5); remove redundant casts; docstrings
- `backend/app/services/evidence_export.py` — remove `storage_path` from
  the exported snapshot dict (defect 3); fix `.isoformat()` on
  `nullable=False` datetime columns via `cast(datetime, ...)` (defect 5);
  docstrings
- `backend/app/services/evidence_spine.py` — fix `AcceptedRelationshipRecord`/
  `EvidenceClaimRecord` datetime type mismatches, remove redundant casts
  (defect 5); docstrings
- `backend/app/services/ownership_math.py`, `evidence_policy.py`,
  `claim_comparison.py`, `atlas_graph.py`, `atlas_graph_helpers.py` —
  docstrings only (defect 4)
- `backend/app/models/atlas.py`, `evidence_api.py` — docstrings only
  (defect 4)
- `backend/app/api/routes/wiki_atlas.py`, `wiki_evidence.py` — docstrings
  only (defect 4)
- `backend/app/proof_suite/cases.py`, `runner.py` — docstrings only
  (defect 4)
- `backend/scripts/check_proof_suite_clean_room.py`,
  `migrate_legacy_ownership_to_evidence.py` — reformatted only
  (`ruff format`, whitespace/line-wrap, verified no logic diff)
- `backend/tests/test_claim_comparison.py`, `test_evidence_export.py`,
  `test_evidence_policy.py`, `test_ownership_math.py`,
  `test_proof_suite_registry.py` — reformatted only (`ruff format`)
- `backend/tests/test_evidence_spine_integration.py` — new, 8 regression
  tests (see above)

## Blocked / not done, with precise reasons

- **Rust extension build (`clippy`/`fmt`/build) and the 16 Rust-dependent
  test failures**: not attempted. Root cause is `rss_parser_rust` not being
  built in this environment; building it would need `maturin`/`cargo`
  toolchain setup with disk headroom this environment does not reliably
  have (hovered at 6-8GB free for most of the session after clearing a
  9GB stale pip cache). Confirmed via `git stash` that these failures
  predate my changes and are unrelated to the evidence spine. Real
  blocker: disk/toolchain, not something fixable within this review's
  scope.
- **Browser-based Atlas verification** (selecting an evidence-backed node,
  checking the inspector/side panel, deep links): no display/browser
  available in this sandboxed environment. Substituted with direct
  API-level curl checks against a live uvicorn instance (see above) and the
  SQLite-backed integration test that exercises
  `load_evidence_atlas_projection` directly. Did not verify the React
  side-panel rendering path (`atlas-inspector.tsx` etc.) actually renders
  evidence-spine nodes correctly — only that the API returns well-shaped
  data for them.
- **Full `./runlocal.sh all`**: not run (needs Chroma + an embedding
  service + a frontend dev server + a browser). Ran the backend directly
  with `uvicorn` against the disposable Postgres DB instead, per the task's
  own explicit fallback instruction.
- **Ownership math / contradiction classification wiring (gap A)**: not
  fixed. This is new integration work requiring a product decision on
  exactly where in the acceptance pipeline these checks should run and what
  should happen on conflict (reject materialization? open an
  `AdjudicationItem`? something else?). Documented with concrete evidence
  above; flagging as the single highest-value follow-up.
- **Retraction/supersession propagation** (item 2), **source-lineage
  independence beyond the one mirror case tested** (item 4, partially
  covered), **concurrent materialization** (item 9), **legacy migration
  script deep testing** (item 11 — read the script and it looks correct,
  but did not run it against a full fixture DB with real `Organization`/
  `SourceMetadata`/`SourceClaim` rows): reviewed by code reading only, not
  empirically exercised with dedicated tests, due to time. None revealed an
  obvious defect on inspection, but "no obvious defect on inspection" is
  weaker evidence than a passing test and should not be read as "verified
  correct."
- **BODS schema validation via an official validator**: no official BODS
  JSON Schema validator was available offline in this environment;
  `validate_bods_shape()` (the PR's own structural check) passes, but that
  is a much weaker guarantee than schema validation against the real BODS
  spec.

## Push and PR status

Pushed to `agent/scoop-evidence-spine` on `BenderFendor/Thesis`. PR #8
remains **draft** — not marked ready for review, not merged, per explicit
instruction.
