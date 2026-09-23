# Workspace shortcut polish

## Goal and done criteria

Make the globe header's Saved and Research links read as one intentional
workspace control group, remain reachable beside the fixed navigation, and keep
their existing routes.

## Status

Implemented and verified in the local browser at `/?view=globe`.

## Files changed

- `frontend/app/news-page-header.tsx`: grouped and restyled Saved and Research.
- `frontend/app/news-page-layout.tsx`: anchored the absolute globe header to
  the content column.
- `docs/Log.md`: recorded the user-visible change.

## Verification

- The live browser shows both `Saved` and `Research` in one bordered shortcut
  group.
- Accessibility state exposes both links with descriptions and their original
  destinations.
- The globe remains rendered behind the header.
- Frontend Oxlint, frontend TypeScript, and `git diff --check` pass.

## Assumptions and risks

The requested improvement applies to the global globe-header shortcuts, not to
the separate Saved or Research page interiors. Existing navigation behavior and
routes are unchanged.

## Rollback

Revert the header shortcut class/group changes and the `relative` content-column
anchor if a non-globe route shows a header positioning regression.
