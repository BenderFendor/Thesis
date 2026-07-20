# Unified Intelligence Atlas

## Goal and done criteria

- Make `/wiki/ownership` the only media intelligence workspace.
- Preserve the source-directory data and reporter-network behavior in the Atlas.
- Fix the graph-wide datetime validation failure.
- Add development-only right-click component inspection without production bundle weight.
- Improve graph and collapsed-navigation readability without dropping records.

## Status

Complete. Rendered browser verification could not run because neither the in-app browser nor Chrome DevTools connection was available. The production build and live API smoke passed.

## Files changed

- Atlas backend projection, models, routes, tests, and generated OpenAPI files.
- Atlas frontend schema, query defaults, graph, index, inspector, styles, and tests.
- Global navigation configuration and collapsed item layout.
- Root layout development tooling.
- README, Atlas documentation, log, known errors, and learnings.
- Removed the former Media Wiki page and Reporter Graph page/components.

## Commands and tests run

- `npm --prefix frontend test -- --runInBand features/intelligence-atlas/tests/atlas-schema.test.ts features/intelligence-atlas/tests/atlas-query-state.test.ts __tests__/global-navigation.test.tsx`: 12 passed.
- Focused Atlas/reporter backend tests: 24 passed.
- Fresh backend on port 8010 plus Atlas graph request: 350 nodes, 1,472 edges, 261 reporters, 118 coauthor edges, and 1,352 shared-outlet edges.
- `npm run openapi:refresh`: passed.
- `scripts/self-test`: passed through `./verify.sh`; production build, TypeScript, strict mypy, Ruff, Rust Clippy/format/binding build, and 450 backend tests passed with 3 slow tests deselected.
- `git diff --check`: passed.

## Assumptions and risks

- Database datetimes without offsets are UTC because `get_utc_now()` stores naive UTC values.
- `shared_outlet` is marked inferred; it shows observed shared publication surfaces, not proof of employment.
- Atlas source analysis remains empty where the local database has no stored score rows.
- The existing TanStack Virtual React Compiler lint warning remains a warning, not an error.
- Post-change desktop/mobile screenshots remain unverified because browser control could not connect.

## Rollback

Revert this change set. No database migration or persisted-data mutation was made.
