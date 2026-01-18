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

## Frontend Performance
- When using `next/dynamic`, keep the loading component as a single React element. Complex JSX structures in the `loading` option can cause lazy element type errors.
- Run `npm run build` and `npm test` before committing frontend changes to verify correctness.
- Establish a bundle baseline (e.g., First Load JS) before optimizing to measure improvements.
- Defer component splitting when it would require significant prop drilling or context setup - the risk outweighs the benefit.

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

## UI Component Integration
- Before adding a component to a page, verify its DOM position matches visual intent (not just that it renders).
- New components should adopt existing styling patterns from sibling components (card sizes, scroll behavior, spacing).
- Use props for feature toggling rather than conditional imports or wrapper components.
- When converting layouts (grid to scroll, vertical to horizontal), update both the container and all child elements for consistent sizing.

## Route Removal Checklist
- When removing a route, search the repo for entry points: `rg -n "\"/route\"|/route\b"` and update links/actions.
- Ensure removal doesn’t break Next.js routing: run relevant frontend tests after route deletion.

## Local-First Sync Pattern
- For offline-capable entities, store local records with:
  - `client_id` (UUID), `server_id?`, `sync_status` (`synced|pending|failed`), `pending_op` (`create|update|delete`), `last_error?`, `local_updated_at` (ISO), and `deleted?` tombstones.
- Avoid sync loops: mark failures as `failed` and retry on explicit user action or reconnection.
- Keep UI components dumb: components that capture user intent should emit callbacks; containers/services own storage + network sync.

## Test Gate For Shared Props
- When changing component props, update all call sites via `rg -n "<ComponentName"`.
- Update any Jest tests that mount the component, then run `npm test` in `frontend/`.

## Grid View Patterns
- Grid views use vertical scroll with CSS `scroll-snap-type: y mandatory`.
- Each row of articles uses `scroll-snap-align: start` for snap-to-row behavior.
- Responsive columns: 2 (mobile), 3 (tablet), 4 (desktop) using `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`.
- Groups (source/topic) show responsive initial articles: 4 (mobile), 6 (tablet), 8 (desktop) with "View all X" expansion.
- Topic view has two modes: skim (hero image + title + source list) and expanded (full article grid).
- No horizontal scroll in grid views; use vertical scroll throughout.

## Resource Initialization
- Avoid module-level client/factory instantiation (DB clients, API clients, connections).
- These create new instances on every import, wasting resources.
- Use singleton pattern with lazy initialization: cache instance at module level, create on first use.
- Pattern:
  ```python
  _instance = None
  def get_client():

      if _instance is None:
          _instance = create_client()
      return _instance
      global _instance  ```
