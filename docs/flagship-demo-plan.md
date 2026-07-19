# Scoop Flagship Demo Plan

## Decision

Use Scoop as the flagship resume project. It is the only current project that already combines a real multi-source ingest pipeline, a Rust-to-Python performance boundary, a typed web application, a relational store, vector search, and source-backed analysis tools. It also maps directly to journalism, public-interest technology, civic data, and full-stack roles already targeted in the job search.

Keep Congress Accountability Tracker as the supporting public-data project. Do not split attention across Philly Power Map or FundingFlow until the Scoop showcase is verifiably runnable and documented. Their data scopes are good future work, but both are larger, less complete, and costly to operate locally today.

## Showcase Product

Present Scoop as a local-first news research workstation rather than a generic news reader. The reviewable workflow is:

1. Open a source-diverse topic cluster.
2. Compare the article set, source lenses, and coverage gaps.
3. Inspect deterministic contradiction, language, and paywall-access signals.
4. Open story lineage to see article relationships, claim candidates, and corrections.
5. Trace every displayed conclusion back to source articles, source metadata, or an explicit unavailable/insufficient-evidence state.

The demo must never substitute generated text or mock results for unavailable data. A compact, reproducible snapshot is preferable to a larger live scrape that cannot be repeated.

## Local Operating Envelope

Measured on 2026-07-09:

- CPU: AMD Ryzen 5 3600, 6 cores / 12 threads.
- Memory: 31 GiB total, about 20 GiB available at inspection time.
- GPU: RTX 3060 with 12 GiB VRAM. A local Whisper process was already using about 1.7 GiB.
- Home volume: 26 GiB free. The current Scoop checkout is 34 GiB, including 3.9 GiB of Chroma data and a 7.6 GiB backend virtual environment.
- External data volume: `/mnt/Big storage` had about 190 GiB free, but it was already 95% full.

Use CPU-backed embedding and deterministic analysis as the default. Do not add a persistent local generative model to this project. Optional remote LLM analysis stays opt-in and must degrade to an honest unavailable state when API keys are absent.

The showcase must keep persistent Chroma data outside the checkout. Use the dedicated directory below, reserve at least 48 GiB free on its mount, and keep the showcase data budget below 12 GiB until a measured run justifies expansion.

```bash
SCOOP_DEMO_STORAGE_ROOT="/mnt/Big storage/scoop-demo"
```

## Isolated Local Setup

The normal Scoop launcher defaults to ports 8000 and 3000. Port 8000 was already occupied during this assessment, so the showcase profile uses isolated ports. `runlocal.sh` now derives Gunicorn's bind address from `BACKEND_PORT`, which keeps the existing default while making this profile work.

Run the preflight first. It only inspects the machine unless `--init-storage` is explicitly passed.

```bash
bash scripts/flagship-demo-preflight --init-storage
bash scripts/flagship-demo-preflight --print-env
```

The second command prints the exact launch command. It uses:

| Service | Port |
| --- | ---: |
| Next.js showcase UI | 3100 |
| FastAPI / Gunicorn | 8100 |
| Chroma | 8101 |
| Embedding service | 8102 |

`runlocal.sh` frees configured ports before launch. Do not run the printed command if the preflight reports any of these ports as occupied. That protects the existing service on port 8000 and unrelated local work.

## Definition Of Done

The flagship release is complete only when all of the following are true:

- A new reviewer can complete the five-step workflow above from a documented local setup.
- The demo data is reproducible: source list, snapshot date, article count, source health, and hashes are recorded.
- At least one source-diverse cluster has enough article evidence for the contradiction and lineage panels; otherwise the UI presents the existing insufficient-evidence state clearly.
- Every research claim has article/source links or an explicit confidence and evidence limitation.
- The source page shows observed ledger fields, including paywall mix, original-reporting observations, wire-dependency observations, corrections, and RSS health without collapsing them into a fabricated trust score.
- API errors, empty clusters, missing Chroma, missing API keys, and unavailable source pages have intentional states.
- Frontend desktop and mobile screens are captured after a real local run, with no blank pages, overlap, or unreadable controls.
- The project has a clean README entry point, one architecture diagram, one data-methodology page, one five-minute demo script, screenshots, and a short demo recording.
- The release branch passes non-mutating type, lint, test, build, and Rust checks before any public claim is made.

## Delivery Sequence

### 0. Stabilize The Existing Scoop Work

The worktree already contains the core showcase capabilities as uncommitted changes: reviewed RSS intake, News Lens filtering, contradiction panels, story lineage, source-ledger metrics, paywall-aware blindspots, and language diagnostics. Do not build another feature on top of that state first.

Split and verify the current work by behavior surface:

1. Source intake and News Lens.
2. Contradiction panel and story lineage.
3. Source Ledger and paywall-aware blindspots.
4. Language diagnostics.

For each slice, run its focused backend tests, frontend tests, typecheck, and lint before grouping it into a reviewable commit. Preserve the current no-fake-data and evidence-confidence rules.

### 1. Make The Demo Data Reproducible

Add a dedicated showcase manifest that records the selected source names, retrieval timestamp, source URLs, article IDs, article hashes, and expected source-diversity status. The first set should be deliberately small and selected for geographic and ownership diversity, not source count.

Add a seed/import command that can load that manifest without contacting live providers. Keep a separate optional refresh command for live RSS. The fixed snapshot is what reviewers and tests use.

Acceptance checks:

- A clean local database can load the manifest repeatedly.
- Re-importing does not create duplicate source or article records.
- Manifest validation fails on missing article files, mismatched hashes, or an unknown source.
- Cluster and lineage API tests run against the seeded dataset.

### 2. Make The Investigation Workflow Obvious

Use the existing grid, article workspace, source wiki, blindspot, contradiction, and lineage surfaces to create one intentional reviewer path. Avoid a dashboard full of unrelated modes.

Required interactions:

1. Lens choice changes the visible article set and its active label.
2. Cluster cards show source count, evidence availability, and access limits before a reader opens them.
3. Contradiction output distinguishes direct contradiction, agreement, and missing evidence.
4. Story lineage displays an origin, downstream variants, claim candidates, and correction matches with linked records.
5. Article language diagnostics describe observable language patterns, not author intent.
6. Source pages distinguish observed facts from unverified or unavailable evidence.

### 3. Add Trustworthy Product Operations

Create a release readiness command that checks the running API, data-manifest integrity, source health, storage budget, and required showcase routes. It should report failures; it should not rewrite data or kill processes.

Record a short run ledger for every showcase refresh:

- manifest version and hash
- source success, warning, and failure counts
- article insert and deduplication counts
- Chroma directory size
- schema and application revision
- cluster IDs selected for the demo

### 4. Package It For Evaluation

Produce the public package only after the app is stable:

- README quick start using the isolated profile.
- Architecture and data-methodology pages grounded in the live code and manifest.
- Five-minute walkthrough with the exact reviewer flow.
- Desktop and mobile screenshots from the local release server.
- A short screen recording using a fixed snapshot.
- Resume bullets that use measured current counts, not aspirational totals.

## What Comes After Scoop

After Scoop is publicly demonstrable, strengthen Congress Tracker with an equally bounded, source-backed smoke dataset and a clear data-freshness ledger. Philly Power Map is the next full standalone civic-data build because it has a focused city scope and a strong public-interest story. FundingFlow remains a longer-term research platform: its national source breadth and current disk footprint make it unsuitable for parallel work on this machine.
