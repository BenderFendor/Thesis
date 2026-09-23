# Globe country selector and coverage lenses

## Goal and done criteria

Make the global globe workspace provide an explicit country selector and keep
local and external coverage controls discoverable in the compact layout.

## Status

Implemented and verified in the live local browser at `/?view=globe`.

## Files changed

- `frontend/components/globe-view-collapsed-header.tsx`: added the accessible
  Country focus selector.
- `frontend/components/globe-view-layout-props.ts`: derives ranked country
  options and routes selection through the existing globe handler.
- `frontend/components/globe-view-collapsed-panel.tsx`: keeps compact lens
  content rendered instead of hiding it until sheet expansion.
- `docs/Log.md`: recorded the user-visible behavior.

## Verification

- Accessibility state exposed Country focus, Global focus, and populated country
  options.
- Browser selection of US changed the heading to United States and loaded country
  articles.
- Browser switching to World Lens changed the active tab and rendered the outside
  source lens copy.
- `npm --prefix frontend run lint` passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit` passed.
- `npm --prefix frontend test -- --runInBand __tests__/interactive-globe-canvas.test.tsx`
  passed (1 suite, 1 test).
- `git diff --check` passed.
- The required `scripts/self-test` completed in 109.344 seconds without timing out,
  but exited 1 from the repository verifier with only `verification repo: failed` in
  its output. The watchdog report is
  `docs/agents/traces/globe-country-lenses-watchdog.json`.

## Assumptions and risks

Country options use the existing country codes and article counts because the
globe metrics contract provides counts, while the existing selection flow resolves
the display name after selection. No new API or map-data contract was added.

## Remaining failures or blockers

The repository-wide `scripts/self-test` quality gate remains a separate existing
backlog failure and is recorded in `docs/agent/known-errors.md`; it does not identify
the focused globe files as failing.

## Rollback

Revert the selector prop plumbing and the compact-panel visibility change to
restore the previous map-click-only, sheet-expanded lens behavior.
