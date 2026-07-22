# SCOOP Intelligence Atlas

`/wiki/ownership` is the media ownership intelligence workspace. It is
directory-first: the default landing surface is a searchable, faceted,
paginated entity directory, not a graph. Rows navigate straight to the
entity's own profile page. The force-directed graph is a secondary "Explore
graph" view for neighborhood exploration, reachable from the workspace's
view tabs or a compact "Explore neighborhood" link on entity profile pages.

## Data model: the evidence spine

Ownership, funding, and bias facts come from a bitemporal evidence spine
(`backend/app/models/evidence.py`), not from the legacy `Organization` table
columns. The spine's core chain:

```
EvidenceDocument -> DocumentSnapshot (sha256) -> EvidenceObservation
  -> EvidenceClaim (predicate, claim_hash-deduped) -> ClaimEvidence
```

Claims that clear the acceptance policy (`evidence_policy.py`) materialize
into `AcceptedRelationship` rows; SEC EDGAR and referenced-Wikidata claims
auto-accept, LittleSis/MBFC/scraped claims go through the reviewer-gated
adjudication flow in `wiki_evidence.py`. `CalculationTrace` records how a
derived value (an indirect-ownership percentage, a correlation statistic)
was computed, from which inputs.

Entities live in `EvidenceEntity`, one record per real-world thing, resolved
against external identifiers in `EntityExternalId` (`wikidata_qid`,
`littlesis_id`, `domain`, `mbfc_id`, `cik`, `rss_catalog_key`):

- `record_kind="publication"` -> **outlet** (a news site/RSS catalog entry).
- `record_kind="legal_entity"` / `"organization_without_legal_identity"` ->
  **organization** (an owning/funding/parent legal entity -- distinct from
  the outlet it may publish).
- `record_kind="person"` -> **person** (an owner, mogul, or founder).
- **reporter** stays a separate first-class type, sourced from byline/article
  attribution data (`Reporter`, `ArticleAuthor`), not the evidence spine.

The legacy `Organization.parent_org_id`/`ownership_percentage`/`owned_by`/
`parent_orgs`/`part_of` columns (`backend/app/database.py`) are
read-path-deprecated: the Atlas ownership graph and profile pages no longer
read them. They are not fully dead code (`wiki_indexer.py` still writes
`parent_org_id`; `source_credibility.py` and the plain
`GET /api/wiki/organizations` list endpoint still read some of them) and no
migration has dropped them -- see the class docstring in `database.py` for
the exact remaining readers/writers.

## Ingestion CLIs

These three pipelines also run automatically -- see "Automatic startup
ingestion" below. The CLIs remain useful for a manual/one-off run (e.g. a
single source with `--limit`) or when auto-ingest is disabled. Run in this
order against a configured database (`app.database.AsyncSessionLocal`):

1. **`python -m app.scripts.backfill_entities`** -- one-time entity-model
   unification. Creates an `EvidenceEntity`/`EntityExternalId` pair for every
   RSS catalog source, and auto-merges `Organization(org_type="publisher")`
   rows into the matching publication entity on exact domain match
   (ambiguous cases queue an `AdjudicationItem`). Idempotent.
2. **`python -m app.scripts.ingest_evidence --source wikidata|littlesis|mbfc|edgar|all [--limit N]`**
   -- writers that populate the evidence spine from Wikidata (P127/P749/
   P112/P169 via SPARQL), a LittleSis bulk dump, the MBFC outlet dataset, and
   SEC EDGAR Exhibit-21 subsidiary lists. Scoped to catalog outlets and their
   ownership ancestors (BFS, depth <= 3), not a bulk import. Deterministic
   document/snapshot ids and claim-hash deduplication make repeated runs
   safe.
3. **`python -m app.scripts.run_funding_bias_analysis`** -- preregisters the
   funding-type-vs-bias-rating correlation methodology (idempotent, a no-op
   after the first run), then computes and persists the current contingency
   table and Cramer's V as a `CalculationTrace`. Powers
   `GET /api/wiki/atlas/analysis/funding-bias` and the
   `/wiki/analysis/funding-bias` page.

`backend/scripts/backfill_atlas_relationships.py` is a separate, older
backfill for the pre-spine `SourceClaim`/`SourceClaimEvidence` tables; it
still runs but is not part of the evidence-spine ownership pipeline above.

## Automatic startup ingestion

`app.services.auto_ingest.run_auto_ingest` runs the three pipelines above
automatically as a background task once the API server is up -- no manual
CLI steps are needed to run `./runlocal.sh` (or any other launcher that
starts `app.main:app`, e.g. `gunicorn -c gunicorn.conf.py app.main:app`).
It's launched from `app.main.on_startup` the same way the wiki indexer and
reporter indexer are: only on the elected leader worker, ~10s after the
server starts serving requests, so it never blocks or delays startup.

- **Order**: entity backfill -> evidence ingestion (all sources) ->
  funding-bias analysis, matching the CLI order above.
- **Graceful degradation**: each pipeline's failure (e.g. Wikidata/EDGAR/
  LittleSis/MBFC unreachable) is logged as a warning and the orchestrator
  moves on; a failure never aborts the app or a later stage. Each evidence
  source is also independently wrapped, so e.g. an offline Wikidata doesn't
  skip LittleSis/MBFC/EDGAR.
- **Interval guard**: the network-bound evidence-ingestion stage is skipped
  if a prior run succeeded within `SCOOP_AUTO_INGEST_INTERVAL_HOURS` (default
  24h), so repeated restarts don't hammer external APIs. The local, cheap
  entity backfill runs on every start regardless. Last-success state reuses
  the existing `wiki_index_status` table (`entity_type="auto_ingest"`) --
  no new table.
- **Disabling**: set `SCOOP_AUTO_INGEST=0` (or `false`) to disable entirely,
  e.g. for tests/CI. Enabled by default.
- **Extending**: to add a future pipeline, write an idempotent
  `async def _run_my_pipeline(db: AsyncSession) -> object` in
  `app/services/auto_ingest.py` and append
  `Stage("my_pipeline", _run_my_pipeline, network_bound=...)` to `STAGES`.
  Nothing else needs to change.

## UI structure

- **`/wiki/ownership`** (`intelligence-atlas-workspace.tsx`) -- directory by
  default (`AtlasEntityList`, `variant="page"`): search, All/Outlets/
  Organizations/People/Reporters tabs, country/funding/bias facets, sortable
  virtualized rows. A row click navigates to the entity's profile page
  (`profile_path` from the API: `/wiki/source/{name}`,
  `/wiki/organization/{id}`, `/wiki/person/{id}`, `/wiki/reporter/{id}`).
  The same list component (extracted from the former `AtlasIndexSheet`
  modal, which no longer exists) can also run in a bounded `variant="modal"`
  mode if a future caller needs it embedded in a dialog.
- **"Explore graph" tab** (same workspace, `view=graph` in the URL) -- the
  original force-directed canvas (`atlas-graph.tsx` + its layout Web Worker),
  filters, layout modes, record dock, and the accessible synchronized list
  (`atlas-accessible-list.tsx`) are unchanged. Demoted, not removed.
- **Profile pages** -- `/wiki/source/[sourceName]`, `/wiki/organization/[id]`,
  `/wiki/person/[id]`, `/wiki/reporter/[id]` render an evidence-backed
  ownership chain (`ownership-chain.tsx`, ultimate owner down to the entity,
  percentage ranges, evidence-count badges), a "controls" rollup (everything
  the same ultimate owner reaches), a funding-and-bias panel
  (`funding-bias-panel.tsx`, claims preferred over legacy values, always
  carrying a "correlation shown, not proven causation" caption), and a
  compact "Explore neighborhood" link into the graph view, pre-focused on
  that entity (`/wiki/ownership?view=graph&selected=<id>&neighbors=1&focus=1`,
  built by `buildAtlasNeighborhoodHref` in `lib/atlas-query-state.ts`) --
  the full canvas is never embedded on a profile page.
- **`/wiki/analysis/funding-bias`** -- the catalog-wide correlation:
  methodology card, contingency table, Cramer's V statistic, limitations,
  and the same correlation caption.

## Route state

Shareable state is encoded in the query string: search, entity types,
relation layers, country/funding/bias facets, minimum confidence, selected
entity, neighborhood depth, focus mode, layout, the open panel, and the
active view (`directory`/`graph`, default `directory`). Legacy links
(`panel=index`, a `selected` id with no `view` param, the old `source`
entity-type alias) are normalized on read rather than rejected, so bookmarked
Atlas URLs from before the Phase 6 restructure keep working. Browser
back/forward restores the investigation instead of resetting local component
state.

## API contracts

The Atlas uses typed endpoints under `/api/wiki/atlas`:

- `GET /graph` returns a bounded, internally consistent graph with a
  version, generation timestamp, filters, truncation state, typed nodes,
  typed relationships, confidence, and evidence previews.
- `GET /stats` returns graph coverage with numerators and denominators.
- `GET /search` returns grouped entity suggestions.
- `GET /entities/{id}` returns the record, its evidence trail, connections,
  and (for outlet/organization/person) the ownership chain, controls
  rollup, sibling-via-owner grouping, external ids, and funding-and-bias
  block.
- `GET /index` provides server-filtered cursor pagination -- backs the
  directory.
- `POST /export` produces versioned JSON or CSV evidence bundles.
- `GET /analysis/funding-bias` returns the catalog-wide correlation
  (`available: false` with an empty shape, not a 404, before the CLI has run).

The legacy `GET /api/wiki/organizations/graph` force-directed endpoint and
its `source-intelligence-workspace.tsx`/`ownership-graph-canvas.tsx`
frontend were removed in the Phase 6 cleanup; the plain
`GET /api/wiki/organizations` list endpoint (no graph) remains.

## Trust rules

Ownership edges come from `AcceptedRelationship`/`EvidenceClaim` rows tied
to real evidence -- no exact-canonical-label or substring-containment
inference. Reporter verification requires person-level profile evidence;
repeated bylines can support an outlet observation but do not independently
verify identity. Reporter network edges are derived from persisted
article-author observations: `coauthor` links count shared articles with
evidence previews, `shared_outlet` links are marked inferred.

## Rendering and accessibility

The graph view is bounded to 350 nodes and 1,500 relationships. Layout runs
in a Web Worker and is deterministic for a graph version and layout mode.
The fitted overview labels the highest-salience records; hovering or
focusing exposes one record and its neighborhood, and zooming reveals every
label. The full entity set remains available through the synchronized
semantic list (in the graph view) and the directory (as the primary
surface). Roving node focus, Enter/Space selection, arrow navigation,
pointer pan, pointer-centered zoom, touch-safe pointer events, and
reduced-motion behavior keep the graph operable without hover or a mouse.
The directory is a plain list of buttons/rows -- standard keyboard/tab
semantics apply, no bespoke roving-focus implementation needed.
