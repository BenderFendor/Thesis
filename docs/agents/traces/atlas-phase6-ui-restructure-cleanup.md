# Atlas Phase 6: UI restructure + cleanup

## Goal and done criteria

Implement Phase 6 only (of `~/.claude/plans/okay-so-what-i-curried-journal.md`):
make the entity directory the primary landing surface at `/wiki/ownership`,
demote the graph to a secondary "Explore graph" view with a compact
neighborhood entry point on profile pages, delete the dead pre-rebuild graph
workspace and legacy backend graph route, mark deprecated `Organization`
ownership columns, and update docs. Built on Phases 0-5 (uncommitted in the
working tree).

Done: directory-first landing verified live; graph demoted but functionally
intact; dead code deleted and grep-verified unreferenced; deprecation
comments added without a migration; `docs/intelligence-atlas.md` rewritten;
backend tests/mypy/ruff and frontend tsc/eslint/jest/build all pass or match
the documented pre-existing failure set.

## Status: complete

## Files changed

### Part A -- directory-first navigation

- `frontend/features/intelligence-atlas/atlas-entity-list.tsx` (new) --
  the list/table core (search, All/Outlets/Organizations/People/Reporters
  tabs, country/funding/bias facet selects, sortable virtualized rows)
  extracted from the former `AtlasIndexSheet` modal. Takes `variant="page"`
  (fills its container, used as the directory) or `variant="modal"`
  (original bounded-height styling, for any future dialog usage) and an
  `onSelect(node)` callback so the caller decides what a row click does.
- `frontend/features/intelligence-atlas/atlas-index-sheet.tsx` -- deleted.
  The modal is retired, not kept alongside the extracted list: once the
  directory became the primary landing surface, the "Browse all" action
  that used to open this modal from the graph view just switches to the
  directory tab instead (see `atlas-stage-shell.tsx`'s `onOpenIndex` callers
  below), so no caller needed a modal presentation anymore.
- `frontend/features/intelligence-atlas/intelligence-atlas-workspace.tsx` --
  restructured: a new "view" tab bar (Directory / Explore graph) sits below
  the topbar; `view === "directory"` (the default) renders
  `AtlasEntityList` full-page, wired to navigate (`router.push`) to each
  row's `profile_path` on click; `view === "graph"` renders the original
  `AtlasStageShell` graph canvas, filters, and dock unchanged. The graph
  query (`fetchAtlasGraph`) is now `enabled: isGraphView` so landing on the
  directory doesn't fire the (comparatively expensive) bounded-graph
  request. `AtlasStageShell`'s dock "Browse all" button now writes
  `{ view: "directory" }` instead of opening the retired modal.
- `frontend/features/intelligence-atlas/lib/atlas-query-state.ts` -- added
  `AtlasView = "directory" | "graph"` and a `view` field to
  `AtlasQueryState` (default `"directory"`). Removed `"index"` from
  `AtlasPanel` (the modal it opened no longer exists) -- unrecognized
  `panel=index` values now fall back to `"none"`/`"inspector"` per the
  existing defensive parsing, so old links don't crash. Legacy
  `?selected=...` links with no `view` param still infer `view=graph`
  (preserving old deep-link intent: a `selected` param always used to mean
  "show this in the graph"). Added `buildAtlasNeighborhoodHref(entityId)`,
  reused by the three profile-page "Explore neighborhood" links below.
- `frontend/features/intelligence-atlas/atlas.module.css` -- `.workspace`
  grid gained a row (`auto auto minmax(0, 1fr) auto`: topbar / view-tab bar
  / main content / graph dock) so both the directory (3 grid children) and
  the graph view (4, via `AtlasStageShell`'s stage+dock fragment) lay out
  correctly under CSS grid's implicit auto-placement.
- `frontend/app/wiki/organization/[id]/organization-wiki-view.tsx`,
  `frontend/app/wiki/person/[id]/person-wiki-view.tsx`,
  `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx` -- each
  added a small "Explore neighborhood" link (`Network` icon +
  `buildAtlasNeighborhoodHref(entityId)`) under the entity header, linking
  into `/wiki/ownership?view=graph&selected=<id>&neighbors=1&focus=1`
  without embedding the graph canvas itself. The source (outlet) page only
  renders the link once `outletEntityId` resolves (via the existing
  `searchAtlas` lookup that page already does for the ownership chain).
- `atlas-graph.tsx`, `atlas-accessible-list.tsx`, `atlas-inspector.tsx`,
  `atlas-topbar.tsx`, `atlas-stage-shell.tsx` -- functionally unchanged
  (stats/coverage metrics, accessible synchronized list, filters, layout
  modes, inspector dialog all intact in the graph view); `atlas-stage-shell`
  and `atlas-topbar` only touched for the `onOpenIndex` rewiring noted above.

### Part B -- dead code deletion

Deleted, each verified unreferenced by grep before removal:

- `frontend/app/wiki/ownership/graph/page.tsx` -- only importer was itself
  (the route); nothing else referenced it.
- `frontend/app/wiki/ownership/source-intelligence-workspace.tsx` (912
  lines) -- only importer was `graph/page.tsx` (also deleted).
- `frontend/app/wiki/ownership/ownership-graph-canvas.tsx` -- only importer
  was `source-intelligence-workspace.tsx` (also deleted).
- `frontend/app/wiki/ownership/graph-utils.ts` -- importers were
  `source-intelligence-workspace.tsx`, `ownership-graph-canvas.tsx` (both
  deleted) and `source-intelligence-support.tsx` (kept, but its only import
  from this file was inside `buildProcessedGraph`, also deleted below); once
  that import was removed, grep confirmed zero remaining references to
  `graph-utils` anywhere in `frontend/`.
- `source-intelligence-support.tsx`'s `buildProcessedGraph`, `MetricCard`,
  `FilterButton`, `Field` -- grep confirmed `source-intelligence-operations.tsx`
  (the file that survives, backing `AtlasOperationsSheet`) only imports
  `type WorkspaceTab` from this file, not these four; they were dead once
  their only caller (`source-intelligence-workspace.tsx`) was deleted.
  `WorkspaceTab`/`WORKSPACE_TABS` are kept -- still imported by
  `atlas-operations-sheet.tsx` and `intelligence-atlas-workspace.tsx`.
- Backend `GET /api/wiki/organizations/graph` (`get_ownership_graph`) and
  its `OwnershipGraphResponse` Pydantic model in
  `backend/app/api/routes/wiki.py` -- grep confirmed no other route or
  service referenced either; `_required_str` (used inside the deleted
  function) is used elsewhere in the file so its import/definition stayed.
- `frontend/lib/api.ts`'s `fetchWikiOwnershipGraph` and the
  `WikiOwnershipGraph` interface -- grep confirmed the only callers were
  `source-intelligence-workspace.tsx` (deleted) and
  `source-intelligence-support.tsx` (its only use, `buildProcessedGraph`,
  also deleted).
- `backend/app/services/atlas_graph_helpers.py`: `_parse_percentage` and
  `_evidence_ref` -- grep across `app/` and `tests/` found zero call sites
  for either (only their own definitions). Deleted along with the imports
  that became unused as a result (`typing.cast`, `AtlasEvidenceRef`,
  `app.database.SourceClaimEvidence`).
  - **Correction during work**: I initially also deleted `_catalog_sources`,
    `_edge_id`, `_research_confidence`, `_node_matches`, `_edge_matches`,
    `_dedupe_edges`, and `_RELATION_GROUPS` believing them unused, based on
    a grep that conflated `atlas_graph_helpers._catalog_sources` with the
    separately-defined, same-named functions in `atlas_entity.py` and
    `entity_backfill.py`. `mypy --strict` caught the mistake immediately
    (`atlas_graph_projection.py` imports `_catalog_sources` from this
    module and calls it at line 66; the other six are imported and called
    by `atlas_graph.py`/`atlas_evidence_projection.py`/
    `atlas_graph_projection.py`). Restored all seven; only
    `_parse_percentage` and `_evidence_ref` were actually dead.
- `backend/tests/test_wiki_organizations.py` -- removed the
  `TestOwnershipGraph` class (6 tests against the deleted route); kept
  `TestListOrganizations` (the still-live plain `/organizations` list
  endpoint).
- `backend/openapi.json` / `frontend/lib/generated/openapi.ts` --
  regenerated (`app.openapi()` called directly against the FastAPI app,
  then `npx openapi-typescript`) since the checked-in `openapi.json` was
  stale from before Phases 0-5 as well as this deletion; the diff drops
  `/api/wiki/organizations/graph` and picks up the Phase 1-5 evidence/atlas
  routes that had never been captured.

### Part B -- deprecation comment (no migration, no column drop)

- `backend/app/database.py`: `Organization` class docstring plus inline
  comments on `parent_org_id`/`ownership_percentage`/`owned_by`/
  `parent_orgs`/`part_of` explain that the Atlas ownership graph/UI now
  reads exclusively from the evidence spine, and name the exact remaining
  non-Atlas readers/writers (`wiki_indexer.py` still writes
  `parent_org_id`; `source_credibility.py` and the plain
  `GET /api/wiki/organizations` list route still read some fields) so the
  comment doesn't overclaim "fully dead." No column dropped, no migration
  added, per the task's explicit instruction.

### Part C -- docs

- `docs/intelligence-atlas.md` -- rewritten: evidence-spine data model
  (`EvidenceEntity`/`EntityExternalId`/`AcceptedRelationship`/
  `CalculationTrace`), outlet/organization/person/reporter entity-type
  mapping, the three ingestion CLIs in run order
  (`backfill_entities` -> `ingest_evidence` -> `run_funding_bias_analysis`),
  the new directory-first UI structure (directory, graph tab, profile
  pages, funding-bias analysis page), route-state/legacy-link behavior, API
  contracts (including the new `/analysis/funding-bias` endpoint and the
  removal of the legacy graph route), trust rules, and rendering/
  accessibility notes covering both the graph and the plain-list directory.
- `docs/Log.md` -- added a new dated entry (`2026-07-20 — Atlas Phase 6`)
  above the existing same-day entry, documenting this phase's changes and
  verification results, following the log's existing per-entry convention.
  Did not edit historical entries.
- `README.md`, `docs/Todo.md` -- checked; no material references to the old
  graph-first behavior or the deleted route found, so left unchanged
  (README's one Atlas mention is already accurate at the level of detail it
  operates at).

## Design notes

- **Modal retirement, not duplication**: the plan allowed either keeping a
  bounded modal variant of the list or retiring it, "your call, document
  it." I retired it: once the directory is the default landing surface,
  the only place that used to open the modal (the graph view's "Browse all"
  button) can just switch view tabs instead -- there was no remaining
  caller that actually needed a dialog presentation. `AtlasEntityList` still
  supports `variant="modal"` for a future caller, it's just currently
  unused in that mode.
- **View state defaults and legacy links**: rather than a hard default of
  `"directory"` for every parsed URL, `parseAtlasQueryState` infers
  `view="graph"` when a `selected` entity is present but no `view` param
  is given -- matching the pre-Phase-6 meaning of a `selected` deep link
  (it always meant "show this entity in the graph"). `serializeAtlasQueryState`
  always writes `view` explicitly whenever `selected` is set, so this
  legacy-inference rule never corrupts a round-trip of state this app
  itself produced (only affects genuinely external/old URLs).
- **Grid layout for two content shapes**: the workspace grid needed a track
  for the new view-tab bar without breaking `AtlasStageShell`'s existing
  two-top-level-children (`stage` + `dock` footer) fragment output. Solved
  by adding one more `grid-template-rows` track and relying on CSS grid's
  implicit auto-placement by source order, rather than wrapping
  `AtlasStageShell`'s output in an extra flex container.
- **Graph query gating**: `fetchAtlasGraph` is now `enabled: isGraphView`.
  This avoids firing the 350-node/1500-edge bounded graph request on every
  directory page load; `fetchAtlasStats` (cheap, used for both views'
  metrics) stays unconditional.

## Commands and tests run

```
cd backend
.venv/bin/ruff check app/ tests/
# All checks passed!

MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Success: no issues found in 170 source files

.venv/bin/pytest tests -m "not slow" -q
# 551 passed, 3 deselected (no regressions)

cd ../frontend
npx tsc --noEmit
# clean

npx eslint .
# 0 errors, 1 pre-existing warning (atlas-entity-list.tsx useVirtualizer,
# same warning atlas-index-sheet.tsx carried before this change)

npx next build
# succeeds; route tree confirms /wiki/ownership/graph is gone and
# /wiki/ownership, /wiki/organization/[id], /wiki/person/[id],
# /wiki/source/[sourceName], /wiki/analysis/funding-bias are all present

npx jest
# 126 passed, 3 failed (blindspot-view.test.tsx x2, search-inline-edit.test.tsx x1)
# -- identical to the pre-existing failure set documented in the Phase 2/3/5
# traces; not touched by this change. All intelligence-atlas suites pass.

grep -rn "source-intelligence-workspace|ownership-graph-canvas|organizations/graph" \
  frontend/app frontend/features frontend/lib frontend/components backend/app backend/tests
# (no output)
```

Live smoke (existing local dev servers, frontend :3000 + backend :8000):
`curl http://localhost:3000/wiki/ownership` renders "Entity directory" as
the default view with an "Explore graph" tab present;
`curl "http://localhost:3000/wiki/ownership?view=graph"` renders the graph
canvas instead.

## Assumptions / deviations

- Retired the `AtlasIndexSheet` modal entirely rather than keeping a
  parallel modal entry point (see Design notes) -- the plan explicitly left
  this as a judgment call.
- `sort` (name/most_connected/most_articles/recently_indexed/
  lowest_confidence) and the type tab remain local component state on
  `AtlasEntityList`, not written to the URL -- matching the original
  modal's behavior (it never persisted these either); `q`/`country`/
  `funding`/`bias` still flow through the existing URL-backed query state
  via `onFiltersChange`, per "preserve URL-state behavior where it still
  applies."
- Did not touch `atlas-graph.tsx`, `atlas-accessible-list.tsx`, or the
  layout Web Worker -- explicitly required to stay intact, and no change
  was needed for them to keep working inside the demoted "Explore graph"
  tab.
- Regenerated `backend/openapi.json`/`frontend/lib/generated/openapi.ts`
  even though only asked to delete one route from them, because the
  checked-in copy predated Phases 0-5 entirely (missing the evidence/
  funding-bias routes); regenerating was the only way to get an accurate
  diff for the one route this phase actually removes.
- No commits made, per instructions.
