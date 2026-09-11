# Known Errors

## 2026-09-03: object-literal prototype pollution in source maps

- Symptom: `mapBackendArticles` throws `TypeError: value.trim is not a
  function` for articles whose `source` is a name like "toString",
  "constructor", or "hasOwnProperty".
- Cause: `Record<string, string>` lookup `countryMap[source]` on an object
  literal inherits `Object.prototype`; `countryMap["toString"]` returns the
  inherited function, which flows into `normalizeCountryCode` -> `.trim()`.
- Fix: convert literal maps to `Map<string, ...>(Object.entries({...}))` with
  `.get(key) ?? fallback` (also satisfies anti-slop no-unsafe-dictionary).
- Lesson: never index object literals with untrusted strings; Map or
  `Object.hasOwn` guard is the default.

## 2026-09-03: oxlint prefer-readonly-parameter-types false positives

- The rule flags `Readonly<StreamRuntime>`-style params even though every
  member is readonly-declared: it treats function-typed members as mutable
  unless `treatMethodsAsReadonly: true`, and flags inferred map-callback
  params unless `ignoreInferredTypes: true`. With both options plus a scoped
  allow-list (`from: "lib"` for libs, `from: "file"` for project types) the
  noise goes to zero while explicit non-readonly params stay enforced.

## Frontend API schema `.optional()` rejects backend `null` values

Symptom:

```txt
[WARN] fetchSources received malformed payload        (frontend console)
```

with a grid that renders trending/breaking cards but an empty browse
section, lead "Loading coverage...", LIVE ARTICLES 0 / LIVE SOURCES 0 /
BIAS UNKNOWN / SIGNAL UNKNOWN. Network shows all 200s.

Cause: FastAPI emits `null` for unset dimensions (e.g.
`credibility_score: null`, `factual_rating: null` on every source). zod
`.optional()` accepts `undefined` but NOT `null`; one null anywhere fails
the whole array parse. The frontend then silently falls back to `[]`.

Fix:

- Schema fields that the backend can null: use `.optional().nullable()`.
- Mappers feeding typed functions: coalesce with `?? undefined` before
  handing to `number | undefined` / `string | undefined` parameters.
- Checked on 2026-09-03: `/news/sources` (all 261 entries), `/cache/status`
  (clean), `/trending` (already nullable'd), blindspot viewer (already
  nullable'd), `/news/index/cached` (10k articles, clean).

Check:

```bash
curl -s https://api.jordandgreen.com/news/sources | python3 -c \
  "import json,sys; d=json.load(sys.stdin); \
   print(any('credibility_score' in s and s['credibility_score'] is None for s in d))"
# True -> frontend schema must allow null for that field
```

## Backend worker killed by WORKER TIMEOUT every ~184s (event loop blocked by sync I/O)

Symptom:

```txt
[CRITICAL] WORKER TIMEOUT (pid:...)   # exactly ~184s after boot
[ERROR] Worker (pid:...) was sent SIGKILL! Perhaps out of memory?
```

API requests take 28-30s+ or time out; the frontend stays on "Loading
coverage..." / "Indexing articles..." despite the RSS refresh log showing
"RSS ready: N articles".

Cause (VERIFIED 2026-09-03): several startup/background async tasks called
synchronous I/O directly on the event loop: the embedding worker's sync
`vector_store.batch_add_articles` (which is a synchronous httpx POST to the
embedding service), sync `embedding_model.encode`/`search_similar` calls in
routes and workers, and direct sync `llm_client.chat_completions_create`
calls (LLM backends with long timeouts; one stuck sync HTTPS write was
observed with Send-Q 84KB). Each call blocked the loop up to the 120s
gunicorn timeout -> SIGKILL -> the cycle repeated every 3 minutes.

Diagnosis recipe:

```bash
# Confirm the hang window and cadence
ss -tnp | grep <worker_pid>          # stuck Send-Q or SYN-SENT socket
for t in /proc/<pid>/task/*; do cat "$t/wchan"; echo; done   # futex/poll state
```

Note: `py-spy` is NOT installed in the backend venv; `strace` attach is
blocked by ptrace restrictions on this machine. Socket + wchan inspection is
the reliable fallback.

Fix:

- Move every sync I/O call behind `asyncio.to_thread` (the pattern
  `services/chroma_sync.py` already used). Covered: persistence embedding
  batch, search routes, blindspot viewer, chroma topics, and all direct LLM
  call sites (material interest, article analysis, inline definition, queue
  digest, source analysis scorer, funding researcher).
- Keep the event loop free of sync network calls for Chroma (8001), the
  embedding service (8002), Postgres, and external LLM APIs.

Check:

```bash
cd backend && uv run pytest tests/test_embedding_batch_loop_block.py -q
# plus: curl -m 3 http://localhost:8000/news/index/cached?category=all
# through a full refresh cycle (~5 min) - responses must stay sub-second and
# the worker pid must survive past +184s.
```

## Category sentinel "all"/"All" returns zero articles

Symptom:

```txt
GET /news/index/cached?category=all   -> {"articles": [], "total": 0}
GET /news/stream?category=All          -> "Successfully loaded 0 articles from 0 sources"
```

Cause: category-filtered routes treat the UI's "all" sentinel as a literal
category name; no article/source matches it.

Fix: `app/core/filters.py::normalize_category` (maps "all"/"" to None,
preserves real category names case-sensitively) applied at every route entry
that accepts `category` (news page/index/recent routes, news stream,
blindspot viewer). The frontend already omits the sentinel for its browse
index, but the public API must accept it.

Check:

```bash
curl -s 'http://localhost:8000/news/index/cached?category=all' | jq '.total'  # 10000
curl -s -N 'http://localhost:8000/news/stream?use_cache=true&category=All' | head -1  # starts with "initial" and articles
```

## Repo-pinned oxlint appears to hang (>280s) on a single file

Symptom:

```txt
PATH="$PWD/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix <file>
```

never completes; multiple `tsgolint headless` processes run at ~98% CPU.
Observed 2026-09-02 (90-minute worker; three 40-minute workers from two
attempts).

Cause (VERIFIED 2026-09-02): STALE tsgolint WORKERS owned by previously
killed/timeout oxlint runs keep running and hold the type-aware channel. New
oxlint runs stall behind them. The pinned oxlint itself completes a scoped
run in under a second once the stale workers are gone.

Fix:

```bash
pkill -f 'tsgolint headless'
```

then rerun oxlint. Add the sweep to any watchdog script. The earlier
"wrong tool version" theory was disproven; the hook already uses the
repo-pinned binary.

## `scripts/check-complexity --report PATH` overwrites PATH with findings JSON

Symptom: a source file passed as `--report` destination became `[]`
(empty findings array); confusing "corrupted file" events.

Cause: `--report PATH` is the REPORT DESTINATION, not a source path; the
script writes the hard-violation rows JSON there (defaults to a temp file).

Workaround: never pass a source file as the report destination; use
`--report /tmp/report.json --path <source>`.

## The Edit tool cannot match literal `<SM:FIND>` text in file content

Symptom: edit payloads that must quote a line containing a literal
`<SM:FIND>...` tag (e.g. after a botched edit left marker text in a file)
keep failing with "Operation 1 has <SM:FIND> but no <SM:PUT>."

Workaround: patch those regions with a small Python script (read, replace,
write) instead; the Edit tool's XML wrapper cannot represent the literal tag.

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
- The readonly-parameter codemod must treat a mutating array call or direct
  array handoff as unsafe. Keep the mutation detector returning `true` for an
  unsafe use; TypeScript will catch the resulting `.push()` breakage, but the
  codemod should filter it before writing.
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

## 2026-09-11 — Recursive DeepReadonly is unsafe for Three.js runtime objects

Symptom:

Applying `DeepReadonly` to globe setup parameters caused TypeScript errors for
Three.js texture `mipmaps` and left the readonly-parameter diagnostics unchanged.

Cause:

The mapped type recursively converts mutable Three.js arrays and class fields to
readonly values, while the runtime helpers intentionally configure, dispose, and
update those objects.

Fix:

Revert the recursive mapping. Define narrow capability or view interfaces for
read-only consumers before changing the globe boundary; do not cast or suppress
the resulting type errors.

## 2026-09-11 — Full quality verifier can exceed the practical gate window

Symptom:

`scripts/self-test` reached `node scripts/quality-hardening.mjs verify --scope repo`
and produced no output for ten minutes while its type-aware worker remained CPU-active.

Handling:

Stop the unbounded run with exit 130 after retaining its direct census and independent
gate results. Report the self-test as incomplete; do not convert targeted frontend
passes into a repository-wide completion claim.
