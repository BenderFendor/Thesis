# Intelligence Atlas datetime debug trace

## Failure

The Atlas rendered the Zod error list instead of the graph. Paths included `edges.*.valid_from`, `edges.*.last_verified_at`, and `edges.*.evidence_preview.*.retrieved_at`.

## Reproduction and first wrong transition

- Live request: `GET /api/wiki/atlas/graph?limit_nodes=350&limit_edges=1500&include_evidence_preview=true`.
- Actual API value: `2026-04-17T20:24:39.422665`.
- Frontend contract: `z.string().datetime({ offset: true })`.
- Expected boundary behavior: accept the project database's naive UTC ISO value and expose an offset-bearing string to the UI.
- First wrong transition: `frontend/features/intelligence-atlas/lib/atlas-schema.ts` rejected the valid database value while parsing the response.

## Fix

`AtlasDateSchema` preserves valid offset-bearing values and adds `Z` only when the same ISO value validates after restoring the UTC marker.

## Regression evidence

- Added a frontend schema test covering node, edge, and evidence timestamps without offsets.
- Focused frontend tests passed.
- Full `scripts/self-test` passed.
