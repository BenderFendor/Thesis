# Lean and TLA+ codebase audit

## Purpose and status

This is the cumulative record for the repository audit. Add later audit rounds here with the inspected scope, source evidence, model results, and unresolved risks. Keep each finding tied to implementation paths and label unmeasured hypotheses.

Initial round recorded 2026-09-22 at repository commit 3866e4c with a dirty working tree. The audit inspected the code paths below and several related ingestion, research, quality-hardening, and evidence paths. This is not a proof of every repository behavior. The TLA+ and Lean artifacts are abstract models, not source-linked verification.

No application source files were changed for this audit.

## Findings

### High: reporter metadata can reach verified without checking the profile page

The local-profile path reads an author URL from article JSON-LD after matching the byline name. The indexer can retain that URL and label it as an official author page. The scorer accepts the URL and citation label when assigning verified status; this path does not require fetching the profile page and matching its name.

Evidence: backend/app/services/reporter_public_records.py:584-601; backend/app/services/reporter_indexer.py:727-759, 962-970, 1033-1052; backend/app/services/reporter_confidence_scorer.py:248-258, 349-352.

Model: ReporterPromotion shows a counterexample to VerifiedNeedsProfileNameMatch. This model records the missing verification condition; it does not validate the URL against a live publisher.

### Medium: wrong-owner quality release changes task state before lock validation

The CLI transitions a task to queued before releaseWriter checks the requested session against the lock owner. A wrong-owner request can therefore leave a queued task with a live lock. The finish path also changes task state and appends its ledger entry before the lock-owner check. CLI commands default the session to the process ID, so separate invocations need an explicit shared session to refer to the same owner.

Evidence: scripts/quality-hardening/cli.mjs:38, 168-171; scripts/quality-hardening/queue.mjs:239-244; scripts/quality-hardening/writer-claim.mjs:107-114.

Model: QualityRelease produces a counterexample to QueuedTaskHasNoLiveLock.

### Medium, caller-dependent: overlapping research requests can strand a streaming placeholder

The prompt hook has no searching guard. The normal composer is disabled while a request runs, but alternate or reentrant callers can overlap. The transport identifies placeholders with Date.now(), aborts the previous request, and appends a new placeholder. The old request's cancellation path does not terminalize its placeholder; timestamp collisions can also make updates target multiple rows with the same ID.

Evidence: frontend/app/search/research/hooks/use-research-prompt.ts:246-276; frontend/app/search/research/hooks/use-research-transport.ts:65-75, 183-214; frontend/app/search/research/stream/protocol.ts:392-407; frontend/app/search/research/stream/activity-protocol.ts:14-29.

Model: ResearchOverlap produces a counterexample to IdsUnique. The affected frontend paths were uncommitted working-tree files during this audit, so this finding describes the inspected snapshot and is not attributed to commit 3866e4c.

### Low, conditional: the quality verifier compares status strings, not dirty-file contents

The verifier checks porcelain status before and after a command. A command that changes the contents of a path already marked dirty can leave the same status string and appear unchanged. The current quality-hardening configuration did not show a tracked-source mutator, so this is a guard weakness; a live repository mutation was not demonstrated.

Evidence: scripts/quality-hardening/verify.mjs:36-43, 112-131; quality-hardening.config.json.

Model: VerifierSnapshot produces a counterexample to NoFalseClean.

### Low, conditional: production evidence lineage writes were not found

The audit found SourceLineage in the model, reader, and manually seeded integration test, but did not find a production writer. If external ingestion mirrors documents without storing lineage, independent-root counts could overstate evidence independence. The default minimum-root policy is one, which limits the current effect on the acceptance boolean.

Evidence: backend/app/services/evidence_spine.py:115-142, 689-709; backend/app/models/evidence.py:373-399; backend/tests/test_evidence_spine_integration.py:381-404; backend/app/services/evidence_policy.py:40.

Status: conditional on the external ingest path and its persisted schema; inspect the full data flow before treating this as a confirmed behavior defect.

## Properties checked

- Auto-ingest records overall completion only after every modeled adapter succeeds. TLA+ checked MarkerSound. The inspected implementation currently has one network stage; incomplete evidence ingestion raises PartialIngestError.
- An incomplete RSS full refresh retains cached articles for the incomplete source while replacing data from a successful source. TLA+ checked both cache invariants. Existing readiness tests cover incomplete-source behavior.
- The Rust RSS parser path calls the PyO3 binding directly. No Python fallback was found in the inspected binding path.

These are bounded checks of the cited paths, not repository-wide proofs.

## Initial formal-check results

Lean 4.34.0 compiled Audit.lean. It proves small witnesses for status/content mismatch, wrong-owner release desynchronization, RSS cache retention, and duplicate message IDs, plus the modeled auto-ingest gate.

TLC completed these bounded checks:

- ReporterPromotion: counterexample to VerifiedNeedsProfileNameMatch.
- ResearchOverlap: counterexample to IdsUnique.
- QualityRelease: counterexample to QueuedTaskHasNoLiveLock.
- VerifierSnapshot: counterexample to NoFalseClean.
- AutoIngest: MarkerSound passed across 10 distinct states.
- RSSCache: both invariants passed across 2 distinct states.

The model sources and configurations are in [formal-audit](../formal-audit/README.md). The initial failing models remain useful counterexample records; the corrected models and implementation were checked again in the fix round below.

## Fix round 2026-09-22

The four confirmed findings were fixed in the source paths and covered with regression checks:

- Reporter verification now requires explicit evidence that a publisher or archived profile was fetched and its name matched the reporter. Article JSON-LD author URLs are labeled as observed metadata. Verified citation writers attach the name-match evidence, and the quality audit no longer counts an unattested URL.
- Quality task release and finish now validate the writer session and task before changing task or ledger state. Wrong-owner and wrong-task requests are rejected with the task and lock preserved.
- Research requests use unique UUIDs for message and tool IDs. When a request is superseded, its own streaming placeholder is closed without changing the newer request's searching state.
- The quality verifier compares Git status, index entries, and hashes of dirty and untracked working-tree paths, so changing an already-dirty file is detected even when porcelain output is unchanged.

The conditional lineage concern remains unconfirmed: no production writer was found, but the current minimum-root policy is one and no multi-root acceptance defect was established. No lineage implementation was added.

Lean 4.34.0 compiled `Audit.lean`. TLC 2.19 checked all six models with their corrected invariants: AutoIngest (10 states), QualityRelease (6), RSSCache (2), ReporterPromotion (6), ResearchOverlap (3), and VerifierSnapshot (3). The repeatable entry point is `scripts/formal-audit`; the model limitations remain as described above.

Focused verification passed for the four reporter test modules (47 tests), the research stream regression (3 tests), and the quality-hardening controller and verifier tests (8 tests). Backend Ruff and frontend Oxlint passed for the changed paths; the frontend TypeScript check also passed. Per the user's scope instruction, the repository-wide self-test was not run.

## Remaining scope

The initial audit covered selected ingestion, research, reporter, and quality-hardening paths, not every source file in the repository. Expand the inventory in later rounds. Keep the initial self-test findings distinct from this focused fix round.

## Performance and algorithm review

Lean and TLA+ can help with speed work, but they do not measure runtime performance.

- Lean can specify operation counts, prove asymptotic or amortized bounds for a chosen algorithm, and check that an optimization preserves its functional contract. This is useful for narrow routines such as evidence deduplication, lineage traversal, ranking, and cache lookup after a profile identifies them as hot paths.
- TLA+ can model request concurrency, worker and database-pool limits, bounded queues, retries, timeouts, rate limits, and cache updates. TLC can check safety, deadlock, and liveness under those limits. Its runtime reports model exploration cost, not application latency or throughput.
- A profiler and repeatable workload are the oracle for actual speed. Measure latency, CPU time, allocation, database query count and duration, queue depth, and external-call time before changing an algorithm. Re-run the same workload after the change.

Initial profiling candidates, not confirmed bottlenecks: research orchestration and external tool calls; RSS source fan-out and timeout handling; evidence deduplication and lineage traversal; database query patterns; frontend globe rendering and research stream updates. No application-runtime profile or before/after benchmark was collected in this round.

One setup-level performance observation was collected: the required repository self-test ran for 121.888 seconds with a watchdog-reported maximum child RSS delta of 1,788,856 KB. It exited 1 without timing out. Its measurement listed 2 CCCC violations and 141 code-multivitals violations; Oxlint and CRAP passed. This measures the verification workflow, not application latency. Per-check timings are still needed to identify which verifier stage dominates.

References: [Lean recursive definitions](https://lean-lang.org/doc/reference/latest/Definitions/Recursive-Definitions/), [TLA+ tools](https://github.com/tlaplus/tlaplus/blob/master/general/docs/current-tools.md), [TLC coverage and profiling](https://docs.tlapl.us/using%3Acoverage), and [Lamport on high-level specifications](https://lamport.org/pubs/high-level.pdf).

## Next audit round

1. Reconfirm the fixes against the current worktree and mark each finding fixed, still present, or superseded.
2. Expand the source inventory by subsystem and select safety-critical or high-cost paths for models.
3. Capture representative runtime profiles before making performance claims.
4. Tie each model variable and transition to the implementation invariant it represents; revise or retire abstractions when the implementation changes.
