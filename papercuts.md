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

**What happened:** Maturin rebuild appeared to succeed but old .so persisted.

**Probable cause:** Python loaded cached .abi3.so from virtualenv; rebuild didn't overwrite the import path.

**Fix or workaround:** Use `maturin develop --release --force`. Verify .so timestamp changed. Check import path.

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

**What happened:** Build succeeded but typecheck (`tsc --noEmit`) failed.

**Probable cause:** `next.config.ts` has `ignoreBuildErrors: true`, masking real TypeScript errors.

**Fix or workaround:** Run `npx tsc --noEmit` separately as a verification gate. Do not rely on `npm run build` for type safety.

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

## 2026-09-01 19:46

**What happened:** pre-edit-context returned no context output for the architecture document

**Probable cause:** The repository wrapper completed without emitting the expected packet

**Fix or workaround:** Run the scanner with an explicit existing source path or inspect its wrapper before relying on output

---

## 2026-09-01 19:49

**What happened:** oxlint --rules returned no rule inventory

**Probable cause:** The installed 1.80.0 binary accepted the flag but emitted no output

**Fix or workaround:** Use configured diagnostics plus the printed config as the taxonomy inventory source

---

## 2026-09-01 19:50

**What happened:** zsh rejected a temporary variable named status while probing Oxlint JSON

**Probable cause:** status is read-only in this shell

**Fix or workaround:** Use a task-specific variable name such as oxlint_exit

---

## 2026-09-01 19:53

**What happened:** JSON validation probe printed p outside its loop

**Probable cause:** The one-line Node check placed console.log after the for statement without braces

**Fix or workaround:** Use a braced loop or node --input-type=module for validation probes

---

## 2026-09-01 20:29

**What happened:** Direct MI probe used a stale frontend/node_modules path; code-multivitals is installed at the repository root node_modules.

**Probable cause:** The quality hook resolves the package from the repository root, but the manual probe assumed the frontend install.

**Fix or workaround:** Resolve the package through the repository root before ad hoc metric probes.

---

## 2026-09-01 20:30

**What happened:** Direct code-multivitals analyseFile probe omitted its required threshold profile and failed before returning metrics.

**Probable cause:** The installed API types require ThresholdConfig even though the wrapper had already learned the package path.

**Fix or workaround:** Pass the pinned strict profile when probing per-file MI directly.

---

## 2026-09-01 21:17

**What happened:** unittest was invoked with an absolute file path as a module name and ran zero tests

**Probable cause:** python -m unittest interprets positional names as importable modules

**Fix or workaround:** invoke the hook test file directly or use discover with a start directory

---

## 2026-09-01 21:28

**What happened:** configured Oxlint type-aware probe failed before linting because oxlint-tsgolint is unavailable

**Probable cause:** frontend Oxlint integration expects the optional tsgolint executable

**Fix or workaround:** use the repository's supported type-aware command or install the configured companion before claiming a clean lint gate

---

## 2026-09-01 22:41

**What happened:** Inline Python diagnostic wrapper failed with a syntax error

**Probable cause:** Multiline function definition was packed into a one-line command

**Fix or workaround:** Use the existing analyzer directly or a properly structured temporary probe

---

## 2026-09-01 23:13

**What happened:** Maintainability --help probe started the full scan

**Probable cause:** The script has no help mode and treated --help as a normal run

**Fix or workaround:** Use the per-file hook metric probe instead of invoking the repository scan for help

---

## 2026-09-01 23:24

**What happened:** Combined diagnostic wrapper failed before running checks due to nested shell quoting

**Probable cause:** The command embedded a node -e script inside an orchestrated shell string

**Fix or workaround:** Run focused diagnostics as separate commands or use a script file

---

## 2026-09-01 23:36

**What happened:** Zsh diagnostic wrapper could not assign variable named status

**Probable cause:** status is a read-only zsh special parameter

**Fix or workaround:** Use a task-specific variable such as exit_code

---

## 2026-09-01 23:46

**What happened:** SafeImage regression assertion expected a root-relative src but Next Image normalizes it to localhost

**Probable cause:** The Next Image test adapter resolves relative URLs in jsdom

**Fix or workaround:** Assert against the browser-normalized URL or use URL parsing

---

## 2026-09-02 00:14

**What happened:** Oxlint JSON aggregate probe treated the report as an array and crashed while counting diagnostics

**Probable cause:** Oxlint --format json emits an object with a diagnostics array

**Fix or workaround:** Read report.diagnostics before aggregating and keep the probe separate from the lint exit code

---

## 2026-09-02 01:16

**What happened:** pre-edit-context emitted no packet for article-detail-modal.tsx

**Probable cause:** The vault wrapper completed silently for this target invocation

**Fix or workaround:** Inspect the wrapper and fall back to rg plus bounded source reads before editing

---

## 2026-09-02 04:11

**What happened:** A type-aware Oxlint probe left a tsgolint worker running for about 90 minutes at 99% CPU after the command output returned

**Probable cause:** The optional type-aware worker outlived the parent probe

**Fix or workaround:** Check child processes after direct type-aware probes and terminate only the stale probe tree before continuing

---

## 2026-09-02 04:24

**What happened:** A compact Node JSON diagnostic one-liner had a syntax error and produced EPIPE

**Probable cause:** Nested flatMap callback was malformed

**Fix or workaround:** Use a checked-in or multiline parser for complexity reports

---

## 2026-09-02 05:21

**What happened:** The repo quality verifier launched local Oxlint without frontend/node_modules/.bin on PATH and treated tsgolint startup text as JSON

**Probable cause:** The adapter inherited the shell PATH while frontend/package.json adds the local binary directory only in its npm script

**Fix or workaround:** Prepend the repository frontend/node_modules/.bin directory in the adapter environment before invoking Oxlint

---

## 2026-09-02 06:39

**What happened:** A targeted adapter patch used an incorrect path and was rejected before changing files

**Probable cause:** The provider adapter lives under scripts/quality-hardening, not frontend/tools

**Fix or workaround:** Resolve the target with rg before applying the patch

---

## 2026-09-02 08:11

**What happened:** Duplicating Oxlint diagnostic metadata in queue tasks raised controller complexity and lowered MI

**Probable cause:** The measurement already preserves raw code, normalized rule, severity, path, line, and message

**Fix or workaround:** Keep task records grouped by canonical rule and retain detailed diagnostics in the measurement

---

## 2026-09-02 10:45

**What happened:** repo-pinned oxlint hangs >280s even on one file; type-aware tsgolint worker never finishes

**Probable cause:** tsgolint background worker hangs/restarts on this machine; per-edit full lint was the cost driver

**Fix or workaround:** verify scripts via cli:typecheck + node --test; run full lint gate in batch once, not per edit

---

## 2026-09-02 10:45

**What happened:** Edit tool cannot quote literal <SM:FIND> text in file content

**Probable cause:** XML wrapper cannot represent literal engine tag inside a FIND payload

**Fix or workaround:** patch those regions with a small Python read/replace/write

---

## 2026-09-03 11:46

**What happened:** Backend fails to boot with LLM_BACKEND=llamacpp when no llama-server is running (Connection refused, worker exits code 3)

**Probable cause:** backend/.env had LLM_BACKEND=llamacpp; on_startup hard-requires llama-server health at :8080

**Fix or workaround:** Set LLM_BACKEND=openrouter (uses OPEN_ROUTER_API_KEY) or start llama-server; opencode backend needs OPENCODE_API_KEY which is not configured

---

## [auto-mined] [omp]

**What happened:** API returned HTML/empty body instead of JSON (6x).

**Probable cause:** Missing auth headers, wrong endpoint URL, or Cloudflare challenge page.

**Fix or workaround:** Curl the endpoint directly first to verify response shape. Check for auth/UA requirements.

---

## 2026-09-10 16:40

**What happened:** Repository-local oxfmt executable was unavailable when formatting the shared type file

**Probable cause:** frontend/node_modules/.bin has no oxfmt and no oxfmt command is on PATH

**Fix or workaround:** Use the repository's installed formatter path when present; otherwise preserve the minimal manually formatted diff and record the missing tool

---

## 2026-09-10 17:12

**What happened:** Frontend TypeScript command used a tsconfig path relative to the wrong npm exec directory

**Probable cause:** npm --prefix frontend exec ran the compiler from the repository root

**Fix or workaround:** Pass frontend/tsconfig.json explicitly when using npm --prefix

---

## 2026-09-10 19:38

**What happened:** Frontend verification batch failed before checks because commands were run from frontend with repository-root paths

**Probable cause:** The orchestrator combined a frontend working directory with root-relative executable and package paths

**Fix or workaround:** Run root-relative commands from the repository root or strip frontend/ from paths when using the frontend directory

---

## 2026-09-10 20:15

**What happened:** Grid modal controller removal script found no in-file controller because that block had already been removed

**Probable cause:** The extraction range was applied twice after the first successful removal

**Fix or workaround:** Check the target marker with rg before running a range edit

---

## 2026-09-10 22:59

**What happened:** The documented quality-hardening validate command is not available; the CLI only exposes measure, verify, summary, and related subcommands.

**Probable cause:** The current CLI has no validate handler.

**Fix or workaround:** Use node scripts/quality-hardening.mjs verify --scope ... or summary.

---

## 2026-09-10 23:02

**What happened:** The pulled quality-hardening verifier crashed because config.mjs called an undefined asObject helper.

**Probable cause:** A cleanup commit removed the helper but left its validation call sites.

**Fix or workaround:** Keep the JSON object guard next to the config loader and exercise summary/verify after pulls.

---

## 2026-09-10 23:03

**What happened:** The pulled quality profile referenced an imports check that was absent from its verification checks.

**Probable cause:** The profile and check registry drifted during the remote update.

**Fix or workaround:** Keep profile entries and verification.checks synchronized; restore node scripts/check-imports.mjs.

---

## 2026-09-10 23:09

**What happened:** Quality-hardening controller tests failed when fixture taxonomies omitted overrides.

**Probable cause:** config and queue dereferenced taxonomy.overrides without a default.

**Fix or workaround:** Treat optional taxonomy overrides as an empty object in resolution and tradeoff collection.

---

## 2026-09-10 23:45

**What happened:** The Oxlint count probe assumed a list but the JSON output is an object with a diagnostics array.

**Probable cause:** The current Oxlint JSON schema differs from the earlier census helper.

**Fix or workaround:** Guard the top-level object and read its diagnostics field before counting.

---

## 2026-09-10 23:46

**What happened:** The per-file Oxlint diagnostic Python f-string probe failed on nested quote escaping.

**Probable cause:** Shell and Python string delimiters were mixed in a one-line formatter.

**Fix or workaround:** Use a small JSON loop with repr-safe field access or inspect the raw JSON with a separate script.

---

## 2026-09-11 01:18

**What happened:** A direct TypeScript probe failed before running because the exec workdir was misspelled.

**Probable cause:** Command used /home/bender/classlint instead of the repository path.

**Fix or workaround:** Run probes from the repository root and reference frontend/tsconfig.json.

---

## 2026-09-11 02:50

**What happened:** DeepReadonly on Three.js globe runtime parameters introduced incompatible readonly mipmaps and left the lint cluster unchanged

**Probable cause:** The generic mapped type recursively readonly-maps mutable Three.js texture arrays and the type-aware Oxlint rule still reports the wrapper

**Fix or workaround:** Keep the original runtime types until a narrow read-only view interface is defined; do not map Three.js classes wholesale

---

## [auto-mined] [omp]

**What happened:** Edit tool rejected 11x due to stale file tags (file changed between read and edit).

**Probable cause:** Concurrent agents editing the same file, or sequential edits without re-reading.

**Fix or workaround:** Ensure subagents have disjoint file ownership. Re-read before editing when another agent is active.

---

## [auto-mined] [omp]

**What happened:** Browser navigation timed out (29x).

**Probable cause:** Dev server slow to start or page too large.

**Fix or workaround:** Add longer timeout for first navigation. Check if dev server is running.

---

## 2026-09-11 05:07

**What happened:** Patch submission failed before touching the repository due to unescaped JavaScript string quotes

**Probable cause:** The tool-call wrapper used a double-quoted string for a multiline patch containing double quotes

**Fix or workaround:** Use a template literal or raw multiline string for apply_patch payloads

---

## 2026-09-11 05:46

**What happened:** A zsh verification probe used status as a shell variable and aborted before Oxlint output

**Probable cause:** zsh reserves status as a read-only special parameter

**Fix or workaround:** Use a task-specific variable such as exit_code in zsh probes

---

## 2026-09-11 06:35

**What happened:** The documented oxfmt formatter is not installed in frontend/node_modules/.bin

**Probable cause:** The repository instructions require oxfmt but the current dependency install has no oxfmt executable

**Fix or workaround:** Check the installed formatter path before invoking it; use the available project formatter or keep a verified minimal diff without adding a dependency

---

## 2026-09-11 07:12

**What happened:** Narrowing a ReactNode wrapper to string | number exposed a mixed JSX text and number union in TypeScript

**Probable cause:** The rendered label combined literal JSX text with a nullable numeric expression

**Fix or workaround:** Use one interpolated template string when the narrowed wrapper contract requires a string

---

## 2026-09-11 07:27

**What happened:** The type-aware Oxlint command using a shell-relative OXLINT_TSGOLINT_PATH intermittently returned a wrapper SyntaxError

**Probable cause:** The command wrapper did not expose the underlying diagnostic when the relative environment path was used

**Fix or workaround:** Use the absolute tsgolint and oxlint paths for deterministic focused scans

---

## 2026-09-11 07:50

**What happened:** The saved quality measurement path was copied with one character missing during the follow-up jq probe

**Probable cause:** A long generated measurement filename was transcribed manually

**Fix or workaround:** Read the exact newest filename from ls before querying it

---

## 2026-09-11 08:08

**What happened:** The combined documentation checkpoint patch did not apply because one wrapped context line differed

**Probable cause:** The four docs use different historical wrapping and the patch assumed one exact line break

**Fix or workaround:** Append each documentation surface with its own verified tail context

---

## 2026-09-11 08:26

**What happened:** Parallel typecheck call used a mistyped repository path and failed before execution

**Probable cause:** Manual workdir typo

**Fix or workaround:** Reuse the verified Thesis workdir string in both commands

---

## 2026-09-11 08:32

**What happened:** The first jq summary expression applied level to a path string and failed

**Probable cause:** jq pipe precedence in a measurement query

**Fix or workaround:** Group path predicates before combining them with level

---

## 2026-09-11 08:43

**What happened:** Stream patch included a duplicate reset line inferred from overlapping output and failed context validation

**Probable cause:** Overlapping file excerpts were mistaken for duplicate source

**Fix or workaround:** Inspect the exact source range before composing multi-hunk patches

---

## 2026-09-11 09:12

**What happened:** Stream hook type patch failed because a multi-hunk patch used stale context after the split

**Probable cause:** The source changed between inspected ranges and patch construction

**Fix or workaround:** Apply small hunks against freshly inspected exact lines

---

## 2026-09-11 09:23

**What happened:** Frontend typecheck has no npm script; npm run typecheck failed before running

**Probable cause:** package.json exposes build, test, and lint commands but no typecheck entry

**Fix or workaround:** Use the repository's direct npx tsc --noEmit command

---

## 2026-09-11 09:30

**What happened:** DeepReadonly on globe component props made the function component type unusable in JSX

**Probable cause:** The recursive utility readonly-mapped the third-party component constructor

**Fix or workaround:** Keep the component prop boundary shallow and model nested mutable tokens explicitly

---

## 2026-09-11 09:39

**What happened:** Narrowing the globe component contract to a function type broke the test's displayName assignment

**Probable cause:** The test treats the component value as a React component object with displayName

**Fix or workaround:** Retain ComponentType until a dedicated adapter token preserves both JSX and metadata

---

## 2026-09-11 09:44

**What happened:** Cluster model revert patch missed because the earlier experiment had already removed its import

**Probable cause:** The patch assumed the original import still existed

**Fix or workaround:** Inspect the exact current import block before reverting a type experiment

---

## 2026-09-11 09:59

**What happened:** Queue helper export list referenced an unimported and separately re-exported symbol, causing duplicate TypeScript identifiers

**Probable cause:** The final import consolidation was patched without checking the module's binding shape

**Fix or workaround:** Import the helper value once and expose it through the existing export list

---

## 2026-09-11 10:00

**What happened:** Queue helper cleanup patch left duplicate export declarations, which lint caught before commit

**Probable cause:** The patch matched a shared export line while adding the replacement

**Fix or workaround:** Inspect the exact tail after each export consolidation and run focused lint before typechecking

---

## 2026-09-11 10:06

**What happened:** Article model readonly patch missed because the import block was wrapped differently than the inspected excerpt

**Probable cause:** A long import was assumed to be one line

**Fix or workaround:** Read exact import lines with sed before applying the next hunk

---

## 2026-09-11 10:28

**What happened:** memo check without its required text argument failed before inspection

**Probable cause:** The project wrapper requires a positional context string

**Fix or workaround:** Pass a short context string such as memo check 'globe canvas cleanup' before edits or checks

---

## 2026-09-11 10:32

**What happened:** GlobeRenderProps intersection widened polygonsData to any[] and added an unused import

**Probable cause:** The third-party Pick loses the project polygon element contract

**Fix or workaround:** Keep the explicit GlobePolygon array field and test type intersections with focused lint before retaining them

---

## 2026-09-11 10:37

**What happened:** apply_patch rejected a delete and add operation targeting the same globe canvas file

**Probable cause:** The patch tool requires one operation per target path

**Fix or workaround:** Use one update hunk or replace the file through a single write

---

## 2026-09-11 10:43

**What happened:** frontend-only quality measurement stayed CPU-bound for over a minute after stale worker cleanup

**Probable cause:** The measurement runs CCCC and CRAP over the full frontend before printing JSON

**Fix or workaround:** Use direct frontend Oxlint for fast warning census and reserve the full measurement for verified checkpoint runs

---

## 2026-09-11 10:44

**What happened:** direct Oxlint JSON census wrote an empty stdout file and the parser failed

**Probable cause:** The command's diagnostic stream or fatal output was not captured separately

**Fix or workaround:** Capture stdout and stderr independently and inspect both before parsing

---

## 2026-09-11 11:12

**What happened:** endpoint domain extraction initially imported schemas from the wrong barrel and duplicated a shared helper

**Probable cause:** The original file mixed schemas from schemas.ts and response-schemas.ts and the slice generator retained emitCacheRefreshLine

**Fix or workaround:** Verify each moved symbol's defining module with rg and run focused type-aware Oxlint before wider checks

---

## 2026-09-11 11:20

**What happened:** Reading a Next.js dynamic route with an unquoted path failed under zsh glob expansion.

**Probable cause:** Square brackets in app/wiki/organization/[id] were treated as a filename pattern.

**Fix or workaround:** Quote dynamic route paths in shell commands.

---

## 2026-09-11 11:47

**What happened:** Package-local Knip JSON capture was prefixed by an npm notice, so the saved file was not directly parseable

**Probable cause:** npm emits lifecycle notices before the reporter JSON

**Fix or workaround:** Capture the command output and strip the npm notice before parsing, or invoke the binary directly

---

## 2026-09-11 11:51

**What happened:** The guessed organization and atlas Jest paths did not exist, so the targeted command found no tests

**Probable cause:** The page has no matching test filenames under frontend/__tests__

**Fix or workaround:** List matching test files with rg --files before invoking a focused Jest run

---

## 2026-09-11 12:16

**What happened:** The bounded quality measurement failed when its explicit path list still included utilities deleted in the cleanup commit

**Probable cause:** The measurement command was assembled from the pre-cleanup file list

**Fix or workaround:** Build measurement paths from current rg --files output after deletions

---

## 2026-09-11 12:34

**What happened:** Repository formatter check cannot run because oxfmt is not installed and no formatter config or binary exists

**Probable cause:** AGENTS.md requires oxfmt, but the current frontend install and PATH do not provide it

**Fix or workaround:** Install the repository-pinned formatter or document the supported formatter command before the next formatting gate

---

## 2026-09-11 13:03

**What happened:** The focused Oxlint probe used frontend/.oxlintrc.json, which does not exist

**Probable cause:** The repository config is at the workspace root

**Fix or workaround:** Use --config .oxlintrc.json from the Thesis root

---

## 2026-09-11 13:20

**What happened:** The next-target probe used frontend/components/news-page-header-controls.tsx, but the module is under frontend/app

**Probable cause:** The import path was not checked before constructing the file path

**Fix or workaround:** Use rg --files or the importing module to resolve the target path first

---

## 2026-09-11 19:12

**What happened:** Clearing the ignored Next dev cache hit an active next dev writer

**Probable cause:** Turbopack was still writing frontend/.next/dev while the cache was being removed

**Fix or workaround:** Stop the active dev server before clearing frontend/.next/dev

---

## 2026-09-11 19:30

**What happened:** Focused backend tests failed because the repository root was used as the backend working directory

**Probable cause:** The test paths are relative to backend/

**Fix or workaround:** Run backend pytest commands with workdir backend or prefix paths with backend/

---

## 2026-09-11 19:30

**What happened:** Focused frontend Oxlint cannot start because the installed tsgolint adapter is missing

**Probable cause:** frontend/package.json declares oxlint-tsgolint but frontend/node_modules lacks it

**Fix or workaround:** Restore the locked frontend dependency install before running type-aware Oxlint

---

## 2026-09-11 20:04

**What happened:** Stopping the local uvicorn session left its child process listening on port 8000 after Ctrl-C.

**Probable cause:** The request worker was still blocked in the upstream model call.

**Fix or workaround:** Use the bounded OpenCode timeout and kill the child only when the local verification process must be stopped.

---

## 2026-09-11 20:36

**What happened:** pre_edit_context scanner produced no packet and hung past 30 seconds

**Probable cause:** the wrapper did not return output for this dirty frontend scope

**Fix or workaround:** use the already inspected exact files and bounded rg reads when the scanner stalls

---

## 2026-09-11 22:02

**What happened:** DeepWiki search call failed before dispatch due to malformed tool invocation

**Probable cause:** The web tool wrapper rejected the first query payload

**Fix or workaround:** Retry with a minimal valid search payload before combining queries

---

## 2026-09-11 22:20

**What happened:** Frontend package has no typecheck script; npm run typecheck failed before running tsc

**Probable cause:** The repository exposes TypeScript checking through the compiler directly rather than package scripts

**Fix or workaround:** Run npx tsc --noEmit from frontend after inspecting package scripts

---

## 2026-09-11 22:22

**What happened:** Focused Oxlint invocation could not load TypeScript support because oxlint-tsgolint is not installed

**Probable cause:** The local Oxlint binary is configured to use a missing optional tsgolint executable

**Fix or workaround:** Use the repository's native lint script or install the pinned optional linter before TypeScript diagnostics

---

## 2026-09-11 22:36

**What happened:** Local model catalog curl hung without a response

**Probable cause:** The local backend process did not answer the new endpoint during the check

**Fix or workaround:** Verify the backend service is healthy before claiming live endpoint coverage

---

## 2026-09-11 22:59

**What happened:** Focused backend test command used a repo-root path from inside backend and failed before pytest

**Probable cause:** The working directory and executable path were both prefixed with backend

**Fix or workaround:** Use .venv/bin/pytest when workdir is backend, or keep backend/.venv/bin/pytest from the repository root

---

## 2026-09-11 23:07

**What happened:** The stop-dispatch lint review command is not installed on PATH, so the hook-level replay failed before running

**Probable cause:** The hook invokes an internal dispatcher unavailable in this shell

**Fix or workaround:** Use the same Ruff checks directly or invoke the configured hook dispatcher from its absolute path

---

## 2026-09-12 15:46

**What happened:** Globe frame comparisons changed with article loading and auto-rotation.

**Probable cause:** Fixed delays sampled different article overlays and camera orientations.

**Fix or workaround:** Wait for loaded overlays and lock the same camera before collecting matched frame samples.

---

## 2026-09-12 20:41

**What happened:** Chrome DevTools verification could not connect because DevToolsActivePort was missing; used the open localhost browser for interaction evidence.

**Probable cause:** Chrome MCP session is not running with a DevTools port.

**Fix or workaround:** Start the app browser with remote debugging enabled before frontend visual verification.

---

## 2026-09-12 20:44

**What happened:** After reloading the localhost globe, the live-article loading indicator did not detach within 15 seconds; the page may be waiting on local data.

**Probable cause:** The live app did not complete its initial data request during the runtime verification window.

**Fix or workaround:** Check the local backend and network requests before browser verification.

---

## 2026-09-12 20:54

**What happened:** Full frontend Jest run now reaches one unrelated search-inline-edit failure: useRouter is rendered without an App Router context.

**Probable cause:** Existing search page test setup does not provide the router context required by the current global navigation component.

**Fix or workaround:** Provide the real App Router test context in that test setup or use the repository-approved navigation harness.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (930x 429, 113x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (128x 429, 10x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Agents collided on shared files (2x references to another agent's changes).

**Probable cause:** Multiple subagents editing the same file or crate simultaneously.

**Fix or workaround:** Assign disjoint file ownership in task specs. Watchdog should detect cross-agent file contention.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (50x 429, 73x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

## [auto-mined] [omp]

**What happened:** Integration tests repeatedly hit rate limits (11x 429, 0x "rate limit") - agent may have iterated on code instead of waiting for cooldown.

**Probable cause:** External API rate limiting not handled in test mode.

**Fix or workaround:** Cache API responses for test runs. Add cooldown detection to test harness.

---

