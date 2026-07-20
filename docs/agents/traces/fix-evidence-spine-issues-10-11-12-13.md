# Fix evidence-spine issues #10, #11, #12, #13

## Goal and done criteria

Fix the four open GitHub issues from the PR #8 (agent/scoop-evidence-spine)
review that do not have an open PR against them (issue #9 is covered by PR
#14, out of scope here):

- #10: `ownership_math`/`claim_comparison` not wired into the acceptance pipeline
- #11: `EvidencePolicyRow` DB table is dead code, Python dict is the real policy source of truth
- #12: clean-room scanner has known bypasses
- #13: proof suite produces manifests, not executed end-to-end proofs

Done = each issue's described gap is closed with real, tested code (not
scaffolding), or the issue's own admission that a step requires a human
(review, sign-off, independent reviewer) is confirmed as a genuine blocker
and left honestly documented.

## Status: #10, #11, #12 done. #13 partially done; the rest is blocked on humans.

## Branch / worktree

`fix/evidence-spine-followups`, worktree at
`.worktrees/fix-evidence-issues`, based on `origin/main` (which already has
PR #8 merged). Not based on local `main`, which was 47 commits behind and
had unrelated uncommitted intelligence-atlas work in the primary worktree.

## Files changed

- `backend/app/services/evidence_spine.py` -- `materialize_claim` now:
  runs `claim_comparison.compare_claims` against existing accepted
  relationships sharing the same subject+predicate and opens an
  `AdjudicationItem` (blocking materialization) on a real contradiction;
  validates a new interest claim's own `pct`/`pct_band` qualifiers before
  creating anything (`_check_interest_claim`); records an
  `ownership_math`-derived `CalculationTrace` after materializing an
  interest-carrying claim (`_record_interest_trace`). Added
  `compute_ownership_interest` to serve indirect/cross-holding-aware
  interest across the full accepted graph (multi-hop, not just a single
  relationship's raw qualifier).
- `backend/app/api/routes/wiki_evidence.py`, `app/models/evidence_api.py` --
  new `GET /api/wiki/evidence/interest` endpoint serving
  `compute_ownership_interest`.
- `backend/app/models/evidence.py` -- removed `EvidencePolicyRow` (dead ORM
  model; nothing read it, and no migration ever created its table before
  this work uncovered it was still listed as if it did).
- `backend/app/services/evidence_policy.py` -- module docstring now states
  the `POLICIES` dict + `POLICY_VERSION` is the formal, sole source of
  truth for acceptance policy.
- `backend/alembic/versions/20260720_0003_drop_evidence_policy_rows.py` --
  new migration dropping `evidence_policy_rows` for any DB that already ran
  migration `20260720_0001`. `down_revision = "20260720_0001"`; if PR #14
  (which adds `20260720_0002` on an unmerged branch) lands first, whoever
  merges next needs to fix the revision chain (rename this to `0003` after
  `0002`, or renumber) -- flagging this now since it's a real, visible
  follow-up, not a silent gap.
- `backend/scripts/check_proof_suite_clean_room.py` -- rewritten scanner:
  whitespace-preserving-as-single-space normalization (was: delete all
  whitespace, which broke short aliases like "AP"/"FT" by fusing them into
  surrounding words) so multiline literals still match while word
  boundaries survive; alias/abbreviation table per benchmark entity; an
  explicit `PIPELINE_ALLOWLIST` of the real evidence-spine files (mirrored
  from `.github/workflows/evidence-spine.yml`'s path filters) in addition
  to the old directory-name-marker heuristic.
- `backend/app/proof_suite/runner.py` -- new
  `evaluate_case_against_database`: runs the 15 named assertions against
  what the pipeline actually materialized for a truth bundle, instead of
  only checking the truth bundle's own shape (`assert_snapshot_pinned_truth`,
  unchanged, kept for that narrower purpose).
- `docs/scoop-evidence-spine.md` -- one paragraph pointing at the new
  runner and reiterating what's still blocked.
- New tests: `backend/tests/test_evidence_spine_wiring.py`,
  `backend/tests/test_proof_suite_runner_execution.py`; extended
  `backend/tests/test_clean_room_scanner.py`.

## Key finding while fixing #12

The *old* scanner's directory-name heuristic (`adapter`/`parser`/`resolver`/
`extractor`/`materialize` as a path substring) did not match any real
evidence-spine pipeline file. Checked directly:

```
$ python3 -c '<old _looks_like_pipeline against app/>'
app/services/contradiction_extractor.py
app/services/rss_parser_rust_bindings.py
app/services/source_field_extractor.py
app/services/source_profile_extractor.py
```

None of these are evidence-spine code -- they're unrelated news-aggregation
modules that happen to have "extractor"/"parser" in their filename. The
actual pipeline (`evidence_spine.py`, `evidence_policy.py`,
`claim_comparison.py`, `ownership_math.py`, `wiki_evidence.py`, ...) was
never in scope. CI ran clean (0 violations) not because the pipeline was
clean, but because it was never being scanned. This is a more severe
version of the issue than its own description suggested.

Also found: naively scanning all of `backend/app` (the issue's "scan
repo-wide" suggestion, taken literally) produces **3102** violations,
because this is a general news aggregator that legitimately references
real outlet names everywhere (RSS feed configs, MBFC credibility data,
source profiles) outside the evidence-spine subsystem. Went with an
explicit allowlist of the real pipeline files (mirrored from the CI path
filters that already enumerate this surface) instead, kept alongside the
old heuristic rather than replacing it, and documented the tradeoff in the
script's own docstring.

## Design decision on #10: why claim_comparison always wins over ownership_math

`claim_comparison.compare_claims`'s own test suite
(`test_overlapping_competing_owners_enter_adjudication`) establishes that
two different owners of the same subject+predicate with overlapping valid
time classify as `apparently_conflicting` regardless of `disjoint_group`
qualifiers -- compare_claims has no concept of disjoint groups. That means
a same-hop "sum multiple direct owners, block only if they'd exceed 100%"
guard using `ownership_math.InterestRange.add` can never fire in practice:
any second direct owner claim is intercepted by the contradiction gate
first and routed to human adjudication. Built (then removed) that guard
before recognizing it was dead code under the existing conflict semantics
-- see the two OwnershipMathError/InterestRange-based helpers that got
replaced by `_check_interest_claim` (validates a single claim's own range)
plus `compute_ownership_interest` (serves real multi-hop indirect interest,
where ownership_math's path enumeration is actually exercised).

## Commands run

```
cd backend
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
uv pip install pytest pytest-asyncio aiosqlite ruff mypy
ruff check <touched files> && ruff format <touched files>
mypy --strict -p app.services.evidence_spine -p app.api.routes.wiki_evidence \
  -p app.models.evidence_api -p app.models.evidence -p app.services.evidence_policy \
  -p app.proof_suite.runner
python -m pytest -q tests/                      # 472 passed, 3 skipped, 16 pre-existing failures
PYTHONPATH=. python scripts/check_proof_suite_clean_room.py app   # exit 0
```

The 16 `tests/` failures (rust_algorithm_ports, chroma_topics_fallback,
country_mentions, persistence_embedding, scroll_personalization,
extraction_image_flow) are pre-existing and environment-related (missing
compiled Rust extension, no live network/Chroma server in this sandbox) --
confirmed unrelated by diffing against `git stash` on the same tree before
this work started. Backend-root-level test files (`test_pagination.py`,
`test_source_profile_extractor.py`, `test_verification_agent.py`) have
similar pre-existing failures, also unrelated to this change.

Also exercised the new alembic migration directly against a real sqlite
table (upgrade -> downgrade -> re-upgrade, idempotent both ways) since
`alembic upgrade` itself requires a live Postgres this sandbox doesn't
have (no docker, no running `psql` server, no `sudo`).

## Assumptions and risks

- Assumed CI's `.github/workflows/evidence-spine.yml` path filter list is
  authoritative for "what counts as evidence-spine pipeline code" and used
  it as `PIPELINE_ALLOWLIST`'s source -- if that workflow file drifts from
  the real pipeline surface, so does the scanner's coverage. Kept as a
  documented, visible tradeoff (see script docstring) rather than a silent
  gap.
- The new alembic migration's `down_revision` will need adjusting if PR
  #14's `20260720_0002` merges first (see above).

## Remaining blockers (issue #13, real work outside agent capability)

Cannot supply, and did not fabricate:

- Actual retrieved filing snapshots for the 20 public benchmark cases.
- Human-reviewed truth bundles pinned from those snapshots (scoop-proof-suite.md's own pin-from-snapshots rule requires a human sign-off).
- 5 hidden cases commissioned from an independent reviewer who didn't write the adapters.

These require real-world data acquisition and human review/sign-off by
design -- an agent producing them would defeat the entire point of the
clean-room and independent-reviewer requirements. What *is* now real:
`evaluate_case_against_database` can execute the 15 assertions against
actual materialized DB state once a real truth bundle exists (tested
end-to-end against synthetic fixture data, including proving it correctly
*fails* a wrong truth bundle rather than rubber-stamping any input).
