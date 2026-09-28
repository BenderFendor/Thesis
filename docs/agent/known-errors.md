# Known Errors

Current (2026-09-29): Rust exposes 143/178 HTTP operations: 106 parity-proven,
37 registered but unverified, 35 unregistered; public cutover remains 0%.
B04 `GET /debug/database/articles` is registered but remains unverified.
Rust lineage number extraction retains a Python/Rust Unicode parity gap.
B16 proof download remains unregistered because `backend/Cargo.lock` has no
ZIP writer and Cargo resolution/runtime verification are unavailable under the
hard no-Cargo gate. FastAPI remains public; Atlas/materialization parity and
runtime proof remain open. Localhost export baseline failed.

## 2026-09-29: B14 wiki index-status parity remains unverified

`GET /api/wiki/index/status` uses the existing `Database::wiki_index_entries`
read path. FastAPI's nullable `status` field becomes a `None` key in
`dict[str, int]`, which fails response validation with HTTP 500; the Rust shadow
now returns 500 instead of inventing an empty-string bucket. A production-path
differential also covers successful grouped counts, but it was not run under
the no-Rust-runtime gate. The route was already root-registered and remains
`migrated:false`; FastAPI stays public.

## 2026-09-29: Rust evidence claim materialization remains unverified

The root router and central `ApiDoc` register
`POST /api/wiki/evidence/claims/{claim_id}/materialize`; the inventory row
remains `migrated:false`. It reads `SCOOP_MATERIALIZE_TOKEN` from the process
environment, requires `X-Scoop-Reviewer`, reuses the existing DB materializer,
and reloads the exact relationship. The success log contains claim ID, reviewer,
and relationship ID, but never the token. Three focused source tests and the
OpenAPI assertions were added but not run while the shared Cargo gate is closed.
Transaction-boundary risk is unresolved: FastAPI `get_db` commits only after
the handler returns and rolls back exceptions. Rust's
`Database::materialize_claim` commits before the relationship reload/response
conversion, so a later failure can return 500/422 with the write persisted;
FastAPI would roll it back. The materializer also commits an adjudication item
before returning `EvidenceSpine` on a conflict
(`backend/crates/thesis-db/src/atlas_materialization.rs:701-715`), so Rust can
return 422 with the item persisted while FastAPI raises and `get_db` rolls it
back. Scope forbids thesis-db edits; keep the route shadow-only and
`migrated:false`.

Database behavior, mounted HTTP behavior, and FastAPI parity remain unverified;
FastAPI remains public. See
`.agent/traces/rust-evidence-claim-materialize-2026-09-29.md`.

## 2026-09-29: Rust evidence proof download remains blocked

FastAPI builds the complete deterministic proof archive through
`build_bundle_files` and `zip_bundle`
(`backend/app/services/evidence_export.py:252-260`). The current
`backend/Cargo.lock` has no `zip`, `async_zip`, or `zip_next` writer. The task
gate forbids Cargo dependency resolution and runtime verification; no custom
ZIP implementation, partial response, or generated-lockfile edit is allowed.
Keep the operation `rust_registered:false` and `migrated:false`; FastAPI remains
public. See `.agent/traces/rust-debug-startup-2026-09-29.md`.

## 2026-09-27: Rust Atlas export remains unverified

The Rust router and central `ApiDoc` register `POST /api/wiki/atlas/export`;
the inventory row remains `migrated:false`. Ten source tests and the OpenAPI
assertions are unrun because the shared Cargo/Rust gate is closed. The source
uses `Bytes` plus `HttpValidationError` responses to return 422 for malformed,
invalid, and filter-validation bodies, but compiled HTTP behavior is unverified.
A read-only request bounded to one node and one edge failed with curl exit 7
because no listener was available at `127.0.0.1:8000`. No response headers,
status, or body were observed. FastAPI remains public; see
`.agent/traces/rust-atlas-export-2026-09-27.md`.

## 2026-09-26: Rust Atlas media-measurements remains unverified

The route and central `ApiDoc` registration are present, and the handler source
uses the shared typed Atlas media DTO and idempotent trace persistence. Cargo
build, tests, Clippy, and HTTP exercise were not run because the shared Cargo
lock gate is closed. This does not establish compiled behavior, persistence
idempotency at runtime, or parity with FastAPI. The inventory operation stays
`migrated:false`; see `.agent/traces/rust-atlas-media-measurements.md`.

## 2026-09-23: Ownership-interest transport and OpenAPI evidence

The initial ownership-interest differential seeded its disposable PostgreSQL
database, but a stale Rust listener binary returned 404. Rebuilding the shadow
server superseded that historical result: the current HTTP differential passes
one pytest with four pre-existing deprecation warnings.

Focused `thesis-evidence`/`thesis-db`/`thesis-api` tests passed 45 cases
(18 thesis-api + 9 thesis-db + 18 thesis-evidence), the workspace passed 149
tests (34 rss_parser_rust + 18 api + 9 db + 18 evidence + 16 ingest + 54
search), strict Clippy and formatting passed, and
`cargo build -p thesis-server` passed. The OpenAPI compatibility checker passed
all seven Rust operation IDs. The exact finite-decimal kernel is in
`thesis-evidence`; SQLx loads non-retracted `owns_equity_in` and
`directly_owns` rows, preferring `pct` over `pct_band`; malformed or
unquantified qualifiers are skipped and domain errors surface. FastAPI remains
public.

The ownership-interest slice has no new formal model run. `tlc`, `lean`, `lake`,
`verus`, and `cargo-kani` were unavailable; Java existed, but `TLA_TOOLS_JAR`
was unset and no repository TLA+ jar was present.

## 2026-09-23: Historical ownership-interest self-test checkpoint

An earlier `scripts/self-test` exited 1 after 141.641 seconds at
`quality-hardening`, before the Rust gates. Backend mypy reported 25 errors in
18 files; Ruff formatting was required for 10 files; the frontend suite had
206 of 207 tests passing with one failing suite; and the backend had 779
passing, 4 deselected, 3 failures, and 9 warnings. This checkpoint is
historical and is superseded by the final 132.26-second self-test entry below.
It does not invalidate the separately passed ownership-interest Rust checks;
the Rust gates were not reached by that earlier run.

## 2026-09-23: MinHash grouping used lossy identity and overlapping groups

Symptom: exact grouping keyed article text by MD5, and matching one document
from another existing group could leave overlapping groups in the result.

Cause: the old reducer inserted a matched representative into one group
without merging the second group's existing members.

Fix: group exact text by its full value and union duplicate-link components.
The representative is the first input ID in each component. The unused Python
facade also returned the requested threshold as a similarity score; the Rust
binding returns the estimated score.

Check:

```bash
cargo test --manifest-path backend/Cargo.toml -p thesis-search
cd backend && .venv/bin/pytest -q tests/test_rust_algorithm_ports.py
```

## 2026-09-23: cargo-mutants copies ignored nested build targets

Symptom: a mutation run stops with `No space left on device` while copying a
crate-local `target/` directory into its temporary workspace.

Cause: cargo-mutants copies ignored build outputs unless the repository's
ignore rules are applied to the scratch copy.

Fix: pass `--gitignore true` to cargo-mutants. Do not combine that option with
an explicit `--copy-target` value; the CLI treats them as incompatible.

Check:

```bash
cargo mutants --manifest-path backend/Cargo.toml --package thesis-ingest \
  --file crates/thesis-ingest/src/source_url_guard.rs --gitignore true \
  --jobs 2 --timeout 30
```

## 2026-09-23: Kani expansion through owned evidence strings and vectors

Symptom: CBMC spends minutes exploring allocator and string-library paths when
a Kani harness constructs `ObservationEvidence` and `PredicatePolicy` values.

Cause: the full service-boundary evaluator owns `String` and `Vec` data.
Those allocation paths obscure the small acceptance predicates that Kani can
exhaustively check quickly.

Fix: collect typed facts at the boundary, then call the production
allocation-free decision kernel. Keep SQLx and string parsing outside the
harness. The kernel proof is narrower than the full evaluator and must be
reported that way.

Check:

```bash
cargo kani --manifest-path backend/Cargo.toml -p thesis-evidence --default-unwind 4
```

## 2026-09-11: OpenCode Zen free requests need session attribution

Symptom:

```text
401 ModelError: Model ... is not supported
MissingSessionID: OpenCode's free tier can only be used in OpenCode
```

Cause: OpenCode Zen's OpenAI-compatible endpoint still expects the client to identify the
session and request. A bare `ChatOpenAI` or `OpenAI` client sends neither `x-opencode-session`
nor the related client attribution headers. Model ids also rotate; a model can remain in the
catalog after its upstream provider becomes unavailable.

Fix: use `get_opencode_headers()` from `app.core.config` for every OpenCode client. Research
runs pass a generated session id, while shared service clients use the process session. Keep
`OPENCODE_MODEL` on a current id from `https://opencode.ai/zen/v1/models`; the configured free
model can still return a provider rate limit that code cannot clear.

Check:

```bash
cd backend && uv run pytest tests/test_llm_backend_opencode.py -q
```

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

## 2026-09-11 — Full quality verifier repeated expensive analyzers

Cause:

`measureRepository` already runs CCCC, code-multivitals, split-policy Oxlint, and CRAP, while
the repository verification profile ran those analyzers again through separate checks. The
code-multivitals `analyse` API also performs whole-project O(n²) clone detection even when the
caller only needs per-file maintainability metrics.

Fix:

Use `analyseFile` for maintainability-only checks, use the measurement's CCCC/Oxlint/CRAP/MI
results as the repository analyzer gates, and run the remaining independent checks through a
bounded four-worker pool. Set `THESIS_VERIFY_CONCURRENCY` to tune the pool when the host has a
different resource budget. `verify.sh` now resolves and enters the repository root before it
starts the optimized verifier.

## 2026-09-23 — Rust slice checks pass while repository self-test remains red

`scripts/self-test` reached the repository quality gate and stopped before the
Rust commands. The JSON report showed 141 code-multivitals findings, the
2,198-line `backend/news_research_agent.py` over its 2,081-line debt cap, 25
mypy errors in 18 files, three backend failures (two article canonical-key
cases and reporter profile coverage), and one frontend inline-edit failure
because the test lacks app-router context. The report also lists repository
dead-code findings and nine other files requiring Ruff formatting. It listed
the two new differential tests before they were formatted; their focused Ruff
format and lint checks now pass.

Do not lower quality thresholds or treat focused passes as a repository-wide
pass. The figures above and the 56-test evidence-slice result are the earlier
baseline; they do not describe the later ranking slice. The 2026-09-23 ranking
follow-up is recorded below.

## 2026-09-23 — Ranking slice follow-up

The latest watchdog-wrapped `scripts/self-test` exited 1 after 125.464 seconds
at `verification repo: failed`, before `verify.sh` reached Rust checks. The
watchdog output did not include a refreshed issue census, so the detailed
counts above remain historical. Direct Rust workspace checks passed with 61
tests; the two-operation OpenAPI comparison and 20-request FastAPI/Axum
differential passed; evidence and search Kani runs passed five and two
harnesses respectively. The new differential test and OpenAPI checker pass
focused Ruff lint and formatting, and the checker is executable. Re-run the
repository self-test after the repo-wide quality findings are repaired.

## 2026-09-23 — Latest Rust migration verification

The repository run still exits 1 in its quality gate. Its latest measurement
records 141 code-multivitals violations. The configured backend suite reports
763 passed, 4 deselected, and 3 failed:

- `test_browse_and_cached_articles_share_canonical_keys`: browse and cache
  serializers return different key sets.
- `test_semantic_search_wraps_a_canonical_article_without_aliases`: the test
  expects an `ArticleResult`, while the service returns a dictionary.
- `test_reporter_coverage_uses_lazy_session_factory`: the expected citation
  count is 1, while the service returns 0.

The frontend suite also fails
`frontend/__tests__/search-inline-edit.test.tsx::newsResearchPage inline
editing`; rendering reaches `useRouter` without a mounted App Router. All four
failures reproduce when run alone. They are outside the changed Rust migration
files and remain open; do not report the repo-wide self-test as passing.

The direct Rust format check, strict Clippy, and full workspace tests pass; the
workspace now has 84 tests. The normalized OpenAPI check passes for both migrated
operations. `scripts/check_openapi_compat.py` passes Ruff lint/format and its
help command, and has mode 755. The repo-wide measure also reports Oxlint with
zero errors and warnings, CCCC with zero violations, and TypeScript CRAP with
zero violations. These focused results do not clear the code-multivitals or
test failures.

## 2026-09-23 — Country matcher self-test rerun

The latest `scripts/self-test` run exited 1 after 128.339 seconds because
`node scripts/quality-hardening.mjs verify --scope repo` returned
`verification repo: failed`; `verify.sh` therefore stopped before its Rust and
OpenAPI commands. Measurement `qh-measure:35a61304d4c4e6b72c47a538` records
141 code-multivitals violations, with CCCC 0, Oxlint 0 errors and warnings, and
TypeScript CRAP 0. The watchdog output only retained the wrapper error, so this
run did not refresh the individual Python or frontend test failures listed above.
Direct Rust format, strict Clippy, and workspace tests passed separately with
84 tests; the country PyO3 suite passed six tests.

## 2026-09-23 — Rust formal-coverage self-test

The latest `scripts/self-test` exited 1 after about 84 seconds at
`verification repo: failed`, before Rust and OpenAPI checks. Measurement
`qh-measure:f17c217311a4c20265d88093` reports 141 Code Multivitals violations;
CCCC, Oxlint, and TypeScript CRAP pass with zero findings. The quality scope
does not include `backend/crates` or `backend/rss_parser_rust`. The workspace
format check, strict Clippy, all 95 Rust tests, and the RSS crate Kani harness
pass when run directly. This remains an open repository quality-gate failure.

## 2026-09-23 — Kani stalls on heap-backed lineage traversal

A symbolic two-node harness for `thesis-db::lineage_root` compiled, then ran
for more than 90 seconds without producing a proof result while exploring
`HashMap` and `BTreeSet` operations. It was interrupted and removed, so no
proof is claimed. Keep the function under its multi-parent and cycle tests and
database differential until a bounded pure kernel can be connected to the
production traversal without duplicating it.

## 2026-09-23 — Article comparison route self-test

The required `scripts/self-test` exited 1 after 149.127 seconds at
`bash ./verify.sh`. Running its first failing command directly,
`node scripts/quality-hardening.mjs verify --scope repo`, also exited 1 after
131.855 seconds with only `verification repo: failed`. The wrapper did not
refresh the measurement ID or print analyzer details. This repeats the open
repo-wide quality-gate failure above; direct Rust format, workspace tests,
strict Clippy, API OpenAPI comparison, and route differentials were run
separately for this change.

After the language-diagnostics cutover, `scripts/self-test` exited 1 again
after about 118 seconds at the same `verification repo: failed` preflight. It
did not reach the Rust/OpenAPI commands or refresh the detailed issue census.
The 121-test workspace run, strict Clippy, Rust formatting, three-operation
OpenAPI comparison, and six focused diagnostics tests passed when run directly.

After the evidence claim-read slice, `scripts/self-test` again stopped at
`node scripts/quality-hardening.mjs verify --scope repo` with
`verification repo: failed`, before `verify.sh` reached its Rust/OpenAPI
commands. This run printed no refreshed quality census. The direct workspace
run passed 125 tests, strict workspace Clippy passed, and the five-operation
OpenAPI comparison plus disposable PostgreSQL differential passed separately.

## 2026-09-23 — Evidence relationship slice verification

The latest `scripts/self-test` again stopped at the repo quality gate before
Rust or OpenAPI commands. Measurement `qh-measure:ad6cc9097fb33a67e9ac835f`
records 141 code-multivitals violations. The direct backend suite completed
with 779 passed, 3 failed, and 4 deselected. Its failures remain
`test_article_contract::test_browse_and_cached_articles_share_canonical_keys`,
`test_article_contract::test_semantic_search_wraps_a_canonical_article_without_aliases`,
and `test_measure_wiki_profile_coverage::test_reporter_coverage_uses_lazy_session_factory`.
The Rust workspace passed 130 tests, strict Clippy passed, all six selected
OpenAPI operations matched, and the disposable PostgreSQL relationship
differential passed. These focused checks do not clear the repo quality gate
or the three backend failures.

## 2026-09-23 — Historical required self-test checkpoint

An earlier required `scripts/self-test` had a command-watchdog exit 1 after
141.641s at quality-hardening, before the Rust gates. Backend mypy reported 25
errors across 18 files; Ruff format reported 10 files, including the Rust
differential test; the frontend had one failing suite with 206/207 tests
passing; and the backend had 3 failures with 779 passed, 4 deselected, and 9
warnings.

Direct Rust fmt, Clippy, workspace, OpenAPI, and HTTP checks passed separately.
This checkpoint is historical and is superseded by the final 132.26s entry
below; it is not a Rust-slice failure.

## 2026-09-23 — Final self-test after ownership test extraction

The final required `scripts/self-test` exited 1 after 132.26s at quality-hardening, before Rust gates. The quality diagnostic exited 1 after 127.668s with `tracked_unchanged=true`: 19 checks had 13 passed and 6 failed. Source-line limits now have 1050 checked, 17 near, and only 2 over; `ownership.rs` and the differential test are no longer over. Dead-code analysis reports 13 unused exported types. Backend mypy failed, Ruff format reported 10 files, the frontend failed the Next App Router invariant, and backend tests failed on the canonical article key contract plus existing failures.

Direct Rust, OpenAPI, and HTTP checks still pass separately. This is the remaining repo-level blocker.

## 2026-09-25: Default FastAPI source-stats response validation fails

Symptom: a credential-free `TestClient(app, raise_server_exceptions=False)` call
to the current default `GET /news/sources/stats` returns status `500`, content
type `text/plain; charset=utf-8`, and body `b'Internal Server Error'`.

Cause: response validation against `SourceStatsList` reports 264 errors. All
261 configured sources have `last_checked: null`, but the response model
requires a string. Three `url` values are lists rather than strings:
`sources[11]` for New York Times, `sources[46]` for Bloomberg, and
`sources[60]` for The Nation.

Rust parity: `backend/crates/thesis-api/src/news_cache.rs` returns the same 500
text response if a cached source row has a non-string `last_checked` or `url`.
The FastAPI runtime result confirms the error this guard mirrors. No Python or
OpenAPI change was made.

## 2026-09-25: Root self-test stops before Rust gates

The watchdog-wrapped root `scripts/self-test` exited 1 after 107.369 seconds
without a timeout. It invoked `bash ./verify.sh` and stopped at the first
command, `node scripts/quality-hardening.mjs verify --scope repo`, which
reported `verification repo: failed`. Rust format, Clippy, workspace tests, and
OpenAPI gates were not reached.

A direct JSON diagnostic rerun exited 1 after 106.88 seconds with
`tracked_unchanged=true`. It reported 19 checks, 13 passed and six failed.
Measurement reported two CCCC violations and 141 code-multivitals violations.
Oxlint had zero errors and warnings; TypeScript CRAP passed.

The failed checks were:

- Source line limits: 1,098 files checked, 20 near the limit, 10 over. The
  over-limit files were `backend/crates/thesis-api/src/article_analysis.rs`
  (1,131), `backend/crates/thesis-api/src/cache_stream.rs` (1,088),
  `backend/crates/thesis-api/src/discovery/similarity.rs` (1,018),
  `backend/crates/thesis-api/src/entity_research.rs` (2,038),
  `backend/crates/thesis-api/src/jobs_image.rs` (1,186),
  `backend/crates/thesis-api/src/lib.rs` (1,398),
  `backend/crates/thesis-api/src/profiling.rs` (1,066),
  `backend/crates/thesis-api/src/source_catalog.rs` (1,068),
  `backend/news_research_agent.py` (2,198, above its 2,081 debt cap), and
  `backend/tests/test_rust_evidence_http_differential.py` (1,268).
- Dead code: 18 unused response-schema exports, 13 unused exported types, and
  11 Knip configuration hints.
- Backend mypy: 25 errors across 18 files.
- Ruff format: 20 files would be reformatted; 376 were formatted.
- Frontend tests: 1 failure and 206/207 tests passed. The failing case was
  `edits the selected message inline instead of filling the composer` in
  `__tests__/search-inline-edit.test.tsx`, under `newsResearchPage inline editing`.
- Backend tests: 6 failures, 847 passed, 1 skipped, 4 deselected, and 10
  warnings. Failing tests:
  `tests/test_article_contract.py::test_browse_and_cached_articles_share_canonical_keys`,
  `tests/test_article_contract.py::test_semantic_search_wraps_a_canonical_article_without_aliases`,
  `tests/test_measure_wiki_profile_coverage.py::test_reporter_coverage_uses_lazy_session_factory`,
  `tests/test_rust_core_contract.py::test_language_endpoint_validation_matches_strict_request_contract`,
  `tests/test_rust_entity_research_contract.py::test_rust_boundary_separates_provider_calls_from_cached_projections`,
  and
  `tests/test_rust_library_contract.py::test_library_openapi_contract_keeps_methods_bodies_and_statuses`.

The root self-test did not reach Rust gates. Separate 2026-09-25 verification
passed: the workspace run passed 247 tests (`thesis-api` 87 and `thesis-server`
6, with crate totals recorded in `docs/agent/testing.md`). The warning-denied
API/server check passed. Strict Clippy passed for `thesis-api` and
`thesis-server` with `--all-targets` and `-D warnings`. The B04 suite passed
five tests. Python contract/inventory pytest passed 10 tests with 9 warnings,
and the inventory JSON parsed.

The workspace run preceded the formatting-only provider change. After
formatting, focused rustfmt and workspace formatting passed; the six-test
provider suite, locked server build, and OpenAPI comparison for 106 operations
were rerun and passed. These separate results do not clear the root self-test
findings.

The B06 Python contract test, `backend/tests/test_rust_reading_queue_contract.py`,
received a local formatting repair after a focused Ruff format check reported
it needed formatting. Focused Ruff check and format checks passed afterward,
and `.venv/bin/pytest -q backend/tests/test_rust_reading_queue_contract.py`
passed 7 tests with 9 warnings. This local repair may address one file included
in the original repository-wide Ruff format result, but neither that result nor
the other failure classes was remeasured. The broad gate was not rerun, so no
repository-wide failure class is claimed cleared; the 20-file Ruff count
remains only the original diagnostic snapshot.

## 2026-09-25: B04 cache debug route is not live cache parity

`GET /debug/cache/articles` reads only its process-local `CacheStreamState`.
The production server starts with the default empty state and does not attach a
cache refresh provider or share the Python `NewsCache`. The route tests seed a
router-local cache and use a lazy database handle. They establish response
behavior for those seeded snapshots, not production cache contents, database
access, or RSS refresh behavior.

## 2026-09-25: B06 provider retry behavior differs

The Rust queue-digest provider sends one reqwest request and does not retry.
FastAPI OpenRouter and llama.cpp clients leave retries at the OpenAI SDK default
of two; its OpenCode client sets `max_retries=0`. Rust adapter tests use a local
fixture server, and the route tests inject a provider. No live external LLM
call was made, so these tests do not prove provider availability, completion
quality, or retry parity.


## 2026-09-26: Rust lineage number extraction differs on Unicode input

Python's `\d` and `\b` are Unicode-aware. Rust `lineage_numbers` uses ASCII byte
predicates, so source review predicts it matches `10` in CJK-adjacent strings
and does not match Arabic-Indic digits. The worker-reported Python probe returned
`{'中10文': [], '10文': [], '中10': [], '١٢': ['١٢'], 'س١٢': []}`.

This is an unresolved parity risk, not a verified Rust runtime result. The
percent-boundary regression covers ASCII examples only; Cargo verification
remains gated and was not run.

## 2026-09-28: Kani harness exhausted workstation memory

A Kani harness over `String`, `BTreeSet`, `HashMap`, and symbolic `Vec` lengths
drove CBMC to about 18 GiB while a full `cargo test` ran, nearly freezing a
31 GiB machine. Keep harness allocation sizes concrete, prove pure index
kernels instead of string-keyed builders, and run heavy jobs one at a time:
`systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 nice -n 10 cargo kani ...`.
Kani is installed at `~/.cargo/bin`, which may not be on `PATH`.

## 2026-09-28: thesis-api tests wait on lazy database timeouts

Tests that route through `Database::connect_lazy("postgres://user:pass@127.0.0.1/thesis")`
wait for the sqlx acquire timeout, so `cargo test -p thesis-api` takes about
90 s. `thesis-db` `#[sqlx::test]` tests need `DATABASE_URL`; a user-level
server works: `initdb -D <dir> -U postgres --auth=trust` then
`pg_ctl -D <dir> -o "-p 55432 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" start`.

