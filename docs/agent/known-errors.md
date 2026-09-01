# Known Errors

## Atlas shows a raw datetime validation error instead of the graph

Symptom:

```txt
Invalid datetime at edges.*.valid_from, edges.*.last_verified_at, or evidence_preview.*.retrieved_at
```

Cause:

- PostgreSQL stores UTC datetimes without timezone data in this project.
- FastAPI serializes those values as ISO strings without a trailing offset, while the original Atlas Zod schema required an explicit offset.

Fix:

- Parse Atlas dates through `AtlasDateSchema` in `frontend/features/intelligence-atlas/lib/atlas-schema.ts`.
- Preserve explicit offsets and append `Z` only when a valid ISO datetime has no offset.
- Keep the regression case in `frontend/features/intelligence-atlas/tests/atlas-schema.test.ts`.

## Runtime evidence fills local storage

Symptom:

```txt
Files under runtime-data/logs keep growing while observability or tracing runs.
```

Cause:

- A JSONL writer appends resource samples, traces, or debug events without size-based rotation.

Fix:

- Write runtime records through `app.core.jsonl.append_jsonl`.
- Keep `THESIS_LOG_MAX_BYTES` and `THESIS_LOG_BACKUP_COUNT` at bounded positive values. The defaults are 25 MiB and three backups.
- Keep process IDs in per-process log names so workers do not rotate the same file.

## RSS refresh appears stuck before articles become visible

Symptom:

```txt
The cache stays at its startup count while feed and image requests continue for about a minute.
```

Cause:

- Older refresh code waited for Open Graph image extraction before publishing parsed articles.
- A full refresh also rebuilt and sorted the full cache once for every source.

Fix:

- Publish the full parsed batch with one `NewsCache.update_cache` call.
- Run image extraction and persistence after publication.
- Start all configured feed URLs concurrently and derive the primary request deadline from the slowest prior successful request plus one second.
- Keep cached articles for sources that time out, then retry those sources after publication with the full 25-second limit and merge late results.
- Measure remote fetch, parse, local publish, and post-publish work as separate stages with `backend/tests/benchmarks/measure_rss_readiness.py`.

Check:

```bash
cd backend
PYTHONPATH=. uv run python tests/benchmarks/measure_rss_readiness.py --wait-for-enrichment
```

## Backend virtualenv missing tools

Symptom:

```txt
backend/.venv/bin/mypy: No such file or directory
```

Cause:

- Backend virtual environment was not created or dependencies were not installed.

Fix:

```bash
./runlocal.sh setup
```

## PostgreSQL not running locally

Symptom:

```txt
Postgres is not running at localhost:5432.
```

Cause:

- Local PostgreSQL service is stopped.

Fix:

```bash
sudo systemctl start postgresql
```

## Asyncpg localhost DNS timeout in sandbox

Symptom:

```txt
asyncpg.connect ... loop.getaddrinfo(host, port, ...) ... TimeoutError
```

Cause:

- A DB-backed verifier ran inside the Codex network-restricted sandbox using a `localhost` database host.
- Async DNS resolution for `localhost` can hang or time out before the local PostgreSQL connection is attempted.

Fix:

```bash
DATABASE_URL=postgresql+asyncpg://newsuser:newspass@127.0.0.1:5432/newsdb uv run python <db-backed-script>
```

If the sandbox still blocks local DB access, rerun the exact verifier outside the sandbox with approval.

## ChromaDB version or state mismatch

Symptom:

```txt
ChromaDB* version mismatch / startup failures with existing local state
```

Cause:

- Existing `.chroma` state incompatible with current runtime/library version.

Fix:

```bash
rm -rf .chroma && docker-compose restart
```

Note: use this only when local disposable Chroma state reset is acceptable.

## Cloudscraper auto-refresh hang on 403 challenge pages

Symptom:

```txt
enrich_local_reporter_author_pages.py hangs while probing Cloudflare-blocked author/article pages
```

Cause:

- The `VeNoMouS/cloudscraper` 403 auto-refresh path can retry or wait too long on Cloudflare challenge pages from this environment.
- Axios, Report.az, Bloomberg, and NewsNation still returned blocked/challenge responses during live reporter enrichment tests.

Fix:

- Keep Cloudscraper fallback bounded with `auto_refresh_on_403=False` and no 403 retry loop.
- Leave generic 403 bypass disabled unless a targeted test sets `THESIS_CLOUDSCRAPER_GENERIC_BLOCKS=1`; Bloomberg generic 403 probing hung in live testing.
- Keep `THESIS_CLOUDSCRAPER_HARD_TIMEOUT_SECONDS` set or defaulted so the fallback returns the direct fetch outcome with `fallback_error=cloudscraper_timeout`.
- Record the blocked URL as `access_barrier` plus `fallback_error`; do not treat it as a missing author-page signal.

## Quality-hardening integration hazards

- `next/font` loaders must be separate module-scope constants. Combining
  multiple loader calls in one declaration makes the Next build fail.
- `react18-json-view` imports `src/style.css`; a typo in that path is a build
  failure, not a harmless style omission.
- The Unicode-regexp mechanical codemod must operate on AST regex literals.
  A text scan can rewrite URL paths, imports, and JSX closing tags.
- The backend cycle check must remain clean. Shared evidence-table metadata
  belongs in `backend/app/models/evidence_tables.py`, which neither the
  database module nor the evidence model imports back through.
- `scripts/check-crap.mjs` validates the upstream JSON report status as well as
  the subprocess status, because a successful process can still report a
  failed threshold gate.
- The stop-hook must use the repository-pinned frontend Oxlint binary. The
  global Oxlint 1.71 binary does not register the React rules used by the
  pinned 1.80 configuration and fails before linting. The hook now resolves
  `frontend/node_modules/.bin/oxlint` first and prepends its bin directory so
  `tsgolint` is available.
- `scripts/tsconfig.json` must explicitly include `types: ["node"]` when its
  compiler is invoked from the repository root. A root TypeScript installation
  otherwise ignores the Node declarations stored under the frontend package.
- The root Next layout must use `next/script` children for the appearance
  bootstrap. Direct `dangerouslySetInnerHTML` violates the shared AST-grep
  rule; the `Script` path preserves the blocking inline behavior without raw
  HTML injection.
## Repo-wide quality gate is still red after focused repairs

Symptom:

`./verify.sh` and `scripts/self-test` do not reach a fully green repository
because the strict lint, metric, backend regression, schema-parity, dead-code,
and duplication checks still have findings. The frontend TypeScript compiler,
frontend Jest suite, CLI checks, dependency-cycle check, and CCCC hard gate are
currently green.

Fresh census (2026-09-01, superseded by the unified closure census below):

- CCCC: 0 hard violations across 10,036 functions in 587 files. The hard rule
  is `CC > 10` or cognitive complexity `> 15`; this is a floor to preserve.
- Strict Oxlint: 13,698 errors and 341 warnings across 147 files. The largest
  error families are readonly parameter types (2,468), magic numbers (1,575),
  JSX depth (1,146), variable ordering (1,093), ternaries (813), function
  style (716), strict booleans (602), and one-var declarations (531).
- Maintainability index: 3,824 functions, 233 below MI 50, 494 warnings below
  MI 60, and a minimum of 12.8 across 83 failing files.
- CRAP: 2,562 methods in the coverage-first report; 1,316 are measured and
  1,246 are unmeasured. Sixty-eight measured methods exceed the configured
  threshold of 30; the maximum is 110. Unmeasured methods are a coverage
  problem, not evidence that the code is safe.
- Backend Ruff: 30 findings, mostly missing docstrings, plus an undefined
  `rows_inserted`, an unused import, a simplifiable loop, and a deprecated
  `Callable` import.
- Backend tests: 723 passed, 10 failed, and 3 were deselected. All failures
  are in `tests/test_propaganda_scorer.py`; `SourceAnalysisScorer.score_source`
  calls `_llm_score_axes`, but the method is outside the class after an
  indentation/refactor regression.
- CLI schema parity fails because generated OpenAPI descriptions differ from
  the current news route declarations. CLI typecheck, CLI tests, import
  resolution, dependency cycles, and frontend Jest pass.
- Dead-code analysis reports 105 unused exports, 3 duplicate exports, 1 unused
  development dependency, and 11 configuration hints. Duplication reports 95
  clone groups and 1.11% duplicated code; the command exits 0 but remains a
  cleanup target for the campaign.
- The repo-wide `anti-slop/no-module-mocking` rule is still an Oxlint error.
  The application/test scan found zero forbidden module-mocking calls. Rule
  fixtures are the only intentional invalid examples. Tests must render real
  components and run production modules with representative typed inputs;
  boundary injection is allowed for deterministic network, fetch, or browser
  I/O, but not to replace the component or implementation under test.

Latest unified census (2026-09-01):

- CCCC is 0 hard violations across 10,221 functions.
- Strict Oxlint is 13,118 errors and 341 warnings across 147 files. The
  largest families are readonly parameter types (2,551), magic numbers
  (1,508), JSX depth (1,123), variable ordering (1,120), ternaries (765),
  function style (692), strict booleans (570), and one-var (538).
- Maintainability is 3,884 functions, 230 below MI 50, 499 below MI 60, and
  minimum MI 12.8.
- CRAP is 2,630 methods, 1,222 covered methods, 1,408 N/A methods, 51 above
  threshold 30, and maximum 110.
- Backend Ruff and formatting pass; backend tests pass 735 with 3 deselected;
  OpenAPI export and CLI schema parity pass. Frontend TypeScript, Jest,
  build, imports, CLI checks, and dependency cycles also pass.

Do not restart cleanup from the first reported line. Use the owned work
packets in the current handoff: fix all applicable rule families in a file,
then run its behavior tests and metric probes before moving to the next slice.

Do not lower thresholds, add exclusions, add suppression comments, or replace
real behavior with mock modules or mock components. The work is a coordinated
closure campaign, not a sequence of unrelated one-file lint edits:

1. Repair the `SourceAnalysisScorer` class-boundary regression and the OpenAPI
   description drift. Run backend tests and `npm run cli:schema:check` before
   metric cleanup so behavior and generated contracts are stable.
2. Keep CCCC at zero while fixing the strict Oxlint findings in disjoint
   ownership slices. Start with the largest files and rule families, but apply
   semantic changes for JSX depth, strict types, function style, and React
   effects instead of blindly formatting them.
3. Refactor the highest-CRAP and lowest-MI functions together. Add or improve
   behavior coverage with real production modules and representative payloads;
   coverage changes must be tied to a behavior assertion, not a mock-only test.
4. Re-run dead-code and duplication checks after exports and component
   boundaries settle. Remove an export or dependency only after checking all
   repository references.
5. Integrate by running `scripts/self-test`, then `./verify.sh` and the direct
   metric commands. A targeted pass is not completion while a repo-wide gate
   remains red.

The next work packets are: backend behavior/schema repair; frontend
component/app lint and metric slices; frontend library/hooks lint and metric
slices; scripts lint/type safety; test-confidence and coverage improvements;
and a final integrator pass. Each packet owns explicit files, records its
before/after metrics, and must leave the full verification command runnable.
