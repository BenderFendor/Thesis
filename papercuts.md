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

