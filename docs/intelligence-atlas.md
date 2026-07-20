# SCOOP Intelligence Atlas

`/wiki/ownership` is the canonical investigation workspace for source, organization, reporter, and evidence relationships. The Atlas replaces the former always-visible three-column operations dashboard with a graph-first research surface while retaining the existing operator tools in a separate sheet.

## Route state

Shareable state is encoded in the query string: search, entity types, relation layers, country/funding/bias facets, minimum confidence, selected entity, neighborhood depth, focus mode, layout, and open panel. Browser back/forward therefore restores the investigation instead of resetting local component state.

## API contracts

The Atlas uses typed endpoints under `/api/wiki/atlas`:

- `GET /graph` returns a bounded, internally consistent graph with a version, generation timestamp, filters, truncation state, typed nodes, typed relationships, confidence, and evidence previews.
- `GET /stats` returns graph coverage with numerators and denominators.
- `GET /search` returns grouped entity suggestions.
- `GET /entities/{id}` and `/connections` return the record and traceable relationships.
- `GET /index` provides server-filtered cursor pagination.
- `POST /export` produces versioned JSON or CSV evidence bundles.

The legacy `/api/wiki/organizations/graph` remains available during migration.

## Trust rules

The Atlas does not create ownership links through substring containment. Source-to-organization links come from current source claims, explicit source metadata, or exact canonical identity matches. Ambiguous candidates remain unresolved. Reporter verification requires person-level profile evidence; repeated bylines can support an outlet observation but do not independently verify identity.

## Rendering and accessibility

The default graph is bounded to 350 nodes and 1,500 relationships. Layout runs in a Web Worker and is deterministic for a graph version and layout mode. SVG is retained for the bounded production view. A synchronized semantic entity list, roving node focus, Enter/Space selection, arrow navigation, pointer pan, pointer-centered zoom, touch-safe pointer events, and reduced-motion behavior keep the graph operable without hover or a mouse.

## Relationship backfill

Run a dry audit first:

```bash
python backend/scripts/backfill_atlas_relationships.py
```

Apply only after reviewing `artifacts/atlas-relationship-backfill.json`:

```bash
python backend/scripts/backfill_atlas_relationships.py --apply
```

The backfill is idempotent with respect to equal-or-stronger current claims and never overwrites stronger manual evidence with its weaker metadata-derived claim.
