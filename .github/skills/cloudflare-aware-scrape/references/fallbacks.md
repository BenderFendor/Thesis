# Fallback Playbook

## Dev-browser retry
- Wait a few seconds after navigation and re-check `page.title()`.
- If the title stays on challenge, capture a screenshot and note the block.

## Jina AI snapshot
- Use `https://r.jina.ai/http://<host>/path` to fetch rendered content.
- Treat this as a text snapshot; verify links and media hosts before relying on it.

## Direct fetch
- Try a direct `curl`/`fetch` only if no JS is required.
- If blocked, record the challenge response for access notes.

## Report access notes
- Always note which method succeeded and which failed.
- Capture evidence (screenshot or raw HTML) when blocked.
