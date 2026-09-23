# Formal audit models

These Lean and TLA+ files are small, finite models for the findings in [the cumulative audit trace](../traces/lean-tla-codebase-audit.md). They capture selected behavior from this repository. They do not prove the application correct because they do not link automatically to the Python, TypeScript, Rust, or JavaScript implementation.

## Run the checks

With Lean, Java, and the official TLA+ tools jar available, run from the repository root:

    TLA_TOOLS_JAR=/path/to/tla2tools.jar scripts/formal-audit

The script compiles `Audit.lean` and checks each `.tla` model against its `.cfg`. All six models should finish without invariant violations.

## Model index

| Model | Question | Expected result |
| --- | --- | --- |
| Audit.lean | Do verification, writer release, request IDs, and snapshots satisfy the modeled properties? | Lean proofs compile. |
| ReporterPromotion | Can article metadata alone verify a reporter? | VerifiedNeedsProfileNameMatch holds. |
| ResearchOverlap | Do overlapping requests get unique IDs and terminalize superseded messages? | IdsUnique and SupersededRequestTerminal hold. |
| QualityRelease | Do wrong-owner requests preserve the claim, and does a valid release clear it? | Both release invariants hold. |
| VerifierSnapshot | Does the verifier detect content changes when status text is unchanged? | ResultMatchesSnapshot and NoFalseClean hold. |
| AutoIngest | Can the completion marker be recorded before every modeled adapter succeeds? | MarkerSound holds. |
| RSSCache | Does an incomplete source retain its cached articles during a full refresh? | Both cache invariants hold. |

Add new models only for a concrete algorithm or state transition that needs a stronger oracle. Keep implementation evidence and model assumptions in the audit trace. A passing model means only that the checked invariant holds for this model and its finite state space.

## Performance boundary

Lean can prove operation-count bounds or show that an optimized algorithm preserves a specification. It does not discover a faster implementation or measure product latency. TLA+ can model finite limits such as workers, queue depth, retries, database connections, or requests in flight, then check safety, deadlock, and liveness properties. TLC runtime measures state exploration, not application throughput.

Use runtime profiles and repeatable benchmarks to find actual hot paths. Use Lean when an algorithmic bound or equivalence proof is useful, and TLA+ when concurrency, contention, queueing, or resource limits can cause a failure. For this repository, the profiling candidates listed in the trace are hypotheses until measured.

References: [Lean recursive definitions](https://lean-lang.org/doc/reference/latest/Definitions/Recursive-Definitions/), [TLA+ tools](https://github.com/tlaplus/tlaplus/blob/master/general/docs/current-tools.md), [TLC coverage and profiling](https://docs.tlapl.us/using%3Acoverage), and [Lamport on high-level specifications](https://lamport.org/pubs/high-level.pdf).
