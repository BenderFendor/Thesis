# AGENTS.md

## Rules
- OS: Manjaro Linux.
- No emojis in logs or UI.
- Use `uv` instead of `pip` when coding in Python.
- Follow best practices for the framework or language in use.
- If unsure about a library or project documentation, use web search to update knowledge.
- Keep writing concise: avoid filler, keep sentences focused, avoid jargon when simpler terms work.
- Add minimal, thoughtful debugging to support future troubleshooting.

## Epistemology
- Assumptions are the enemy.
- Never guess numerical values. Benchmark instead of estimating.
- When uncertain, measure. Say "this needs to be measured" rather than inventing statistics.

## Interaction
- Clarify unclear requests, then proceed autonomously.
- Ask for help only when scripts time out (>2 min), sudo is needed, or genuine blockers arise.

## Abstractions
Consciously constrained, pragmatically parameterised, doggedly documented.

## Comment Policy
### Unacceptable Comments
- Comments that repeat what code does
- Obvious comments ("increment counter")
- Comments instead of good naming

### Principle
Code should be self-documenting. If you need a comment to explain WHAT the code does, consider refactoring to make it clearer.
