---
name: log-to-llm-chunker
description: Convert large log files into uploadable plain-text chunks sized for LLM review; use when a log is too big for a single prompt/file and you need ~500k-token target parts.
---

# log-to-llm-chunker

## Overview

Takes a large `.log` (or any text file) and writes multiple `.txt` chunks sized by an approximate token budget (character-count approximation).

## Assumptions

- Tokens are estimated by characters; exact token counts vary by model/tokenizer.
- Input is UTF-8 text (invalid bytes are replaced).
- Output is intended for uploading to another AI, not re-ingesting into the app as structured logs.

## Workflow

1. Decide your target chunk size (default: 500,000 tokens).
2. Convert tokens  chars using a fixed ratio (default: 4 chars/token).
3. Split on line boundaries to keep log readability.
4. Write `part-0001.txt`, `part-0002.txt`, ... into your chosen output folder.
5. (Optional) Write a small `manifest.json` describing the source file and produced parts.

## Quick Start

- Convert a log into chunks in `backend/logs/LLMreadablelogs`:
  - `python .github/skills/log-to-llm-chunker/scripts/chunk_log_for_llm.py --input backend/logs/app.log --output backend/logs/LLMreadablelogs`

- Change the target size to ~300k tokens per chunk:
  - `python .github/skills/log-to-llm-chunker/scripts/chunk_log_for_llm.py --input backend/logs/app.log --output backend/logs/LLMreadablelogs --target-tokens 300000`

## Output Notes

- The chunk boundary aims to be close to the budget but never splits a line.
- If a single line exceeds the budget, it is split by character count.
- The script prints a short summary including number of chunks created.

## Resources

- Script: `.github/skills/log-to-llm-chunker/scripts/chunk_log_for_llm.py`
