# SCOOP Intelligence Atlas

`/wiki/ownership` is the only media intelligence workspace. It combines the former source directory and Reporter Graph with source, organization, reporter, and evidence relationships. Source and reporter dossiers remain detail records opened from the Atlas. The operator tools remain in a separate sheet.

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

Reporter network edges are derived from persisted article-author observations. `coauthor` links count shared articles and include article evidence previews. `shared_outlet` links count outlets where both reporters have observed bylines and remain marked as inferred. Stored source-analysis scores appear in the entity index and source inspector.

## Rendering and accessibility

The default graph is bounded to 350 nodes and 1,500 relationships. Layout runs in a Web Worker and is deterministic for a graph version and layout mode. SVG is retained for the bounded production view. The fitted overview labels the 28 highest-salience records; hovering or focusing exposes one record and its neighborhood, and zooming reveals every label. The complete entity set remains available through the synchronized semantic list and entity index. Roving node focus, Enter/Space selection, arrow navigation, pointer pan, pointer-centered zoom, touch-safe pointer events, and reduced-motion behavior keep the graph operable without hover or a mouse.

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
