---
name: log-triage
description: Triage large log directories without loading everything into context by extracting and grouping errors, emitting a compact debug brief, and (optionally) chunking raw logs for LLM upload.
---

# log-triage

## Purpose
Work with very large log files by producing grepable, human-readable artifacts:

- an **index** of log files + sizes
- a compact **error report** (top error signatures, example lines, nearby context)
- optional **raw chunks** of the original logs for LLM upload

This is meant to avoid pasting entire logs into a prompt.

## Assumptions
- Logs are plaintext. Mixed encodings are tolerated (invalid bytes replaced).
- “Errors” are approximated using regex heuristics; this is not a full structured log parser.
- The script should be runnable without network access.

## Workflow
1. Choose an input directory (example: `backend/logs`).
2. Run triage to generate:
   - `triage/index.json`
   - `triage/errors.txt`
   - `triage/errors.json`
   - `triage/samples/<hash>.txt` (context windows)
3. If needed, chunk specific log files for LLM upload (using the existing `log-to-llm-chunker` skill).

## Quick start
- Triage everything in `backend/logs` into `backend/logs/triage`:
  - `python .github/skills/log-triage/scripts/log_triage.py --input backend/logs --output backend/logs/triage`

- If you want to chunk a log for LLM upload, use:
  - `python .github/skills/log-to-llm-chunker/scripts/chunk_log_for_llm.py --input backend/logs/app.log --output backend/logs/LLMreadablelogs`

- Limit to specific filename patterns:
  - `python .github/skills/log-triage/scripts/log_triage.py --input backend/logs --output backend/logs/triage --include "*.log*"`

## Output
- `index.json`: file inventory + sizes.
- `errors.json`: grouped error signatures with counts, first/last seen file, example line.
- `errors.txt`: human scan format version of `errors.json`.
- `samples/`: small context windows around representative error lines.
- Raw log chunking is handled by `log-to-llm-chunker`.

## Debug usage
- Start from `errors.txt`. Pick the highest-frequency signature and jump to displayed sample files.
- For connection-style errors, verify the downstream service is reachable and that host/port/version match.
- If errors are repetitive, add **one-shot abort/backoff** to the caller.
