## 2026-07-21 20:31

**What happened:** Native Node TypeScript CLI initially compiled as CommonJS and produced 95 strict typing diagnostics after converting the schema-driven prototype from JavaScript.

---

## 2026-07-21 20:37

**What happened:** OpenAPI route parity test initially compared Starlette converter paths and intentionally hidden observability routes directly; use APIRoute.path_format and include_in_schema to compare the public contract.

---

## 2026-07-21 20:39

**What happened:** OpenAPI exporter worked as python -c before extraction but failed as a script because sys.path pointed at backend/scripts; invoke it as python -m scripts.export_openapi from backend.

---

## 2026-07-21 20:41

**What happened:** Backend CLI smoke server inherited LLM_BACKEND=llamacpp and failed before /health because the local llama.cpp server was offline; isolated smoke startup must set LLM_BACKEND=openrouter and disable database/vector services.

---

## 2026-07-21 20:56

**What happened:** Python DAP runtime evidence was unavailable because debugpy is not installed; ownership resolver debugging fell back to a bounded direct probe of the external response boundary.

---

## 2026-07-21 21:22

**What happened:** Targeted mypy from repo root produced import-not-found noise for app.*; backend checks must run from backend with MYPYPATH=. and --explicit-package-bases.

---

## 2026-07-21 21:32

**What happened:** Source-profile verification referenced nonexistent tests/test_entity_wiki_service_dossier.py; use glob to resolve exact test filenames before composing focused pytest commands.

---

## 2026-07-21 21:43

**What happened:** CLI formatting attempted frontend/node_modules/.bin/prettier, but this repository has no local Prettier binary; use TypeScript typecheck and existing source style instead.

---

## 2026-07-21 21:45

**What happened:** Curated organization investigation exceeded the CLI's 30-second default during multi-registry research; long research smokes require --timeout 180 while ordinary endpoint checks keep the 30-second default.

---

## 2026-07-21 21:49

**What happened:** A line-number edit to the organization normalizer targeted the argument line instead of the regex line and temporarily produced an invalid re.sub call; re-read the exact block before editing shifted multiline calls.

---

## 2026-07-21 21:53

**What happened:** A response-model field was first inserted between Pydantic classes instead of inside SourceResearchValue; inspect the class body range before adding schema fields near adjacent declarations.

---

## 2026-07-21 21:54

**What happened:** After Ruff reformatted a test file, the prior edit snapshot hash was stale; use the formatter result followed by a fresh anchored read before subsequent line edits.

---

## 2026-08-27 08:19

**What happened:** task subagents died instantly: 401 Model x-preview-f-free not supported; role model in ~/.omp/agent/config.yml was stale (opencode-zen/x-preview-f-free:max for task/commit/advisor)

**Probable cause:** opencode-zen provider dropped/renamed x-preview-f-free; config still referenced it

**Fix or workaround:** task/commit/advisor roles now deepseek/deepseek-v4-flash-vision-exp; verify subagent spawns after changing modelRoles

---

## [auto-mined] [pi]

**What happened:** Integration tests repeatedly hit rate limits (2x 429, 2x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [pi]

**What happened:** Process killed (OOM) during compilation.

**Probable cause:** Multiple agents compiling simultaneously (rustc + linker memory spikes).

**Fix or workaround:** Serialize cargo build/test across agents.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (11x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Maturin rebuild appeared to succeed but old .so persisted.

**Probable cause:** Python loaded cached .abi3.so from virtualenv; rebuild didn't overwrite the import path.

**Fix or workaround:** Use `maturin develop --release --force`. Verify .so timestamp changed. Check import path.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (19x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Agents collided on shared files (40x references to another agent's changes).

**Probable cause:** Multiple subagents editing the same file or crate simultaneously.

**Fix or workaround:** Assign disjoint file ownership in task specs. Watchdog should detect cross-agent file contention.

---

## [auto-mined] [omp]

**What happened:** Glob search timed out on broad pattern.

**Probable cause:** Pattern too broad for large monorepo; 5s timeout exceeded.

**Fix or workaround:** Narrow the glob pattern instead of retrying broadly.

---

## [auto-mined] [claude]

**What happened:** Integration tests repeatedly hit rate limits (24x 429, 7x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [claude]

**What happened:** Build succeeded but typecheck (`tsc --noEmit`) failed.

**Probable cause:** `next.config.ts` has `ignoreBuildErrors: true`, masking real TypeScript errors.

**Fix or workaround:** Run `npx tsc --noEmit` separately as a verification gate. Do not rely on `npm run build` for type safety.

---

## [auto-mined] [claude]

**What happened:** Integration tests repeatedly hit rate limits (16x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (96x 429, 5x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [claude]

**What happened:** Integration tests repeatedly hit rate limits (6x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [claude]

**What happened:** Integration tests repeatedly hit rate limits (52x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [claude]

**What happened:** Integration tests repeatedly hit rate limits (12x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [pi]

**What happened:** Integration tests repeatedly hit rate limits (6x 429, 6x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [pi]

**What happened:** Integration tests repeatedly hit rate limits (7x 429, 6x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## 2026-08-30 09:34

**What happened:** Repository orientation was blocked after several consecutive shell reads

**Probable cause:** The PreToolUse hook limits mixed non-symbolic read calls even when batched for startup inspection

**Fix or workaround:** Batch fewer shell reads and switch to Serena symbolic or pattern tools earlier

---

## 2026-08-30 09:51

**What happened:** Frontend package has no typecheck npm script, so the expected verification command fails before checking code

**Probable cause:** TypeScript verification exists only as a raw npx tsc command despite repository guidance requiring a type gate

**Fix or workaround:** Use npx tsc --noEmit now and add a canonical typecheck script when changing verification infrastructure

---

## 2026-08-30 10:00

**What happened:** Jest spyOn could not redefine ESM API exports while replacing banned module mocks

**Probable cause:** Bundler-style ESM namespace exports are immutable and non-configurable in the Jest transform

**Fix or workaround:** Expose a typed service boundary on the component and inject deterministic test implementations

---

## 2026-08-30 11:10

**What happened:** jscpd 5.0.16 native binary scans 0 files when the .jscpd.json ignore array contains frontend/ paths

**Probable cause:** Rust jscpd treats unmatched ignore globs as exclude-all; also requires -p pattern flag (positional paths don't scan)

**Fix or workaround:** Keep jscpd config without ignore field (CLI-side it worked) and pass -p '**/*.{ts,tsx,js,mjs,py,rs}' plus explicit dirs

---

## 2026-08-30 11:10

**What happened:** oxlint runs outside the repo's PATH setup fail with 'Failed to find tsgolint executable'

**Probable cause:** oxlint-tsgolint binary discovery is PATH-based; npm run lint prepends frontend/node_modules/.bin

**Fix or workaround:** Always run: PATH="/home/bender/classwork/Thesis/frontend/node_modules/.bin:/home/bender/.opencode/bin:/home/bender/llmmodels/llama.cpp/build/bin:/home/bender/.bun/bin:/home/bender/.local/share/pnpm:/home/bender/.npm-global/bin:/home/bender/.local/bin:/home/bender/.local/bin:/home/bender/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/opt/cuda/bin:/usr/lib/jvm/default/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl:/usr/lib/rustup/bin" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json <files>

---

## 2026-08-30 11:39

**What happened:** tsc does not flag unresolved @/ lib path imports (TS2307 missing) under moduleResolution=bundler

**Probable cause:** TS 5.9 bundler resolution with incremental build info: missing path-mapped modules resolve silently, no error, even with --noEmit full runs

**Fix or workaround:** Add explicit check: rg -n "from ['\"]@/" with module existence verification, or import checker; verify.sh should fail on unresolved @/ imports

---

## 2026-08-30 20:40

**What happened:** PR review diff assumed origin/master, but this checkout has no origin/master ref

**Probable cause:** Base ref was inferred instead of read from gh pr metadata

**Fix or workaround:** Read gh pr view --json baseRefName first, fetch that exact ref, then run three-dot diff

---

## 2026-08-30 20:47

**What happened:** Full frontend Oxlint produced no findings or progress output before a 240-second watchdog timeout

**Probable cause:** The new typed custom plugin plus repository-wide typed lint can stall or exceed the current gate budget

**Fix or workaround:** Run per-directory diagnostics to isolate the slow scope, then add bounded progress or split deterministic lint jobs

---

## 2026-08-30 20:50

**What happened:** GitHub workflow validation command failed because actionlint is not installed

**Probable cause:** The repository documents workflow review but does not provide a locked actionlint dependency or wrapper

**Fix or workaround:** Use a repository-pinned workflow validator or detect actionlint before invoking it and fall back to YAML parsing

---

## 2026-08-30 20:51

**What happened:** Chunked quality payload inspection passed two file operands to GNU base64 and decoded nothing

**Probable cause:** base64 accepts only one input file even though the workflow correctly concatenates chunks first

**Fix or workaround:** Concatenate chunk files to stdout, then pipe the single stream into base64 --decode

---

## 2026-08-30 20:52

**What happened:** zsh rejected unquoted Next.js route paths containing [id] and [sourceId] during line inspection

**Probable cause:** zsh treated route brackets as filename-generation syntax and nomatch is enabled

**Fix or workaround:** Quote every bracketed Next.js path in shell commands

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (100x 429, 66x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Agents collided on shared files (77x references to another agent's changes).

**Probable cause:** Multiple subagents editing the same file or crate simultaneously.

**Fix or workaround:** Assign disjoint file ownership in task specs. Watchdog should detect cross-agent file contention.

---

## 2026-08-31 11:00

**What happened:** Bulk test assertion cleanup expected nine matches but found ten

**Probable cause:** The earlier failure tail omitted the first affected test

**Fix or workaround:** Use Serena dry-run output or count all matches before guarded replacement

---

## 2026-08-31 11:02

**What happened:** apply_patch rejected a raw git unified diff while restoring a corrupted module

**Probable cause:** The tool requires its Begin Patch and Update File envelope

**Fix or workaround:** Wrap git diff hunks in the apply_patch envelope before applying

---

## 2026-08-31 11:18

**What happened:** A multi-file apply_patch failed at the transition after a hunk with no trailing context

**Probable cause:** The patch contained a stray empty hunk marker before the next file header

**Fix or workaround:** Split unrelated file updates or include valid context on both sides of every hunk

---

## 2026-08-31 11:29

**What happened:** npm install reported blocked native install scripts and 11 audit findings while adding the official Oxlint RuleTester runner

**Probable cause:** npm install security policy blocks unapproved dependency scripts and the existing dependency graph contains advisories

**Fix or workaround:** Run the linter rule suite and build to prove optional scripts are unnecessary, then audit the locked graph and apply only non-breaking verified updates

---

## 2026-08-31 16:23

**What happened:** Jest jsdom has no global Response in the nullable-cluster fixture

**Probable cause:** The test environment does not provide the browser fetch Response constructor

**Fix or workaround:** Use a typed minimal response fixture exposing only ok and json

---

## 2026-08-31 16:23

**What happened:** Combined quality patch was rejected on the telemetry file and applied no changes

**Probable cause:** The handoff excerpt did not match the cancelled file's exact declaration tail

**Fix or workaround:** Inspect exact file ranges and apply smaller verified patches

---

## 2026-08-31 16:54

**What happened:** Per-file oxlint JSON summary script assumed an array and crashed on the tool's object envelope

**Probable cause:** Oxlint emits a versioned object with diagnostics nested under results

**Fix or workaround:** Inspect the JSON envelope before flattening diagnostics and keep the parser tolerant of both shapes

---

## 2026-08-31 16:59

**What happened:** check-complexity documented --json/--report flags are not implemented by the wrapper

**Probable cause:** The script ignores positional options and always writes its temporary report internally

**Fix or workaround:** Use the pinned cccc binary directly for structural inspection until the wrapper exposes those options

---

## 2026-08-31 17:17

**What happened:** Broad backend pytest collection stops before selected reporter tests because optional modules are unavailable

**Probable cause:** The environment lacks langchain_classic, opentelemetry.sdk, and docker packages

**Fix or workaround:** Run focused tests with dependency-aware collection or install only the repository-locked backend extras before the full suite

---

## 2026-08-31 17:22

**What happened:** Focused Jest command used stale test paths under frontend/app/search/__tests__ and found no tests

**Probable cause:** The tests live in frontend/__tests__, while the remembered paths were inferred from the feature area

**Fix or workaround:** Resolve test paths with rg --files before invoking focused Jest

---

## 2026-08-31 17:22

**What happened:** Focused Jest from the repository root discovered nested worktrees and used the wrong Babel config

**Probable cause:** The frontend Jest project is scoped by its package directory, but invoking the binary from the repo root changed rootDir and matched worktree copies

**Fix or workaround:** Run frontend Jest with workdir=frontend and paths relative to that package

---

## 2026-08-31 17:23

**What happened:** Per-file oxlint command could not capture exit status because zsh reserves status as readonly

**Probable cause:** The command used status=0 under the repository's zsh shell

**Fix or workaround:** Use a task-specific variable such as exit_code for shell status capture

---

## 2026-08-31 19:02

**What happened:** A diagnostic command used an unquoted glob-like token (cccc??), and zsh aborted before running it

**Probable cause:** nomatch is enabled and the token was accidental

**Fix or workaround:** avoid placeholder glob tokens; quote route paths and use existing wrappers

---

## 2026-08-31 19:04

**What happened:** A focused Atlas test path did not exist; the helper has no same-named test module

**Probable cause:** test discovery was guessed from the service filename

**Fix or workaround:** list backend/tests before selecting a focused path and use the existing phase or schema suites

---

## 2026-08-31 19:09

**What happened:** A focused evidence-spine test path did not exist; the repository uses integration and wiring suites instead

**Probable cause:** The test filename was inferred from the service module

**Fix or workaround:** Resolve backend/tests paths before composing focused pytest commands

---

## 2026-08-31 19:57

**What happened:** The documented no-null codemod changed nullable API contracts and malformed nested Readonly parameter types, causing hundreds of tsc errors

**Probable cause:** The transform is token-based and lacks type/context awareness

**Fix or workaround:** Do not run noNull in bulk; repair the codemod to restrict or validate replacements before writing

---

## 2026-08-31 20:25

**What happened:** Focused Chroma pytest command named a nonexistent test module

**Probable cause:** The test filename was guessed from the service name instead of resolving backend/tests first

**Fix or workaround:** Use rg --files backend/tests | rg chroma before selecting focused paths

---

## 2026-08-31 20:35

**What happened:** Focused Atlas query Jest command used the wrong test path

**Probable cause:** The test lives in frontend/features/intelligence-atlas/tests rather than frontend/__tests__

**Fix or workaround:** Resolve frontend test paths with rg --files before invoking Jest

---

## 2026-08-31 20:48

**What happened:** Focused reading-queue pytest command named a nonexistent test module

**Probable cause:** Test filename was guessed instead of resolved from backend/tests

**Fix or workaround:** Use rg --files backend/tests | rg 'reading|queue' before selecting focused paths

---

## 2026-08-31 21:01

**What happened:** Unquoted bracketed route path failed under zsh globbing

**Probable cause:** A Next.js dynamic route path was passed without quoting

**Fix or workaround:** Quote paths containing [id] or use rg --files to resolve them

---

## 2026-08-31 21:42

**What happened:** Oxlint probe used frontend/node_modules/oxlint, which is a directory and returned permission denied

**Probable cause:** The executable is exposed through frontend/node_modules/.bin/oxlint

**Fix or workaround:** Use frontend/node_modules/.bin/oxlint or PATH plus oxlint

---

## 2026-08-31 22:37

**What happened:** A generated migration refactor patch was malformed and never executed

**Probable cause:** The patch payload was expanded incorrectly while preparing a large replacement

**Fix or workaround:** Use small apply_patch hunks with only the intended helper extraction

---

## 2026-08-31 22:45

**What happened:** A reporter-file inspection used a frontend-prefixed path while already in frontend

**Probable cause:** The workdir and path were combined

**Fix or workaround:** Use paths relative to the selected workdir

---

## 2026-08-31 22:47

**What happened:** Jest path matching treated the bracketed Next route [id] as a pattern and found no tests

**Probable cause:** Jest --runInBand path argument is regex-like even when shell-quoted

**Fix or workaround:** Use --runTestsByPath for bracketed route test files

---

## 2026-08-31 22:50

**What happened:** The maintainability gate was invoked without its .mjs suffix

**Probable cause:** The repository exposes scripts/check-maintainability.mjs, not an extensionless wrapper

**Fix or workaround:** Resolve scripts with rg --files before running the gate

---

## 2026-08-31 22:51

**What happened:** Luna spawn rejected combining agent_type luna_max with full-history fork

**Probable cause:** Full-history forks inherit the parent agent type

**Fix or workaround:** Use luna_max with fork_context false, or omit the role for a full-history fork

---

## 2026-08-31 23:52

**What happened:** Next build exposed two unrelated integration defects: next/font rejected a comma-declared loader and react18-json-view stylesheet import used sutyle.css

**Probable cause:** Earlier mechanical quality rewrites changed build-sensitive syntax and preserved a package path typo

**Fix or workaround:** Keep each next/font call in its own module-scope const and verify third-party import paths against node_modules before gate runs

---

## 2026-09-01 00:40

**What happened:** The initial Atlas reference search aborted before running because zsh parsed nested quote characters

**Probable cause:** The rg pattern was assembled with shell quote syntax that was not balanced

**Fix or workaround:** Use a simple single-quoted regex for symbol searches and keep paths separately quoted

---

## 2026-09-01 00:43

**What happened:** The mechanical Unicode-regexp codemod treated slash-separated imports and JSX tags as regex literals and corrupted paths and tags

**Probable cause:** The codemod scanned source text instead of AST regular-expression literals

**Fix or workaround:** Use TypeScript AST regular-expression nodes only; never scan arbitrary source text for regex literals

---

## 2026-09-01 00:49

**What happened:** The CRAP JSON report was followed by the wrapper's EXIT marker, so a direct full-file JSON parse failed

**Probable cause:** The capture file intentionally contains warnings and a trailing shell marker

**Fix or workaround:** Extract the JSON object up to the final closing brace or use the wrapper's structured report directly

---

## 2026-09-01 00:59

**What happened:** The post-refactor focused Jest command ran from the repository root and hit the root package's missing test script

**Probable cause:** The command omitted the frontend package working directory

**Fix or workaround:** Run the resolved Atlas Jest path with workdir=frontend

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (50x 429, 73x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Agents collided on shared files (15x references to another agent's changes).

**Probable cause:** Multiple subagents editing the same file or crate simultaneously.

**Fix or workaround:** Assign disjoint file ownership in task specs. Watchdog should detect cross-agent file contention.

---

## 2026-09-01 01:34

**What happened:** Invoking the hook test file through unittest treated its absolute path as a module name and failed before running tests

**Probable cause:** The hook suite is pytest-style rather than a unittest import target

**Fix or workaround:** Run the repository's pytest command against /home/bender/.codex/hooks/test_hooks.py instead

---

## 2026-09-01 03:40

**What happened:** Self-test watchdog wait ended without a report or artifact

**Probable cause:** The tool wait returned after 30 seconds while the process was no longer running

**Fix or workaround:** Use the completed repo lint and focused checks as separate evidence when the watchdog wrapper does not emit its report

---

## 2026-09-01 04:10

**What happened:** File-level Oxlint probe used a repo-relative binary from the frontend worktree and failed with no such file

**Probable cause:** The command combined a frontend cwd with a frontend-prefixed binary path

**Fix or workaround:** Use node_modules/.bin/oxlint when cwd is frontend

---

## 2026-09-01 04:30

**What happened:** Atlas accessible-list probe pointed two directories up for the root Oxlint config from the frontend worktree

**Probable cause:** The file is under frontend/features, but the command cwd is frontend

**Fix or workaround:** Use ../.oxlintrc.json from the frontend cwd

---

## 2026-09-01 04:50

**What happened:** Running Oxlint from repo root cannot resolve the frontend tsgolint executable

**Probable cause:** Oxlint package resolution depends on frontend working directory

**Fix or workaround:** Run the configured frontend lint command or cd frontend and use ../.oxlintrc.json

---

## 2026-09-01 05:07

**What happened:** Quoted shell probe for test imports failed before inspecting files

**Probable cause:** Nested shell quoting was malformed

**Fix or workaround:** Use rg output directly or avoid nested quote interpolation

---

## 2026-09-01 05:12

**What happened:** Combined frontend workdir with a second cd frontend and skipped the intended file lint

**Probable cause:** Command path was relative to the already-selected frontend directory

**Fix or workaround:** Run frontend-local commands directly when workdir is frontend

---

## 2026-09-01 05:12

**What happened:** Used a repo-relative path while already in the frontend workdir

**Probable cause:** The inspection command did not honor the active working directory

**Fix or workaround:** Use __tests__ paths from frontend or absolute repo paths

---

## 2026-09-01 05:21

**What happened:** No-mock scan used repo-relative frontend path from frontend workdir

**Probable cause:** The command was launched inside frontend

**Fix or workaround:** Run the scan from the repository root or target the current directory

---

## 2026-09-01 05:23

**What happened:** Malformed verification tool call omitted the command options delimiter

**Probable cause:** The orchestration wrapper had invalid JavaScript syntax

**Fix or workaround:** Keep tool option objects on separate lines and validate the call shape before execution

---

## 2026-09-01 05:26

**What happened:** Luna fleet spawn was rejected because the agent thread limit is already reached by the two active workers

**Probable cause:** The configured subagent concurrency limit is lower than the requested fleet size

**Fix or workaround:** Queue additional disjoint workers after active agents complete, then re-run their bounded packets

---

## 2026-09-01 06:01

**What happened:** Root-level compact Oxlint JSON probe could not resolve tsgolint

**Probable cause:** The type-aware plugin resolves its executable relative to frontend, while the probe ran from the repo root

**Fix or workaround:** Run per-file Oxlint probes with frontend as cwd and the root config path

---

## 2026-09-01 06:05

**What happened:** CRAP JSON probe was malformed during concurrent worker edits

**Probable cause:** The source set was being modified while crap-typescript generated its JSON report

**Fix or workaround:** Checkpoint all workers before running CRAP and other whole-tree measurements

---

## 2026-09-01 08:05

**What happened:** Cargo test initially ran from backend/ where no Cargo.toml exists

**Probable cause:** The Rust manifest is nested under backend/rss_parser_rust

**Fix or workaround:** Use cargo test --manifest-path backend/rss_parser_rust/Cargo.toml

---

## 2026-09-01 08:53

**What happened:** Parallel metric wrapper used zsh's reserved status variable and returned a false failure

**Probable cause:** The temporary shell variable was named status

**Fix or workaround:** Use rc or another non-special variable name in zsh wrappers

---

## 2026-09-01 12:04

**What happened:** Root Oxlint --fix invocation could not find tsgolint

**Probable cause:** The executable was run without the frontend node_modules bin directory on PATH

**Fix or workaround:** Prefix repo-wide Oxlint calls with PATH="/home/bender/classwork/Thesis/frontend/node_modules/.bin:/home/bender/.npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path:/home/bender/.opencode/bin:/home/bender/llmmodels/llama.cpp/build/bin:/home/bender/.bun/bin:/home/bender/.npm-global/bin:/home/bender/.codex/tmp/arg0/codex-arg0gdcsUv:/home/bender/.npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path:/home/bender/.opencode/bin:/home/bender/llmmodels/llama.cpp/build/bin:/home/bender/.bun/bin:/home/bender/.local/share/pnpm:/home/bender/.npm-global/bin:/home/bender/.local/bin:/home/bender/.local/bin:/home/bender/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/opt/cuda/bin:/usr/lib/jvm/default/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl:/usr/lib/rustup/bin"

---

## 2026-09-01 14:35

**What happened:** Audit manifest probe referenced missing backend/pyproject.toml

**Probable cause:** Thesis keeps backend configuration in requirements.txt and mypy.ini, with Rust metadata nested under backend/rss_parser_rust

**Fix or workaround:** Probe manifests with find before reading a presumed pyproject.toml

---

## 2026-09-01 14:58

**What happened:** Combined documentation patch failed on a stale trace context before any file was changed

**Probable cause:** The patch matched several files in one transaction and one trace section had already diverged

**Fix or workaround:** Patch each documentation surface separately and inspect the exact local context before applying

---

## 2026-09-01 16:16

**What happened:** AST codemod failed at runtime because builtinProcess is undefined

**Probable cause:** The mechanical fixer declares the process wrapper after methods reference it

**Fix or workaround:** Repair initialization order/type contract in scripts/codemod-lint-mechanical.mjs before rerunning the sweep

---

## 2026-09-01 16:49

**What happened:** Self-test watchdog invocation used a nonexistent underscore path

**Probable cause:** The installed skill directory uses command-watchdog with a hyphen

**Fix or workaround:** Use the hyphenated command-watchdog path and verify it before launching

---

## 2026-09-01 18:53

**What happened:** The first generated Oxlint inventory command failed before writing the report because nested shell and JavaScript quoting broke the Python one-liner

**Probable cause:** A large Python program was embedded directly inside multiple quoting layers

**Fix or workaround:** Encode the Python source before passing it to python3 -c and validate the generated row count

---

## 2026-09-01 18:53

**What happened:** Unpinned uvx ruff reported 630 findings while the repository-pinned Ruff 0.15.22 gate passed

**Probable cause:** The diagnostic probe did not use the version pinned by verify.sh

**Fix or workaround:** Run the exact pinned Ruff command for gate decisions and record tool-version drift separately

---

