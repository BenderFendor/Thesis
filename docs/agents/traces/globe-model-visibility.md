# Globe model visibility repair

## Goal and done criteria

Restore the textured globe at `/?view=globe`, keep the existing resize-based
runtime, and leave a focused regression check for the host ref.

## Status

Implemented and runtime-verified in the local in-app browser.

## Files changed

- `frontend/app/news-page-layout.tsx`: give compact globe/scroll views a
  viewport-height shell.
- `frontend/components/interactive-globe-canvas.tsx`: attach the host ref.
- `frontend/components/interactive-globe.tsx`: pass the existing ref to the
  canvas host.
- `frontend/__tests__/interactive-globe-canvas.test.tsx`: cover ref forwarding.
- `docs/Log.md`: record the behavior repair.

## Commands and tests run

- `npm --prefix frontend run lint`
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit`
- focused Oxlint on the changed globe files
- focused Jest tests for `interactive-globe.test.tsx` and
  `interactive-globe-canvas.test.tsx`
- local browser verification at `http://localhost:3000/?view=globe`

The browser contained one `.scene-container canvas` measuring `727×1758`, and
the screenshot showed the textured globe. The previous broken state measured
`0×0` and showed no globe.

## Assumptions and risks

The user's “model” refers to the missing 3D globe model, not the research model
selector. The research selector remains on `/search`.

## Remaining failures or blockers

The repository-wide `scripts/self-test` gate still needs to be run; known
repository quality debt may remain outside this focused fix.

## Rollback or next executable step

Revert the three globe/layout source changes and the focused test if the globe
runtime regresses. Otherwise run the repository self-test and inspect only any
new failures attributable to these files.
