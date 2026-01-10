# AGENTS.md

## Rules
- OS: Manjaro Linux.
- No emojis in logs or UI.
- Use `uv` instead of `pip` when coding in Python.
- Follow best practices for the framework or language in use.
- If unsure about a library or project documentation, use web search to update knowledge.
- Keep writing concise: avoid filler, keep sentences focused, avoid jargon when simpler terms work.
- Add minimal, thoughtful debugging to support future troubleshooting.
- Prefer a single LLM API call per feature flow when feasible to reduce rate-limit risk; consolidate prompts instead of chaining calls.

## Epistemology
- Assumptions are the enemy.
- Never guess numerical values. Benchmark instead of estimating.
- When uncertain, measure. Say "this needs to be measured" rather than inventing statistics.

## Interaction
- Clarify unclear requests, then proceed autonomously.
- Ask for help only when scripts time out (>2 min), sudo is needed, or genuine blockers arise.

## Constraints
- Keep Canvas separate from memory/context.
- Include all prior messages in prompts (no truncation).
- Prefer English Wikipedia links when an English page exists.

## Debugging
- If multiple distinct articles show identical full text, validate `/article/extract` against at least two URLs from the same source before touching UI.
- When extractor output is wrong, identify the publisher platform and add a site-specific extraction path before modifying front-end caching.
- Log the extractor chosen and the requested URL when extraction succeeds or fails.

## Backfill & Data Migration
- After creating a backfill endpoint, run it. The endpoint existing is not enough.
- Backfill queries must exclude already-processed rows to prevent infinite loops.
- Use a marker value (e.g., `"none"`) for failed attempts so they aren't re-tried.
- Every layer (DB, API, frontend) must handle marker values consistently.

## Image Handling
- Filter SVGs and placeholder images at fetch time, not just display time.
- URLs ending in `.svg` or containing `placeholder` are not valid article images.
- Frontend `hasRealImage()` helpers must return false for marker values like `"none"`.
- Run `/debug/backfill/images` after adding new sources or if images are missing.

## Abstractions
Consciously constrained, pragmatically parameterised, doggedly documented.

## Comment Policy
### Unacceptable Comments
- Comments that repeat what code does
- Obvious comments ("increment counter")
- Comments instead of good naming

### Principle
Code should be self-documenting. If you need a comment to explain WHAT the code does, consider refactoring to make it clearer.
