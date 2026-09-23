# Search stream visibility repair

## Goal and done criteria

Show agent reasoning and tool activity in the active search response, keep the stream compatible
with deployed event shapes, and finish the response when the deployed completion payload omits
newer optional fields.

## Status

Frontend implementation and focused regression coverage are complete. The live browser flow is
not completion-verified because the configured API did not expose a research event within the
smoke-test window.

## Files changed

- `frontend/app/search/research/model/types.ts`
- `frontend/app/search/research/model/schemas.ts`
- `frontend/app/search/research/stream/protocol.ts`
- `frontend/app/search/research/stream/raw-events.ts`
- `frontend/app/search/research/hooks/use-research-transport.ts`
- `frontend/app/search/research/components/message-item-body.tsx`
- `frontend/__tests__/search-research-stream.test.ts`
- `docs/Log.md`
- `docs/agents/traces/search-stream-visibility-repair.md`

## Evidence and commands

- The page request used the configured `https://api.jordandgreen.com` API host. Before the abort
  fix, Network events reported `net::ERR_ABORTED` before `responseReceived` for the research
  stream.
- The frontend previously handled only `thinking_step`; raw `thinking`, `tool_start`, and
  `tool_result` events were silently ignored. The active message rendered only the spinner.
- The transport recreated its abort-state object on every render. The placeholder update caused
  the cleanup effect to run and abort the request before the first response event.
- The completion schema previously rejected the deployed shape when `thinking_steps` was absent
  or `structured_articles` was a string.
- `npm --prefix frontend test -- --runInBand __tests__/search-research-stream.test.ts` passed.
- `npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit` passed.
- Focused Oxlint for the changed frontend files passed with 0 errors and 0 warnings.
- `git diff --check` passed.
- After the abort fix, an in-app browser smoke request received HTTP 200 and
  `Network.loadingFinished`; a second request was aborted only after manually pressing Stop.
  No thinking or tool event appeared in the UI during approximately 10.5 seconds, so live event
  delivery remains unverified.
- `scripts/self-test` and direct `./verify.sh` completed with the repository gate result
  `verification repo: failed`; the measurement recorded 2 CCCC violations and 136 maintainability
  index violations outside this focused change.

## Assumptions and risks

- The API may emit both raw tool events and normalized thinking steps. The stream state drops only
  adjacent duplicate steps so the research log does not show the same tool call twice.
- The browser uses the repository's existing production API setting. This change does not alter
  that setting or deploy backend code.

## Remaining blocker and next executable step

The configured API stream needs to expose a thinking or tool event before the UI can be verified
end to end. After that response is available, reload `http://localhost:3000/search`, submit a
query, and confirm the active assistant card and Research Log show tool requests and observations
before the final answer.

## Rollback

Revert the seven frontend files listed above and the corresponding log and trace entries. No
database or host configuration was changed.
