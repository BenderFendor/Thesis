# Atlas kind facet, research coverage, graph render fix, wiki polish

## Goal and done criteria
Five independent fixes to the Intelligence Atlas / wiki surfaces:
1. Dead `/wiki` back-links point at `/wiki/ownership`.
2. `/index` exposes a `kind` facet (node subtitle, e.g. "legal entity") and
   the entity list renders it as filterable pills.
3. `build_atlas_stats` uncapped (`limit_nodes=None`) plus a new
   `research_coverage` metric ("N of M entities researched").
4. Graph canvas ("Explore graph" tab) renders nodes again.
5. Reporter wiki page visual pass (masthead, card emphasis, collapsed empty
   sections, timeline rail).

Done = backend suite green, frontend suite green (excluding the two known
pre-existing failures), tsc clean, live curl proof for the stats/index
changes, and the graph-render root cause verified against the real
algorithm output.

## Status
Complete.

## Files changed
- `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx`,
  `frontend/app/wiki/reporters/page.tsx`, `frontend/components/source-sidebar.tsx`,
  `frontend/app/debug/page.tsx` — `/wiki` → `/wiki/ownership`.
- `backend/app/services/atlas_entity.py` — `list_atlas_index` gained a
  `kind` filter param and a `kind` facet (computed pre-filter so pills stay
  populated once selected).
- `backend/app/api/routes/wiki_atlas.py` — `/index` gained `kind` query param.
- `frontend/features/intelligence-atlas/lib/atlas-api.ts` — `fetchAtlasIndex`
  passes `kind`.
- `frontend/features/intelligence-atlas/atlas-entity-list.tsx` — second pill
  row for kind, reset on type change.
- `backend/app/services/atlas_graph.py` — `build_atlas_stats` uses
  `limit_nodes=None`; added `research_coverage` /
  `research_coverage_by_entity_type` (rule: entity is "researched" iff
  `AtlasNode.evidence_coverage != "not researched"`, i.e. at least one
  evidence-backed edge touches it).
- `backend/app/models/atlas.py` — `AtlasStatsResponse.research_coverage` /
  `research_coverage_by_entity_type` fields.
- `backend/tests/test_atlas_research_coverage.py` (new) — pins the exact
  coverage numbers for a small seeded graph.
- `frontend/features/intelligence-atlas/lib/atlas-schema.ts` +
  `tests/atlas-schema.test.ts` — parse the new stats fields and the `kind`
  facet.
- `frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx` —
  status strip shows "Researched N of M entities".
- **Graph render fix**: deleted `frontend/workers/atlas-layout.worker.ts`
  and `frontend/features/intelligence-atlas/lib/atlas-layout-protocol.ts`;
  added `frontend/features/intelligence-atlas/lib/atlas-force-layout.ts`
  (same force-directed algorithm, refactored into a steppable class); rewrote
  `frontend/features/intelligence-atlas/hooks/use-atlas-layout.ts` to run it
  on the main thread in `requestAnimationFrame`-chunked batches instead of a
  Web Worker.
- `frontend/app/wiki/reporter/[id]/reporter-wiki-view.tsx`,
  `frontend/app/wiki/reporter/[id]/career-timeline.tsx` — visual pass.
- `backend/openapi.json`, `frontend/lib/generated/openapi.ts` — regenerated.

## Root cause: blank graph canvas
`use-atlas-layout.ts` loaded the force-layout algorithm via
`new Worker(new URL("../../../workers/atlas-layout.worker.ts", import.meta.url), { type: "module" })`.
Under this project's Turbopack dev config that pattern is not compiled: the
`.next` output shows `workers/atlas-layout.worker.ts` copied verbatim as a
**static asset** (`static/media/atlas-layout.worker.<hash>.ts`), and it is
served with `Content-Type: video/mp2t` (the `.ts` extension collides with
MPEG transport streams). Confirmed live:

```
curl -sI http://localhost:3000/_next/static/media/atlas-layout.worker.71d59e3d.ts
Content-Type: video/mp2t
```

The browser refuses to execute that as a JS module worker (wrong MIME type,
and the content is raw un-transpiled TypeScript with type-only imports and a
`/// <reference lib="webworker" />` directive anyway), so the worker never
posts layout positions. `AtlasGraph` only renders a node/edge when a
position exists for its id, so with an empty `positions` map the whole
canvas stays blank while the status strip and toolbar (which don't depend on
positions) render fine — exactly the reported symptom.

Fix: removed the Worker/bundler dependency entirely. The same algorithm now
runs on the main thread via `AtlasForceLayoutRunner`, stepped a few
iterations per `requestAnimationFrame` callback (mirrors the old worker's
progressive postMessage cadence) so it stays interactive instead of one long
blocking task.

## Commands and tests run
- `cd backend && uv run pytest tests/ -q` → 628 passed, 3 skipped (one more
  passed than the stated 627 baseline: the new `test_atlas_research_coverage.py`).
- `cd frontend && npx tsc --noEmit` → clean.
- `cd frontend && npx jest` → 35/37 suites pass; `__tests__/blindspot-view.test.tsx`
  and `__tests__/search-inline-edit.test.tsx` fail, confirmed pre-existing by
  running them against `git stash` (unmodified tree) before restoring.
- `cd frontend && npx jest features/intelligence-atlas/tests/ app/wiki/reporter` → all green.
- Live verification:
  - `curl 'http://localhost:8000/api/wiki/atlas/stats'` →
    `"research_coverage":{"numerator":76,"denominator":11709}`,
    `research_coverage_by_entity_type` per type.
  - `curl 'http://localhost:8000/api/wiki/atlas/index?entity_types=organization&limit=1'`
    → `facets.kind = {"legal entity": 41}`.
  - `curl 'http://localhost:8000/api/wiki/atlas/index?entity_types=organization&kind=legal%20entity&limit=3'`
    → `total: 41`, all items `subtitle: "legal entity"`.
  - Fetched the real `/graph` response and parsed it with the actual
    `AtlasGraphResponseSchema` in a throwaway jest test: parsed cleanly (350
    nodes, 70 edges) — ruled out a schema-parse failure as the graph-blank
    cause.
  - Ran `AtlasForceLayoutRunner` against a synthetic 350-node/70-edge graph
    to its full iteration count: every node gets a finite `{x, y}` position.
- Backend server was gunicorn (no `--reload`); sent `SIGHUP` to the master
  (`pid 2052724`) to pick up the code changes before the stats/index curls
  above (gunicorn recycles workers on `HUP` with `preload_app = False`).

## Assumptions and risks
- "Researched" is defined as *edge-evidence-backed*, matching the existing
  `evidence_coverage` node field rather than inventing a new rule. An entity
  with only a `current_parent` from an unevidenced accepted fact would not
  count — documented in the `build_atlas_stats` docstring/comment.
- The `kind` facet/filter is applied post-graph-projection in
  `list_atlas_index` (not threaded through `AtlasGraphFilters`/
  `build_atlas_graph`) since it is a pure facet over already-loaded nodes.
- Main-thread layout removes Web Worker offloading. For the current
  `limit_nodes` ceiling (600) this is fine (350-node/70-edge run: ~2.4s of
  pure iteration time when run without frame yielding in a jest probe;
  chunked across rAF at 4 iterations/frame in the browser it stays
  interactive). If node limits grow substantially, revisit true off-thread
  execution — e.g. explicit Turbopack worker loader config — rather than
  reverting to the broken `new Worker(new URL())` pattern.

## Remaining
None. All five tasks complete and verified.
