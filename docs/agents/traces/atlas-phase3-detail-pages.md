# Atlas Phase 3: organization/person detail pages + ownership chain

## Goal and done criteria

Implement Phase 3 only (of `~/.claude/plans/okay-so-what-i-curried-journal.md`):
first-class organization/person detail pages, an evidence-backed upward
ownership chain, and a downward "who else does this owner control" rollup,
built on Phase 0-2 (uncommitted in the working tree).

Done: `/api/wiki/atlas/entities/{id}` returns `ownership_chain`/`controls`/
`siblings_via_owner`/`role_breakdown`/`external_ids` in `details` for
outlet/organization/person entities; organization/person `profile_path`
fixed to `/wiki/organization/{id}` / `/wiki/person/{id}`; new frontend routes
mirroring the reporter/source pattern; a reusable `OwnershipChain` component
embedded on organization, person, and outlet (source) pages; the chain/
controls/sibling walk reuses Phase 2's root-walk logic via shared helpers
instead of re-deriving it; tests pass; mypy strict/ruff/tsc/eslint clean.

## Status: complete

## Files changed

Backend:
- `backend/app/services/atlas_evidence_projection.py` -- extracted
  `build_interest_edge_index`/`walk_ownership_chain` (upward, interest
  predicates only) and `build_controls_index`/`walk_controls_downward`
  (downward, interest + `controls`) as public, cycle-guarded, depth-capped
  helpers. `_accepted_ownership_edges` no longer builds a separate `owner_of`
  dict; `_sibling_via_owner_edges` now takes `edge_by_owned` and calls
  `walk_ownership_chain` instead of duplicating the root walk. Fixed
  organization/person node `profile_path` from
  `/wiki/ownership?selected=...` to `/wiki/organization/{id}` /
  `/wiki/person/{id}`.
- `backend/app/services/atlas_entity.py` -- new `_ownership_context()`
  (fetches the full, non-neighbor-limited outlet/organization/person Atlas
  projection, then reuses the shared walk helpers to build the chain/
  controls/siblings for the requested entity) wired into the outlet,
  organization, and person branches of `get_atlas_entity`. New
  `_external_ids_for_entity()` (surfaces `EntityExternalId` rows with a
  known-scheme link template for wikidata/CIK/LittleSis/MBFC, filtering out
  internal bookkeeping schemes). `role_breakdown` (a `Counter` over each
  connection's `raw_relation_type`) added to organization/person `details`.
- `backend/tests/test_atlas_phase3_entity_ownership.py` -- new, 6 tests (see
  below).

Frontend:
- `frontend/features/intelligence-atlas/lib/atlas-schema.ts` -- added
  `AtlasOwnershipChainHopSchema`/`AtlasControlsEntrySchema`/
  `AtlasSiblingEntrySchema`/`AtlasExternalIdSchema` and
  `parseOwnershipChain`/`parseControls`/`parseSiblingsViaOwner`/
  `parseExternalIds`/`parseRoleBreakdown` helpers that defensively parse
  the loosely-typed `AtlasEntityRecord.details` bag rather than widening
  the base contract.
- `frontend/features/intelligence-atlas/ownership-chain.tsx` -- new. Vertical
  hierarchical `<ol>` (ultimate owner at the top of the DOM, this entity at
  the bottom), each hop showing a percentage/range label and an
  evidence-count badge, linking to the hop's `profile_path` (except the
  current entity's own hop). Renders `null` when the chain is self-only.
  Tailwind-styled to match the reporter/source detail-page idiom (its actual
  host pages), not force-directed, no new dependencies.
- `frontend/app/wiki/organization/[id]/page.tsx` +
  `organization-wiki-view.tsx` -- new, mirrors the reporter/source
  page+view split. Fetches `AtlasEntityRecord` via `fetchAtlasEntity`;
  renders header (name/kind/status), external ids, role breakdown,
  ownership chain, controls card grid (linking to each entity's own page),
  connections, evidence trail. Loading/error/empty states match
  `reporter-wiki-view.tsx`/`source-wiki-view.tsx` conventions.
- `frontend/app/wiki/person/[id]/page.tsx` + `person-wiki-view.tsx` -- same
  pattern for people.
- `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx` -- embeds
  `OwnershipChain` for outlets that have chain data. Resolves the outlet's
  Atlas entity id via `searchAtlas(sourceName)` (exact-label match preferred)
  then `fetchAtlasEntity`, since there is no direct source-name -> Atlas-id
  lookup route; renders nothing when the chain has 0-1 hops.
- `frontend/features/intelligence-atlas/tests/ownership-chain.test.tsx` --
  new, 2 tests: self-only chain renders nothing; multi-hop chain renders
  top-down with percentage/range/evidence text and correct link hrefs.
- `frontend/features/intelligence-atlas/atlas-inspector.tsx` -- verified,
  not modified: it already renders `record.profile_path` as a link, so it
  picks up the new organization/person paths automatically once the backend
  emits them.

## Design notes

- **Chain hop schema**: `{entity_id, label, entity_type, profile_path,
  percentage, percentage_range, evidence_count, claim_ids}`. The first hop
  is always the entity itself (`percentage: null`, `evidence_count: 0`);
  each subsequent hop is the owner reached by that edge, carrying that
  edge's percentage/range/evidence/claims -- so "hop N's percentage" reads
  as "how much of hop N-1 does hop N own", matching how `sibling_via_owner`
  and `pct_range` are already computed in Phase 2.
- **Interest vs. control predicates**: the upward chain and
  `sibling_via_owner` walk stay restricted to `directly_owns`/
  `owns_equity_in` (`_INTEREST_PREDICATES`) so a chain percentage always
  means equity ownership. The downward `controls` rollup additionally
  includes `controls` edges (`_CONTROL_PREDICATES = _INTEREST_PREDICATES +
  ("controls",)`) but excludes `founded_by` -- founding an org is a
  historical fact, not an ongoing control claim. This is a judgment call the
  plan text didn't pin down explicitly; documented here as the chosen
  semantics.
- **Full-graph fetch per entity request**: `_ownership_context()` calls
  `build_atlas_graph` a second time (unbounded by `neighbors`, `limit_nodes:
  600`) to see beyond the entity's immediate 1-hop connections for the
  multi-hop chain/controls walk -- the same "fetch everything, then filter"
  approach `search_atlas` already uses. Both walks are depth-capped (12 for
  the chain, 6 BFS levels for controls) and cycle-guarded (visited-set
  checks), so cyclic or malformed ownership data can't hang the request;
  covered by `test_cyclic_ownership_data_does_not_hang_the_chain_walk`.
- **`siblings_via_owner` reuse**: rather than recomputing sibling grouping
  per-request, `_ownership_context()` reads the precomputed
  `sibling_via_owner` edges straight out of the full graph fetch (the exact
  rollup `atlas_evidence_projection.load_evidence_atlas_projection` already
  produces) and just filters to the ones touching the requested outlet --
  no duplicate logic.
- **Profile path format**: chose the bare `EvidenceEntity.id` (no
  `organization:`/`person:` prefix) in the URL, e.g.
  `/wiki/organization/ent_org_a`, matching how `/wiki/source/{name}` and
  `/wiki/reporter/{id}` already strip their type prefix from the URL. The
  frontend `page.tsx` reconstructs the full Atlas id
  (`organization:${params.id}`) before calling `fetchAtlasEntity`.
- **Outlet -> Atlas-id resolution on the source wiki page**: there is no
  existing route mapping a catalog source name to its Atlas outlet id
  (`stable_source_id` is a backend-only SHA1 digest helper), so
  `source-wiki-view.tsx` calls `searchAtlas(sourceName)` and picks the
  outlet whose label matches exactly (falling back to the top-ranked
  result) rather than duplicating the hashing logic in TypeScript. This adds
  two extra network round trips on that page but keeps the digest algorithm
  single-sourced in Python.
- **`role_breakdown`**: interpreted "funding-type/role breakdown where
  known" as a breakdown of the relationship predicates this entity appears
  in (from its already-computed 1-hop `connections` list), since
  organizations/people don't carry a `funding_type` field of their own the
  way outlets do (orgs keep their existing legacy-enrichment
  `funding_type` field unchanged).

## Commands and tests run

```
cd backend
.venv/bin/pytest tests/test_atlas_phase3_entity_ownership.py -q
# 6 passed

.venv/bin/pytest tests -m "not slow" -q
# 540 passed, 3 deselected (534 pre-existing + 6 new; no regressions)

MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict
# Success: no issues found in 167 source files

.venv/bin/ruff check app/ tests/
# All checks passed!

cd frontend
npx tsc --noEmit
# clean

npx eslint .
# 0 errors, 1 pre-existing warning (atlas-index-sheet.tsx useVirtualizer,
# unrelated, not introduced by this change)

npx jest
# 112 passed, 3 failed (blindspot-view.test.tsx x2, search-inline-edit.test.tsx x1)
# -- identical to the pre-existing failure set documented in the Phase 2
# trace; not touched by this change.

npx jest features/intelligence-atlas
# 8 passed (3 suites; +2 new for ownership-chain.test.tsx)
```

## Assumptions / deviations

- `_CONTROL_PREDICATES` excludes `founded_by` from the downward "controls"
  rollup (see Design notes) -- not explicitly specified by the plan text.
- Organization/person profile paths use the bare entity id, not the
  `organization:`/`person:`-prefixed Atlas node id, for URL aesthetics
  consistent with the outlet/reporter routes; the frontend page
  reconstructs the prefix before calling the Atlas entity API.
- `source-wiki-view.tsx`'s outlet-to-Atlas-id resolution goes through
  `searchAtlas` rather than a new backend lookup route -- no backend route
  was added for this, since the task scoped backend changes to the
  `/entities/{id}` service and `profile_path` fixes.
- Did not add a shared `Panel`/`SidebarCard` component library across
  organization/person/reporter/source views -- each view file keeps its own
  copies, matching the existing repo pattern (reporter-wiki-view.tsx and
  source-wiki-view.tsx already each define their own).
- No commits made, per instructions.
