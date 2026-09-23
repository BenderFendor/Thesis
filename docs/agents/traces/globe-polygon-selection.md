# Restore globe country selection

Goal: restore main-branch polygon selection, remove the temporary country picker,
and keep workspace navigation in the sidebar.

Evidence: main preserves complete GeoJSON features. The schema introduced during
module extraction in `07cc7fa` stripped `type` and `geometry.type`. The installed
three-globe renderer skips geometry without Polygon or MultiPolygon type.

Changes: preserve geometry and feature discriminators in the shared schema;
remove dropdown plumbing; remove duplicate header navigation; stack lens articles
vertically and give selected-country content more compact-screen height.

Verification: geometry regression covers both polygon forms and finite d3
centroids. Frontend lint and TypeScript pass. Live browser shows country polygons;
a coordinate click selected Bolivia, and World Lens displayed an Argentine source.
The temporary country selector and duplicate view tabs are absent.

Scope: no branch checkout or unrelated worktree changes were reverted. Existing
country-click camera and briefing handlers are reused.

Repository verification: scripts/self-test exited 1 with `verification repo: failed`.
It supplies no check-level failure details in its default output. Focused geometry
regression, frontend lint, TypeScript, and diff whitespace checks passed.

Rollback: revert the scoped schema, header, and panel changes. Do not replace the
whole working tree with main because it contains unrelated user changes.
