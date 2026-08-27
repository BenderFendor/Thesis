# Startup log errors: five fixes

## Goal and done criteria
Clean up five recurring errors in the runlocal startup logs
(2026-07-22): vector DuplicateIDError, LittleSis file missing, wikidata
contradictions failing the evidence_ingestion stage every restart, one
dead publisher killing the ads_txt adapter, and the chromadb posthog
telemetry error.

## Status
Done, 2026-07-22. Verified by orchestrator: full suite 709 passed /
3 skipped (baseline 697/3, +12 new regression tests, 0 regressions).
Needs one full `./runlocal.sh` restart to confirm a clean log.

## Per-fix results
1. DuplicateIDError: `batch_add_articles` already upserts; Chroma was
   rejecting duplicate chroma_ids WITHIN one batch (same article via two
   feeds in one flush). Fixed by keep-last dedupe inside
   `batch_add_articles` (vector_store.py), covering all callers.
   Upgrading chromadb would not have helped - every version rejects
   in-batch duplicate ids.
2. LittleSis: `ingest_littlesis_ownership` now auto-downloads the bulk
   files when absent (idempotent; one WARNING and graceful empty report
   when offline; file-not-found downgraded ERROR->WARNING). Found and
   fixed a real upstream break: LittleSis moved bulk data to
   `/database/public_data/` and switched from JSONL to a minified
   JSON:API array - old parser crashed on the real file. New streaming
   reader handles both formats. Live verified: entities.json.gz 74MB +
   relationships.json.gz 106MB downloaded to backend/data/littlesis/,
   8,362 media-related entities parsed.
3. Wikidata contradictions: opening an adjudication item is the designed
   outcome, not a failure. New `ContradictionError(EvidenceSpineError)`
   from `materialize_claim`; counted in `IngestReport.adjudications_opened`
   (claim still a candidate - acceptance gate untouched), logged at INFO,
   run status stays success. Real policy-gate failures still mark partial
   and raise. `_open_adjudication_item` already deduped via deterministic
   id (test-confirmed: 3 reruns -> 1 item).
4. ads_txt: per-publisher fetch wrapped in try/except httpx.HTTPError;
   skip-and-count with one summary line; raises only when every publisher
   is unreachable.
5. Chroma telemetry: `ANONYMIZED_TELEMETRY=False` on the `chroma run`
   launch in runlocal.sh; client Settings already had
   anonymized_telemetry=False. Known chromadb 0.5.23 / posthog 7.9.4
   incompatibility; upgrade to chromadb 1.x deferred as its own task
   (on-disk migration risk against the freshly rebuilt store).

## Files
backend/app/vector_store.py, backend/app/services/littlesis_integration.py,
backend/app/services/evidence_ingest.py, backend/app/services/evidence_spine.py,
backend/app/services/auto_ingest.py, runlocal.sh. Tests: new
test_littlesis_integration.py (6), test_evidence_ingest_adjudication.py (3);
edited test_vector_store_logging.py (+1), test_evidence_ingest_ads_supply.py (+2).

## Commands and results
- `cd backend && uv run pytest tests/ -q` - 709 passed, 3 skipped.
- Live LittleSis download + parse verified during implementation.

## Remaining / risks
- Full runlocal restart still pending (gunicorn workers do not pick up
  code without it).
- First post-restart littlesis ingest will process the new bulk files -
  expect a longer evidence_ingestion stage on that run.
- chromadb 1.x upgrade intentionally deferred.
