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

