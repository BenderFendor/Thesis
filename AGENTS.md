# AGENTS.md

## Rules
- No emojis in logs or UI.
- Use `uv` instead of `pip` when coding in Python.
- Follow best practices for the framework or language in use.
- If unsure about a library or project documentation, use web search to update knowledge.
- Use exa-code (exa_get_code_context_exa) for all docs and context when coding.
- Keep writing concise: avoid filler, keep sentences focused, avoid jargon when simpler terms work.
- Add minimal, thoughtful debugging to support future troubleshooting.
- Prefer a single LLM API call per feature flow when feasible to reduce rate-limit risk; consolidate prompts instead of chaining calls.
- **NEVER create markdown summary files.** Log changes to `docs/Log.md` instead. Do not create *_SUMMARY.md, *-summary.md, or similar files.
- Do not write standalone session logs to `./log/` for normal code changes. Use `docs/Log.md`.

## RSS Source Catalog
- `backend/app/data/rss_sources.json` is a curated catalog, not a dump. Quality beats country-count inflation.
- For new RSS sources, prefer first-party English-language feeds from outlets that shape domestic discourse in that country.
- Validate every candidate feed with a live fetch that returns real RSS or Atom XML and non-zero items before adding it.
- Reject feeds that return HTML, malformed XML, empty channels, stale content, or anti-bot challenge pages.
- When possible, add contrasting source pairs for the same country instead of multiple outlets with the same editorial position.
- State or state-affiliated outlets are allowed only when clearly labeled and ideally paired with an independent, nonprofit, or private domestic source.
- Every new source entry should include `url`, `category`, `country`, `funding_type`, `bias_rating`, and `ownership_label`.
- Use compact ownership labels in `ownership_label`, for example `state-owned news agency`, `public broadcaster`, `private media group`, `family-owned newspaper`, `independent digital outlet`, or `NGO-owned investigative outlet`.
- Prefer ISO-style two-letter country codes in `country`.
- After changing RSS sources, run a machine check that the JSON still loads and that newly added feeds still parse successfully.
- When a previously validated feed later fails live validation, replace or remove it before ending the task. Do not leave known-broken feed URLs in the catalog.
- Use `backend/scripts/backfill_rss_ownership_labels.py` to backfill compact ownership labels and `backend/scripts/validate_rss_sources.py` to verify live feed health when the catalog changes.

## LLM Prompt Architecture
- Centralize shared prompt rules in reusable helpers instead of repeating full system prompts across services.
- Shared prompt blocks must carry the current date, Scoop role identity, grounding rules, and copy style rules.
- Keep task-specific instructions separate from shared identity and style blocks so prompts stay consistent without losing task control.
- When prompt message structure changes from one message to system plus user messages, update tests that inspect raw LLM payloads.

## Frontend Performance
- When using `next/dynamic`, keep the loading component as a single React element. Complex JSX structures in the `loading` option can cause lazy element type errors.
- Run `npm run build` and `npm test` before committing frontend changes to verify correctness.
- Establish a bundle baseline (e.g., First Load JS) before optimizing to measure improvements.
- Defer component splitting when it would require significant prop drilling or context setup - the risk outweighs the benefit.

## Tests & Proof-of-Work Directives
1. **No Test Gaming:** When writing tests, use Property-Based Testing (`Hypothesis` for Python, `fast-check` for TS) for data transformations. Tests that rely solely on hardcoded I/O strings are forbidden.
2. **Compiler-Driven Development:** Before marking code as done, run the type checker (`mypy` or `tsc --noEmit`). Fix all type errors. `Any` or `# type: ignore` are forbidden without written justification.
3. **Visual Verification:** If you change a UI component, use the Playwright MCP to take a screenshot, analyze it with vision capabilities, and confirm the visual hierarchy is unbroken.
4. **Epistemic Honesty:** If you do not know the shape of an API payload, do not guess. Use `curl`, `fetch`, or web-search tools to observe the actual raw data before writing parsing logic.
5. **List/Detail/Snapshot Consistency:** For topic or cluster bugs, compare the live list payload, detail payload, and persisted snapshot source before changing UI logic.

## Epistemology
- Assumptions are the enemy.
- Never guess numerical values. Benchmark instead of estimating.
- When uncertain, measure. Say "this needs to be measured" rather than inventing statistics.

## Interaction
- Clarify unclear requests, then proceed autonomously.
- Ask for help only when scripts time out (>2 min), sudo is needed, or genuine blockers arise.
- Run `./verify.sh` before ending any session.

## Constraints
- Keep Canvas separate from memory/context.
- Include all prior messages in prompts (no truncation).
- Prefer English Wikipedia links when an English page exists.

## Debugging
- If multiple distinct articles show identical full text, validate `/article/extract` against at least two URLs from the same source before touching UI.
- When extractor output is wrong, identify the publisher platform and add a site-specific extraction path before modifying front-end caching.
- Log the extractor chosen and the requested URL when extraction succeeds or fails.
- For clustering or ranking bugs, inspect token extraction and real overlap from the running backend on sampled articles before changing thresholds or stopwords.
- If a preview card renders snapshot articles, its badges must describe that preview set rather than hidden full-cluster totals.

## Backfill & Data Migration
- After creating a backfill endpoint, run it. The endpoint existing is not enough.
- Backfill queries must exclude already-processed rows to prevent infinite loops.
- Use a marker value (e.g., `"none"`) for failed attempts so they aren't re-tried.
- Every layer (DB, API, frontend) must handle marker values consistently.

## Local DB Bootstrap
- Before running migrations locally, run `init_db()` and confirm `gdelt_events` exists.
- PostgreSQL requires `sudo` to start/stop. If it is not running, prompt the user to start it themselves (`sudo systemctl start postgresql`). Do not attempt to run sudo commands directly.

## Image Handling
- Filter SVGs and placeholder images at fetch time, not just display time.
- URLs ending in `.svg` or containing `placeholder` are not valid article images.
- Frontend `hasRealImage()` helpers must return false for marker values like `"none"`.
- Run `/debug/backfill/images` after adding new sources or if images are missing.
- Topic and cluster cards should fall back to the first real image in the preview article list when the representative article has none.

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
- When mapping countries from third-party GeoJSON, do not trust `ISO_A2` blindly. Some Natural Earth features expose `-99` for real countries like France and Norway. Normalize from verified fallback fields before wiring clicks, labels, or counts.

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

## Pre-Deployment Checklist
- [ ] Run `init_db()` or migrations after any model changes
- [ ] Verify imports with `python -m py_compile` on changed files
- [ ] Test new code paths that use logging - verify logger is initialized

## Debugging Database Errors
When seeing `UndefinedColumnError`:
1. Check `database.py` for column definition
2. Query actual table schema: `\d tablename` in psql
3. If mismatch, create and run migration to add missing columns
4. Never assume schema matches models - always verify

## Database Timestamp Rules
- When creating records with time windows (last_seen, updated_at), always update them when related data changes
- For article-based timestamps, use the article's published date rather than current time to maintain chronological consistency
- Add migration scripts for fixing existing stale timestamps when changing timestamp logic
- Check for stale timestamp filters when queries return empty unexpectedly

## Code Quality Gates
- Run syntax check: `python3 -m py_compile backend/app/**/*.py`
- For new functions using logger, grep for `get_logger` import pattern

## Pre-Commit Verification
Run `./verify.sh` before ending any session. It exits on first failure (`set -e`).

### TypeScript / Frontend
- `npx tsc --noEmit` (run in `frontend/`) — catches type violations the build might miss
- `npm --prefix frontend run lint` — enforces `@typescript-eslint/no-explicit-any` and related rules

### Python / Backend
- `uv run mypy backend/app --strict` — strict type checking; no `Any` escape hatches
- `uvx ruff check backend/ --fix` — catches unused imports and style issues
- `uvx ruff format backend/` — enforces consistent formatting

### Rust
- `cargo clippy -- -D warnings` (run in `backend/rss_parser_rust`) — warnings are errors
- `cargo fmt --all -- --check` (run in `backend/rss_parser_rust`) — formatting check

### Tests
- `uv run pytest backend/tests -m "not slow"` — fast test suite; mark DB/integration tests as `slow`

## ChromaDB Recovery (2026-02-25)
### Problem
After `/tmp` wipe (system reboot), ChromaDB is empty but Postgres has `embedding_generated=True` for all 80k articles. "By Topic" view broke because cluster worker waited for Chroma sync.

### Root Causes
1. **Stale flags**: DB said 80k embedded, Chroma had 0 → backfill found nothing
2. **Slow drift detection**: `COUNT(*)` on 80k rows timed out under write load
3. **OOM kills**: Gunicorn workers loading embedding model got killed under memory pressure
4. **Leader churn**: Multiple workers claimed leadership due to stale lock file + OOM recycling

### Solutions Implemented
1. **Drift detection**: Use Chroma doc count threshold (`_FULL_SYNC_THRESHOLD = 10_000`) instead of slow DB COUNT
2. **Recovery scan scope**: Scan only past 7 days (~10k articles) instead of all 80k to avoid OOM
3. **No mass flag reset**: Check Chroma membership directly per batch, embed only missing → small targeted UPDATEs
4. **Immediate unblock**: Signal cluster worker after first batch embed, not after full sync
5. **Fixed leader lock**: Use `O_CREAT|O_EXCL` (atomic), add stale PID cleanup with alive check

### Key Files
- `backend/app/services/chroma_sync.py` - Drift detection + 7-day recovery scan
- `backend/app/main.py` - Leader lock fixes
- `backend/app/services/chroma_topics.py` - Removed stale `embedding_generated` filter

### Debug Commands
```bash
# Check Chroma count
curl -s "http://localhost:8001/api/v1/collections/<uuid>/count"

# Check DB articles in time window
psql -U newsuser -d newsdb -h localhost -c "SELECT COUNT(*) FROM articles WHERE published_at >= NOW() - INTERVAL '7 days'"

# Verify clusters work
curl -s "http://localhost:8000/trending/clusters?window=1d" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('clusters', [])))"
```
