# Atlas Phase 2: evidence-spine graph projection + source -> outlet rename

## Goal and done criteria

Implement Phase 2 of the Atlas rebuild plan
(`~/.claude/plans/okay-so-what-i-curried-journal.md`): rewrite
`atlas_graph_projection.py` so the graph projects from the evidence spine
(Phase 0/1 work: `entity_resolver.py`, `entity_backfill.py`,
`evidence_ingest.py`) instead of name-matched legacy stores, and rename the
`source` entity type to `outlet` end to end (backend contract + frontend).

Done: `exact_canonical_label`/org alias-map edges and coauthor/shared_outlet
synthetic reporter edges are gone; ownership edges come from
`AcceptedRelationship`/candidate `EvidenceClaim` rows with real evidence
citations; `sibling_via_owner` rollup emitted; merged entities collapse;
fresh-DB fallback still renders outlets; rename propagated through backend
contract, routes, and the whole frontend Atlas feature; legacy `"source"`
query-param/id values still work.

## Status: complete

## Files changed

Backend:
- `backend/app/models/atlas.py` -- `AtlasEntityType` -> `outlet`/`organization`/`person`/`reporter`; added `founded_by`/`sibling_via_owner` relation types; `AtlasSearchResponse.sources` -> `outlets` + `people`; `AtlasGraphStats.total_sources`/`visible_sources` -> `total_outlets`/`visible_outlets` + `total_people`/`visible_people`.
- `backend/app/services/atlas_graph_projection.py` -- rewritten. Outlet nodes from `EvidenceEntity(record_kind="publication")` (id preserved via `EntityExternalId(scheme="rss_catalog_key")`), reporter nodes unchanged, evidenced `employed_by` edges only. Fresh-DB fallback to catalog-derived outlets documented in the module docstring.
- `backend/app/services/atlas_evidence_projection.py` -- rewritten. Organization/person nodes from `EvidenceEntity`; ownership edges (`directly_owns`/`owns_equity_in`/`controls`/`founded_by`) from `AcceptedRelationship` (accepted) and un-materialized `EvidenceClaim` (candidate, `is_inferred=True`); `sibling_via_owner` root-walk rollup.
- `backend/app/services/atlas_entity_resolution.py` -- new. Shared `entity_survivor_map`/`canonical_entity_id`/`live_entities_by_kind`/`outlet_node_ids` helpers used by both projections so merged entities collapse identically everywhere.
- `backend/app/services/atlas_graph.py` -- merges both projections; computes `unresolved_source_links` itself (was previously returned by the legacy projection); entity-type-keyed stats/priority renamed.
- `backend/app/services/atlas_graph_helpers.py` -- `stable_source_id` now returns `"outlet:<digest>"` (digest unchanged); removed dead `SourceClaim`-era helpers (`_OWNER_CLAIM_TYPES`, `_LEGAL_ENTITY_CLAIM_TYPES`, `_claim_name`); added `normalize_entity_type_alias`/`normalize_entity_id_alias` for the legacy `"source"` query-param/id alias.
- `backend/app/services/atlas_entity.py` -- search/index/entity-detail rewritten for the rename; organization/person detail branches now read `EvidenceEntity` (with legacy `Organization` enrichment via `legacy_organization_id` external id, read-path only); outlet detail resolves via `rss_catalog_key` with a catalog-scan fallback.
- `backend/app/api/routes/wiki_atlas.py` -- entity/relation-type allowlists updated; legacy `"source"` accepted and normalized to `"outlet"` on `entity_types`/`selected`.
- `backend/tests/test_wiki_atlas_contract.py` -- updated one pre-existing fixture (`source:abc`/`"source"` -> `outlet:abc`/`"outlet"`).
- `backend/tests/test_atlas_phase2_projection.py` -- new, 6 tests (see below).

Frontend (rename only, no visual restructure):
- `frontend/features/intelligence-atlas/lib/atlas-schema.ts`, `lib/atlas-query-state.ts` -- entity/relation-type literals renamed/extended; stats fields renamed; legacy `"source"`/`"source:"` normalized on read in `parseAtlasQueryState`.
- `frontend/features/intelligence-atlas/atlas-graph.tsx` -- node shape/color map updated (`outlet` square, `organization` circle, `reporter` leaf, new `person` diamond); legend updated.
- `frontend/features/intelligence-atlas/atlas-index-sheet.tsx`, `atlas-stage-shell.tsx`, `atlas-topbar.tsx`, `atlas-inspector.tsx`, `intelligence-atlas-workspace.tsx`, `atlas.module.css` -- tabs/filter chips/search grouping/copy/CSS selectors renamed; "People" tab added.
- `frontend/workers/atlas-layout.worker.ts` -- `ownership` layout branch renamed `source` -> `outlet`, added a `person` grouping target.
- `frontend/features/intelligence-atlas/tests/atlas-schema.test.ts`, `tests/atlas-query-state.test.ts` -- fixtures updated; added a legacy-alias-normalization test.

Not touched (deliberately, per task scope): `SourceMetadata`, `SourceAnalysisScore`, `SourceClaim`/`SourceClaimEvidence` model/table names, `app/data/rss_sources.py`, `wiki_indexer.py`'s `WikiIndexStatus.entity_type == "source"` (a different, unrelated "wiki indexing status" concept), `app/services/source_research.py` and other "news source catalog" services, `frontend/app/wiki/ownership/source-intelligence-*` files. These all use "source" to mean the RSS catalog / outlet metadata store, not the Atlas entity-type literal.

## Design notes

- **Outlet id preservation**: `stable_source_id(name)` digest is unchanged; only its prefix moved from `"source:"` to `"outlet:"`. Since Phase 0/1 are uncommitted and no real backfill has run against a persisted DB yet, there was no live data to migrate -- new backfill runs pick up the new prefix automatically because `entity_backfill.py` calls the same (now-renamed) function.
- **Node/edge id scheme**: outlet = `outlet:<digest>` (via `rss_catalog_key`, falling back to a freshly computed digest for publications with no catalog key); organization = `organization:<evidence_entity_id>`; person = `person:<evidence_entity_id>`. This replaced the legacy `organization:<int Organization.id>` scheme -- the `Organization` SQL table is no longer a node/edge source, only an optional enrichment read via `EntityExternalId(scheme="legacy_organization_id")`.
- **Ownership percentage**: `qualifiers["pct"]` (0-100) is the primary source; when a `CalculationTrace(measurement_name="ownership_interest")` row exists for the relationship (multi-hop/aggregated interest, written by `evidence_spine._record_interest_trace`), its `result["aggregate"]` `{lower, upper}` percent band takes precedence and the midpoint is used, with the full range exposed in `edge.qualifiers["pct_range"]`.
- **`sibling_via_owner`**: built from the accepted `directly_owns`/`owns_equity_in` edge set only (not `controls`/`founded_by`). For each outlet, walk owner-of-owner (cycle-guarded) to a root; outlets sharing a root are paired into undirected, `is_inferred=True`, `fact_status="candidate"` edges with `claim_ids` = the union of claims along both paths.
- **Fresh-DB fallback**: gated on "zero `publication` `EvidenceEntity` rows" (i.e. Phase 0 backfill hasn't run). In that case outlet nodes come straight from `app/data/rss_sources.py`, and no organization/person nodes or ownership edges are produced (nothing exists in the spine to source them from) -- reporters are unaffected since they read `Reporter` independently. Documented in the `atlas_graph_projection.py` module docstring.
- **Merge collapsing**: `atlas_entity_resolution.entity_survivor_map` resolves `EntityResolution(decision="same_as", status="accepted")` chains; `live_entities_by_kind` excludes `status="merged"` entities and any non-survivor id (defense in depth). Both projections and every edge endpoint route through `canonical_entity_id` so a shadow entity never renders and its claims resolve onto the survivor node.
- **Two-projection architecture preserved**: kept the existing `atlas_graph_projection.py` (outlets/reporters) + `atlas_evidence_projection.py` (organizations/people/ownership) split and let `atlas_graph.py` union them, rather than merging into one file -- this matches the plan's explicit instruction to update `atlas_evidence_projection.py` for the rename, and let me reuse its already-tested evidence-citation assembly instead of rewriting it from scratch.

## Commands and tests run

- `backend/.venv/bin/pytest tests -m "not slow" -q` -- 534 passed (528 pre-existing + 6 new).
- `backend/.venv/bin/ruff check app/ tests/` -- all checks passed.
- `MYPYPATH=. backend/.venv/bin/mypy --explicit-package-bases app --strict` -- success, 167 source files, 0 issues.
- `cd frontend && npx tsc --noEmit` -- no output (clean).
- `cd frontend && npx eslint .` -- 0 errors, 1 pre-existing warning (`atlas-index-sheet.tsx` `useVirtualizer` incompatible-library warning, unrelated to this change, not introduced by it).
- `cd frontend && npx jest` -- 110 passed, 3 failed (`__tests__/blindspot-view.test.tsx` x2, `__tests__/search-inline-edit.test.tsx` x1); confirmed via `git stash` that these 3 fail identically on `main` before this change -- unrelated pre-existing failures, not touched.
- `cd frontend && npx jest features/intelligence-atlas` -- 6 passed (2 suites).

## New backend tests (`tests/test_atlas_phase2_projection.py`)

1. `test_ownership_edges_populate_from_accepted_relationships` -- two outlets + one owner + one founder, seeded through the real `evidence_spine.materialize_claim` acceptance path; asserts outlet/organization/person node ids, `directly_owns` edges (accepted, evidenced, `ownership_percentage`), `founded_by` edge direction, `sibling_via_owner` pairing, zero `exact_canonical_label`/`coauthor`/`shared_outlet` edges.
2. `test_candidate_claim_renders_as_candidate_edge_and_respects_accepted_only` -- un-materialized `directly_owns` claim renders as `fact_status="candidate"`/`is_inferred=True`, and disappears under `accepted_only=True`.
3. `test_merged_entity_collapses_to_survivor` -- a `status="merged"` shadow entity + accepted `same_as` resolution never renders as a second node.
4. `test_legacy_source_entity_type_param_normalizes_to_outlet` -- `_validated_entity_types("source")` -> `["outlet"]`.
5. `test_no_synthetic_reporter_edges_from_shared_bylines` -- two reporters sharing a byline still produce zero `coauthor`/`shared_outlet` edges.
6. `test_fresh_db_falls_back_to_catalog_outlets` -- empty DB still renders catalog-derived outlet nodes, no organization/person nodes.

## Assumptions / deviations

- Added `"controls"` -> `relation_type="ownership"` (matches the plan's existing `_canonical_relation` mapping convention) and a new `"founded_by"` `AtlasRelationType` literal (the plan says add "person" and "sibling_via_owner" to "relevant literals" -- `founded_by` was necessary too, since `controls`/`directly_owns` alone can't represent a founder edge honestly).
- `AtlasGraphStats`/`AtlasSearchResponse` field renames (`total_sources` -> `total_outlets`, `sources` -> `outlets`, new `people`) were not explicitly called out in the Phase 2 backend bullet list but are required by "stats/index/search/... services for the rename" in item 5; frontend schema updated in lockstep since backend+frontend ship together (same approach the plan takes for the search buckets).
- No legacy Phase-0-backfilled real database existed to migrate, so the outlet id prefix change is a pure rename with no data-migration script needed.

## Remaining / not in scope

- Phase 3+ (organization/person detail pages, ownership-chain visual, funding-vs-bias panel, directory-first UI restructure) is explicitly out of scope for Phase 2 and untouched.
- Did not regenerate `frontend/lib/generated/openapi.ts` -- the Atlas feature doesn't consume it (uses its own Zod schemas), and regenerating requires a live backend.
- No commits made, per instructions.
