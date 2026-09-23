# Globe wheel zoom

## Goal and done criteria

Enable wheel-up and wheel-down zooming on the globe without changing pan or selection behavior.

## Status

Implemented and runtime-verified on `http://localhost:3000/?view=globe`.

## Evidence

- `useGlobeCamera` was setting `controls.enableZoom` to `false` after mount.
- The existing control-state test failed before the fix with expected `true`, received `false`.
- After the fix, wheel-up enlarged the globe to a close-up and wheel-down reduced it to a small globe in the live browser.
- The globe material test fixture was also updated to the current `GlobeTextureSet` contract (`bumpTexture` and `surfaceMaskTexture`) so the type gate covers the live uniforms.
- The page had one canvas, no horizontal overflow, and no console errors. Existing warnings remained for React Grab version drift and multiple Three.js instances.

## Files changed

- `frontend/components/interactive-globe-lifecycle.ts`
- `frontend/__tests__/interactive-globe.test.tsx`
- `frontend/__tests__/globe-materials.test.ts`

## Commands and tests

| Command | Result |
| --- | --- |
| `npm --prefix frontend test -- --runInBand __tests__/interactive-globe.test.tsx` before source fix | Failed as expected |
| `npm --prefix frontend test -- --runInBand __tests__/interactive-globe.test.tsx` after source fix | Passed |
| `npm --prefix frontend test -- --runInBand __tests__/globe-materials.test.ts __tests__/interactive-globe.test.tsx` | Passed |
| `npm --prefix frontend run lint` | Passed |
| `npm --prefix frontend run build` | Passed |
| `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit` | Passed |
| `npm --prefix frontend test -- --runInBand` | 205 passed, 1 failed in unrelated `search-inline-edit.test.tsx` |
| `scripts/self-test` | Timed out at 120 seconds while running `./verify.sh`; no error output |

## Assumptions and risks

- The request applies to zoom only; pan remains disabled as before.
- The browser check used the open localhost browser because Chrome DevTools was unavailable (`DevToolsActivePort` missing).
- The remaining full-suite failure is outside the globe path: `search-inline-edit.test.tsx` renders navigation without the App Router context required by the current `global-navigation.tsx`.

## Documentation

Checked; no update needed because the existing UI copy already documents wheel zoom and this change restores the implementation to that contract.

## Rollback

Revert the `enableZoom` assignment and the matching test expectation.
