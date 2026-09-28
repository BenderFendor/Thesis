# Formal toolchain installation and verification
Date: 2026-09-23. Scope: record the user-authorized, user-local pinned formal tools and bounded evidence.
Lean 4.34.0: `Ownership.lean` and `Audit.lean` compiled successfully.
TLC v1.8.0 / TLC 2026.09.23.154203 with Java 26: six existing bounded models passed exhaustive checks.
`EmbeddingGeneration`: typed sentinel repairs; reduced cfg `Articles=2, Workers=1, QueueCapacity=1, MaxGeneration=1, MaxRetries=1` exhaustive exit 0 (922746 generated/180839 distinct/depth 41/14.57s).
Separate original 2x2/2-worker/queue2/gen2/retry2 simulation passed 101 states/trace 100; its original 2x2 exhaustive run >9 minutes was cancelled/unknown.
Verus `source_url_guard`: 2 verified/0 errors; cargo-kani/CBMC `thesis-evidence`: 6/6 harnesses, 0 failures; `cargo kani setup` unsupported and not claimed.

## Scope and authorization

This trace records the completed, user-authorized installation and verification evidence for user-local tools. No long checks or installations were run for this documentation update. No Rust, application, or `EmbeddingGeneration.tla` file was edited by this update.

## Pinned user-local tools

- Lean is pinned by `docs/agents/formal-audit/lean-toolchain` to `leanprover/lean4:v4.34.0`. The installed toolchain is `/home/bender/.elan/toolchains/leanprover--lean4---v4.34.0`; the wrapper is `/home/bender/.elan/bin/lean`. Lean reports commit `293d5d0c0c3f3dded4688b3ccd6a33939ac5102b`.
- The TLA+ tools jar is `/home/bender/.local/share/formal-tools/tla/tla2tools-1.8.0.jar`, SHA-1 `0f01eb64022f25a373d64e56e203e3e1712997aa`. TLC reports `2026.09.23.154203` (revision `4260e47`). The JVM is OpenJDK `26.0.2.1`.
- Verus is `/home/bender/.local/share/formal-tools/verus/verus-x86-linux/verus`, version `0.2026.09.20.aef82ed`, run with `RUSTUP_TOOLCHAIN=1.98.1`.
- Kani is available through the installed Cargo subcommand: cargo-kani `0.68.0` with CBMC `6.11.0`. There is no standalone `cargo-kani` binary requirement in this record.

## Lean evidence

The following user-authorized commands passed:

```text
/home/bender/.elan/bin/elan run leanprover/lean4:v4.34.0 lean docs/agents/formal-audit/Ownership.lean
/home/bender/.elan/bin/elan run leanprover/lean4:v4.34.0 lean docs/agents/formal-audit/Audit.lean
```

Both model files compiled. This checks the Lean declarations and theorems in those artifacts. It is not a proof that the Python, TypeScript, Rust, SQL, or HTTP implementation refines either model.

## TLC evidence

TLC exhaustively checked each reachable state of the following six finite models with its existing checked-in `.cfg` constants. All checks passed without invariant violations:

- `QualityRelease`
- `ReporterPromotion`
- `ResearchOverlap`
- `RSSCache`
- `VerifierSnapshot`
- `AutoIngest`

The checks used the pinned TLA+ tools jar and Java 26. No unbounded state space, enlarged constants, or application refinement is claimed. These are finite model checks of the specified transitions.

`EmbeddingGeneration` is recorded separately. Its typed sentinel repairs keep the sentinel and work-item claims in a common tuple shape. The completed reduced exhaustive baseline passed with exit 0 after exploring 922746 states (180839 distinct), complete depth 41, in 14.57 seconds, at `Articles=2`, `Workers=1`, `QueueCapacity=1`, `MaxGeneration=1`, and `MaxRetries=1` (`Articles={article-1,article-2}`, `Workers={worker-1}`).

The separate original 2x2/2-worker/queue-2/generation-2/retry-2 TLC simulation passed 101 states with trace depth 100. That simulation follows selected traces and is not exhaustive proof. The original 2x2 exhaustive bounds ran for more than nine minutes and were cancelled before a verdict, so that historical run remains **unknown**, not a pass and not a failure. The reduced baseline is the completed exhaustive follow-up.

## Verus evidence

```text
RUSTUP_TOOLCHAIN=1.98.1 \
  /home/bender/.local/share/formal-tools/verus/verus-x86-linux/verus \
  backend/crates/thesis-ingest/verus/source_url_guard.rs
```

Verus reported `2 verified, 0 errors`. The source-host model is an abstract proof artifact and has no formal refinement relation to the Rust implementation.

## Kani evidence

```text
RUSTUP_TOOLCHAIN=1.98.1 cargo kani \
  --manifest-path backend/Cargo.toml \
  -p thesis-evidence \
  --default-unwind 4 \
  --output-format terse
```

The installed cargo-kani/CBMC versions were `0.68.0` and `6.11.0`. The `thesis-evidence` run completed `6/6` harnesses with `0 failures`. This is selected bounded harness evidence for that package, not a proof of the whole workspace or application.

`cargo kani setup` is unsupported by this installed CLI. No setup command success or setup state is claimed.

## Exact scope limits

- The six bounded TLC checks and the reduced `EmbeddingGeneration` baseline are exhaustive only over their recorded finite constants.
- `EmbeddingGeneration`'s original higher-bound exhaustive run is cancelled/unknown; its separate 101-state simulation is not exhaustive proof.
- Lean, TLC, and Verus artifacts are abstract models or proof artifacts, not source-linked implementation proofs.
- Kani covers the selected `thesis-evidence` harnesses at the recorded unwind, not SQLx, HTTP transport, external services, or the complete application.
- This update changed only `docs/agents/formal-audit/verification-manifest.json` and this new trace.
