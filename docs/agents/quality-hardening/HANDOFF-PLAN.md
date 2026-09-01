# Quality Hardening — Handoff Plan for a Fresh Agent

> Purpose: take over branch `quality/crap-mi-oxlint-hardening` in `/home/bender/classwork/Thesis` and drive it green. Everything below is measured/verified facts from the 2026-08-30 session. A fresh agent can execute this without re-discovering rule semantics, config decisions, or tool quirks.

## 0. Current State (measured 2026-08-30 ~13:00)

| Gate | Baseline (pre-session) | Now |
|---|---|---|
| oxlint errors | 18,069 | ~16.1k (wave 3 in flight) |
| oxlint warnings | 1,104 | ~880 |
| tsc errors | 48 | ~22 (down from 146 worst-point) |
| cccc hard (CC>10 \|\| cog>15) | 379 | ~371 |
| MI fails (<50) | 313 | in flight |
| jscpd clones | 114 | 76 backend (~40 frontend) |
| knip unused exports | 72 | pending sweep |
| import resolution | broken (65) | **0 — all resolve** (fixed twice: mass-typo + cancel-time renames) |

Wave 3 (10 agents W30–W39, MI-first) **was CANCELLED mid-edit** on 2026-08-30 (~13:30). The working tree contains PARTIAL, POSSIBLY INCONSISTENT edits (uncommitted). **Before any work: validate per-file.** Never trust a touched file. Known partially-edited files at cancel: `frontend/lib/api.ts` (W30 midpoint; 11 corruptions incl. `/news/suources`, `/cache/sutatus`, `guenerated`), `frontend/components/article-detail-modal.tsx` (W35 part 7), `backend/app/scripts/replay_evidence_corpus.py`, `backend/scripts/backfill_article_author_links.py` (W38), several wiki views (W31/W32/W37/W39). Some agents repaired theirs before the kill — re-verify all.

## 1. Files changed by the main session — do not redo
- `.oxlintrc.json` — rule resolutions (see §3); valid JSON, stable.
- `frontend/jest.setup.js`, `frontend/tsconfig.json` — jest-dom types entry (`@testing-library/jest-dom/jest-globals`).
- `frontend/package.json` — declared `@jest/globals@30.2.0`; `crap` script = `crap-typescript --threshold 30 --agent`.
- `package.json` (root) — `quality:all` bundle (cycles + duplicates + maintainability + complexity + deadcode + crap).
- `scripts/check-complexity` — NEW cccc gate (pinned 1.6.0, sha256, hard = CC>10 || cog>15; binary cached in ~/.cache/cccc).
- `scripts/check-maintainability.mjs` — NEW MI gate (code-multivitals per-function; THESIS_MI_CAP=50).
- `scripts/check-imports.mjs` — NEW broken-import gate (tsc does NOT catch unresolvable `@/` imports — verified). `--fix` autofixes typo family (extra "u") and kebab-rename family (camelCase hook paths).
- `verify.sh` — added `rm -f frontend/tsconfig.tsbuildinfo` (stale incremental check masks errors — verified) + `node scripts/check-imports.mjs`.
- `.jscpd.json`, `frontend/knip.json` — new gate configs (see §6 quirks).
- `frontend/components/article-detail-modal.tsx` — `ArticleDetailServices` typed DI seam (PRESERVE).
- `docs/Log.md`, `docs/agents/traces/quality-hardening-2026-08-30.md` — updated.
- `docs/agents/quality-hardening/{wave3-manifest.md, combined-driver.json, mi-by-file.json}` — working data (buckets, scores, MI deficits).

## 2. The Doctrine (efficiency win)
A CC-157 function generates hundreds of oxlint errors (no-magic-numbers, strict-boolean, no-ternary, jsx-max-depth).
**Rewrite the big functions for maintainability first** (MI >= 50, CC <= 10, cognitive <= 15) via helper extraction; the oxlint errors inside them disappear in the same edit. Then mop up the oxlint-only rules. One pass, two gates. Order per file:
1. MI fails (worst first) → 2. cccc hard → 3. oxlint remaining.
Verify BOTH gates after each chunky edit; don't do 100 edits then check.

## 3. Rule resolutions (all probed/verified; .oxlintrc.json is FINAL — do not re-litigate)
- `import/no-named-export` OFF — Next.js app-router requires named exports (`metadata`); TS types cannot be default-exported.
- `import/prefer-default-export` OFF — same framework conflict.
- `react/function-component-definition` = `arrow-function` — resolves conflict with `func-style`.
- `react/preserve-manual-memoization` OFF — conflicts with repo-wide `eslint/one-var` merged-statement style; memoization is genuine perf (no React Compiler).
- `anti-slop/no-module-mocking` IS ACTIVE (probe-verified) — `jest.mock` cannot be lint-clean in ANY form:
  - global jest → `jest/prefer-importing-jest-globals`
  - imported jest + mock → `no-module-mocking` + `jest/no-untyped-mock-factory`
  - typed factory (`typeof import`) → `consistent-type-imports` + TS2345
  - **DI conversion is mandatory.** Pattern: real components + typed `services`/router props seam (`ArticleDetailServices`), or wrap with real `next/navigation` AppRouterContext/SearchParamsContext providers.
- `@jest/globals` import of ALL jest fns (describe/expect/it/jest/beforeEach) is REQUIRED by `prefer-importing-jest-globals`. No jest.mock remains in clean files → SWC hoisting concern is moot.
- `one-var` = deny, `sort-vars` = deny, `sort-imports` = deny, `group-exports`/`exports-last` = deny. TDZ trap: alphabetical sort-vars can put `rawId` before `entityId` that uses it → extract a helper for the dependency; don't reorder blindly.
- `jsx-max-depth` = deny (effectively max ~4-5) — extract JSX into module-level subcomponents.
- `no-magic-numbers` = deny — extract named constants. Even 0/1 flagged.
- `unicorn/filename-case` = deny — kebab-case. Hooks: `useX.ts` → `use-x.ts` (§5 sweep).
- `react/function-component-definition` → components are `const X = () => {}`.
- `jsx-props-no-spreading` = deny — destructure explicitly.
- `anti-slop/require-safety-comment-for-type-assertion` — `// SAFETY: <invariant>` immediately above any `as`.
- `anti-slop/no-unknown-parameters` / `no-unknown-returns` / `no-known-value-widening` — zod parse is the accepted boundary pattern; raw `as` is banned.
- `typescript/strict-boolean-expressions` — handle nullish/zero explicitly.
- `prefer-readonly-parameter-types` — deep readonly; `Readonly<ComponentProps<...>>` does NOT satisfy; explicit readonly interfaces do. `ReactNode`/`Set` props may be flagged — use `ComponentProps<'tag'>`-based props where possible (verified pattern in ui/badge).

## 4. Mechanical codemod (`scripts/codemod-lint-mechanical.mjs`)
- SAFE transforms (idempotent, tsc-verified): `readonlyParams`, `globalThis`, `unicodeRegexp`, `noNull` (safe positions), `expectAssertions`.
- UNSAFE/disabled: `oneVar` (merge bug corrupted 18 files), `exportsLast` (type-export breakage), `nullish` (needs type info).
- Usage: `node scripts/codemod-lint-mechanical.mjs [--rules readonly,globalThis,unicodeRegexp,noNull,expectAssertions] [--file path]`
- Do NOT run the unsafe rules. Excludes `tools/`, `test-utils/`, itself.

## 5. Centralized hook rename sweep (deterministic — after validating current state)
Still-camel hooks: `useBookmarks, useDebounce, useFavorites, useLiveBrowseIndex, useNewsLens, useNewsStream, usePaginatedNews, useReadingHistory, useReadingQueue` (+ any other filename-case violation).
Already renamed (imports mostly reconciled; verify `check-imports.mjs` = 0): `use-scroll-personalization`, `use-liked-articles`, `use-browse-index`, `use-debug-mode` (W36), `use-source-filter` (W32), `use-inline-definition`, `use-live-news-preferences` (W33).
Per module: `git mv` to kebab-case; update all import specifiers; `node scripts/check-imports.mjs`; tsc; jest.

## 6. Tool quirks (all verified — save yourself an hour each)
- **oxlint needs PATH**: `PATH="/home/bender/classwork/Thesis/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix <files>` else "Failed to find tsgolint executable" (type-aware rules silently don't run; diagnostics report 0).
- **tsc stale incremental**: `frontend/tsconfig.tsbuildinfo` masks new errors; `rm -f` it before every run (now in verify.sh). Run from repo root: `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit`.
- **tsc does not flag unresolved `@/` imports** (TS2307 missing under moduleResolution=bundler + paths). Always `node scripts/check-imports.mjs` (now in verify.sh). Mass-typo event (65 broken, `gulobal`/`suafe`/`sutorage` family) was invisible to tsc.
- **jscpd 5.0.16 Rust binary**: `ignore` config field → scans ZERO files. Use `-p '**/*.{ts,tsx,js,mjs,py,rs}'` + explicit dirs; config has NO ignore field.
- **node --test scripts/tests/scoop.test.ts** for CLI tests; `npm run cli:typecheck` for scripts TS.
- **Backend verify**: `cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict`; `uvx ruff@0.15.22 check backend/ --fix`; `.venv/bin/pytest tests -m "not slow"`.
- **Rust**: `cargo clippy --manifest-path backend/rss_parser_rust/Cargo.toml -- -D warnings`; `cargo test` in that crate.
- Anti-slop plugin lives in `frontend/tools/oxlint/` — never run codemods over `tools/` (corrupted its regex once).
- oxlint type-aware service for `scripts/*.ts` does NOT resolve `@types/node` (scripts/tsconfig has typeRoots only) → false "error typed" on process/Buffer. Acceptance for scripts: `cli:typecheck + cli:test`; the repo gates those files via oxlint but its type errors there are mostly tsgolint-resolved. If a scripts file shows no-unsafe on `process`, that is the resolution gap — fix by typing locals, or accept when cli gates pass.
- `crap` gate needs jest coverage first: `npm --prefix frontend test -- --coverage` then `npm --prefix frontend run crap`.

## 7. Gate inventory (what "done" means)
Run in order (root):
1. `rm -f frontend/tsconfig.tsbuildinfo && ./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit` — 0 errors
2. `node scripts/check-imports.mjs` — all resolve
3. `PATH="$PWD/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix frontend scripts` — 0 errors
4. `scripts/check-complexity` — 0 hard violations
5. `node scripts/check-maintainability.mjs --strict` — 0 fails
6. `npm run quality:duplicates` — 0 clones
7. `npm --prefix frontend run deadcode` — 0 unused exports (sweep probes first; atlas schemas verify usage before deleting — they're consumed in atlas tests)
8. `npm --prefix frontend test -- --coverage && npm --prefix frontend run crap` — threshold 30
9. `npm run deps:cycles`, `npm run cli:typecheck && npm run cli:test`, `npm run cli:schema:check` (openapi drift pre-existing — separate)
10. Backend: mypy, ruff, pytest (720+ tests)
11. `npm --prefix frontend run build`
12. Sweep probes: untracked `probe|scratch|tmp-probe|zz-tmp|__probe|__ro_probe` under frontend/ → delete. Known existing: `frontend/features/intelligence-atlas/__ro_probe__.tsx`, `frontend/features/intelligence-atlas/zz-tmp-atlas-graph.tsx`, `frontend/probe-h.tsx`, `frontend/tmp-probe-g.ts`.

## 8. Known remaining work items (post-validate; in order)
1. Validate per-file state (cancelled edits); re-measure §0.
2. Work the manifest from the top (biggest combined score first) with the doctrine.
3. Hook kebab sweep §5.
4. Probe/scratch sweep §7.12.
5. knip unused exports: verify each before deleting.
6. jscpd frontend clones (~40): extract shared helpers; tsc/jest verify.
7. CRAP: post-coverage; correlate with high-CC funcs (likely fixed by MI pass); re-measure.
8. Docs/polish: update `docs/Log.md`; update trace; commit per phase (branch commits per-phase: see git log "chore: record complexity snapshot").
9. OpenAPI drift: regenerate `npm run openapi:refresh` against live backend or document out-of-scope.

## 9. File ownership rules (collision trap)
- Disjoint ownership per wave. Every task lists EXACT files; no cross-bucket edits; importer-path changes for a renamed module are the OWNER of the importer file.
- Never edit: `.oxlintrc.json`, `tsconfig.json`, `package.json`, `jest.setup.js`, `verify.sh`, `scripts/check-*.mjs`, `docs/**` from a subagent (main owns infra).
- No suppression anywhere: `eslint-disable`, `oxlint-disable`, `ts-ignore`, `@ts-nocheck`, `ts-expect-error` forbidden. Type assertions need `// SAFETY:` comments.

## 10. Quickstart
```
cd /home/bender/classwork/Thesis
git status   # confirm branch + WIP
rm -f frontend/tsconfig.tsbuildinfo
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit 2>&1 | head -40
PATH="$PWD/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix frontend scripts 2>&1 | grep -c "Error"
node scripts/check-imports.mjs
scripts/check-complexity 2>&1 | head -5
```
Then work the biggest remaining files with the doctrine. `docs/agents/quality-hardening/wave3-manifest.md` is the ordered worklist.

## 11. Continuation-agent brief (paste to the next agent verbatim)

> Your job starts with READING — you have no prior session context.
> 1. Read `/home/bender/classwork/Thesis/docs/agents/quality-hardening/HANDOFF-PLAN.md` (this file) — complete plan, measured state, the MI-first doctrine, all verified rule resolutions, safe/unsafe codemod transforms, tool quirks, gate inventory, ordered worklist, file ownership rules.
> 2. Read `/home/bender/classwork/Thesis/docs/agents/quality-hardening/wave3-manifest.md` — ordered per-file worklist with counts.
> 3. Optional per-file context from cancelled-wave transcripts (read-only): `history://W30` = lib/api.ts, `history://W31` = debug page, `history://W33` = interactive-globe, `history://W35` = article-detail-modal + cluster-detail-modal, `history://W37` = scoop.ts + atlas-schema + globe-view, `history://W38` = saved/page + wiki views + backend, `history://W36` = grid-view + backend chroma_topics/reporter_indexer/atlas_entity/blindspot_viewer, `history://W32` = search-page/utils, `history://W34` = reading-queue-sidebar + org-wiki, `history://W39` = app/page + workspace.
>
> CRITICAL: the working tree is a CANCELLED mid-edit state. Files may be half-rewritten, imports half-updated. BEFORE each file: scoped oxlint (`PATH="$PWD/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix <file>`), scoped tsc (`./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit --pretty false 2>&1 | grep <file>`), `node scripts/check-imports.mjs` (all imports currently resolve — keep it that way). If a file is broken beyond easy repair: `git checkout HEAD -- <file>` and redo from scratch with the doctrine. Never trust a touched file.
>
> DOCTRINE: a CC-157 function generates hundreds of oxlint errors. Rewrite big functions FIRST for maintainability (MI>=50, CC<=10, cognitive<=15) via helper extraction; the oxlint errors inside them disappear in the same edit. Then mop up oxlint-only rules. Verify both gates after each chunky edit.
>
> SEQUENCING: one file at a time, fully green (oxlint 0 + tsc 0 + cccc clean + MI clean + jest if it has tests), then next. Start with highest combined score: `frontend/lib/api.ts` (1714 oxlint + 89 MI + 12 cccc — W30 transcript has the most complete plan for it: 11 corruptions incl. `/news/suources`, `/cache/sutatus`, `guenerated`, plus a zoned rewrite design). Then debug/page.tsx, search/page.tsx, then down the manifest. Do not start a new file until the current one is fully green.
>
> HARD RULES:
> - Do NOT edit `.oxlintrc.json`, `tsconfig.json`, `package.json`, `jest.setup.js`, `verify.sh`, `scripts/check-*.mjs`, `docs/**` (main owns them).
> - No suppression: no eslint-disable/oxlint-disable/ts-ignore/ts-expect-error/ts-nocheck. Type assertions need `// SAFETY: <invariant>` comments.
> - No emojis. No `*SUMMARY.md` files. Probes in /tmp only; delete your own scratch files.
> - Backend: no new deps, no wire-format changes, no try/except fallbacks; mypy --strict + ruff + pytest green.
> - Do not rename more camelCase hooks unless you also update every importer (verify with `node scripts/check-imports.mjs`).
> - Tests must pass (jest, `node --test` for scripts, pytest for backend).
>
> ACCEPTANCE (run in order):
> ```
> rm -f frontend/tsconfig.tsbuildinfo
> ./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit   # 0 errors
> node scripts/check-imports.mjs                                        # all resolve
> PATH="$PWD/frontend/node_modules/.bin:$PATH" ./frontend/node_modules/.bin/oxlint -c .oxlintrc.json --format unix frontend scripts   # 0 errors
> scripts/check-complexity                                              # 0 hard
> node scripts/check-maintainability.mjs --strict                       # 0 fails
> npm run quality:duplicates                                            # 0 clones
> npm --prefix frontend run deadcode                                    # 0 unused
> npm run cli:typecheck && npm run cli:test
> cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict   # 0
> uvx ruff@0.15.22 check backend/ --fix                                 # clean
> cd backend && .venv/bin/pytest tests -m "not slow"                    # green
> cargo clippy --manifest-path backend/rss_parser_rust/Cargo.toml -- -D warnings  # clean
> npm --prefix frontend run build                                       # green
> ```
> Then update `docs/Log.md` with what you did. Do NOT commit.
>
> REPORT: gates final numbers (before/after per gate), files still failing with exact blocker, tests run, any rule instance you could not fix with reason (should be minimal — flagged rules are all fixable without suppression).

## 12. Transcript extraction (read from cancelled agents — do not re-discover)

### Corruption inventory (the single most important fact)
The wave agents found SYSTEMATIC TEXT CORRUPTION in the working tree, introduced during wave 1/2 (not present in HEAD):
- `sutorage` for `storage` (`@/lib/sutorage`), `suource` for `source`, `suafe` for `safe`, `suearch` for `search`, `gulobal` for `global`, `iunline` for `inline`, `iunteractive` for `interactive`, `iuntelligence` for `intelligence`, `gurid` for `grid`, `guenerated` for `generated`, `sutory`/`sotrage`/`stirage`/`sorage`/`ssource` siblings.
- JSX closing-tag corruption: `</supan>` for `</span>`.
- In-code corruption: `/news/suources`, `/cache/sutatus`, `/news/sutream`, `iundex`, `sutats`, `guenerated` in `frontend/lib/api.ts`.
- These were mostly fixed by `scripts/check-imports.mjs --fix` (65 imports) + per-agent fixes, but **scan the whole tree again**: `rg -n "sutorage|suource|supan|iunline|gulobal|suafe|suearch|gurid|guenerated|sutream|sutatus|iundex|sutats|sutory|iunteractive|iuntelligence" frontend scripts backend`.
- Diagnostic: `git diff` vs HEAD shows corruption as unexpected edits; HEAD is clean for these files.

### Per-file state from transcripts (W30/W35/W38 extracted; others same pattern)
- `frontend/lib/api.ts` (W30): 11 corruptions confirmed; zod-parse is the accepted boundary pattern (raw `as` is banned by anti-slop); every number is magic (even 0/1); one-var/sort-vars conventions: study `frontend/lib/storage.ts` (canonical merged chains); W30 left `/tmp/api-restructure.mjs` (two-pass: exports-last worked, oneVar not) — do NOT reuse; rebuild by hand. File is 5.7k lines; exports must keep names/signatures.
- `frontend/components/article-detail-modal.tsx` (W35): HEAD was clean; working tree had broken codemod attempt + legit DI seam. W35 rebuilt from `/tmp/adm-head.tsx` (HEAD extract) + preserved `ArticleDetailServices`; left `/tmp/new-adm-p*.tsx` parts 1-7 (part 7 incomplete — main content/seam/exports). Restore to: HEAD + `ArticleDetailServices` seam + house style. DI seam locations: grep `services.` in the file.
- `backend/app/scripts/replay_evidence_corpus.py` (W38): import bug fixed (`outlet_node_ids` from `app.services.atlas_entity_resolution`), `_expectation_matches` refactored for cccc; VERIFY still correct.
- `backend/app/services/evidence_spine.py` (W38): `materialize_claim` refactored into helpers (`_find_existing_relationship`, `_attach_supporting_relationship_link`); `_find_existing_relationship` is awaited.
- `backend/app/services/source_profile_extractor.py` (W38): `build_fields_from_documents` + `_extract_funding_values` refactored.
- `backend/app/api/routes/{wiki.py, cache.py}`, `backend/app/services/article_extraction.py` (W38): refactored for cccc.
- `backend/scripts/backfill_article_author_links.py` (W38): BIG refactor (name cleaning, `_local_reporter_profile`, `_load_groups`, backfill loop, `_pruned_link_count`, `_link_group_articles`, `_record_*` helpers); **W38 found and fixed a behavior regression**: original fell back to `raw_author` when `raw_authors` was an EMPTY list; the refactor must keep that (verify `_article_author_values`).
- `backend/scripts/check_proof_suite_clean_room.py` (W38): dedup key fixed to use span.
- `backend/tests/test_openapi_cli_contract.py` (W38): type annotations fixed.
- `backend/app/services/news_research.py` (W38): `__init__` docstring.
- Tests W38 ran: `test_evidence_corpus_replay`, `test_backfill_article_author_links` (was failing pre-fix, then fixed).

### House style confirmed by probes (agents agree)
- Arrow-fn components; one-var merged consts (study `storage.ts`); sort-vars alphabetical with TDZ-safe extraction; no magic numbers (extract constants); no-null to undefined; `ComponentProps<'tag'>`-based props pass readonly checks (ReactNode/Set props fail); explicit readonly interfaces for props objects; zod parse for API boundaries; `// SAFETY:` before assertions; jest test pattern = DI (no jest.mock).

### Rule conflicts settled (do not revisit)
- one-var vs preserve-manual-memoization to keep memoization, preserve rule OFF (already in config).
- func-style vs function-component-definition to arrow (already in config).
- no-named-export/prefer-default-export OFF (already in config).
- no-module-mocking to DI only (already in config and probe-verified).

### Still-camel hooks (central sweep; do not rename mid-work without import matching)
`useBookmarks, useDebounce, useFavorites, useLiveBrowseIndex, useNewsLens, useNewsStream, usePaginatedNews, useReadingHistory, useReadingQueue` — rename to kebab + update importers + `node scripts/check-imports.mjs`. Already renamed: `use-scroll-personalization`, `use-liked-articles`, `use-browse-index`, `use-debug-mode`, `use-source-filter`, `use-inline-definition`, `use-live-news-preferences`.
