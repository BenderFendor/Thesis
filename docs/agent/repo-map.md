# Repository Map

## Purpose

This map helps Codex agents orient quickly before editing.

## Top-Level Layout

- `backend/`: FastAPI app, services, scripts, tests, and the Rust workspace at `backend/Cargo.toml`.
- `frontend/`: Next.js app, UI components, hooks, and tests.
- `docs/`: project docs, including `docs/agent/` operational guidance.
- `docs/documentation-maintenance.md`: README, docs, and GitHub Wiki sync workflow.
- `docs/documentation-style-guide.md`: project documentation writing rules.
- `scripts/`: repo-local Codex helper commands.
- `verify.sh`: strongest full-stack verification path.

## Backend Hotspots

- `backend/app/main.py`: FastAPI entrypoint.
- `backend/app/api/routes/`: API routes grouped by domain.
- `backend/app/services/`: business logic and orchestration.
- `backend/app/services/entity_wiki_service.py`: Wikidata/Wikipedia entity resolution and reporter scoring.
- `backend/app/services/reporter_indexer.py`: background reporter indexing, local-byline profile builder.
- `backend/app/services/reporter_web_search.py`: DuckDuckGo Lite web search enrichment.
- `backend/app/services/reporter_social_search.py`: Mastodon and Bluesky social profile search.
- `backend/app/services/reporter_wikipedia.py`: Wikipedia bio extraction and category mining.
- `backend/app/services/reporter_directory.py`: Mastodon journalist directory enumeration.
- `backend/app/services/contradiction_extractor.py`: deterministic topic-cluster contradiction panels from source-diverse article evidence.
- `backend/app/services/language_diagnostics.py`: deterministic article-level language diagnostics for passive voice, actor omission, euphemisms, and sanitized framing.
- `backend/app/services/story_lineage.py`: promotes topic-cluster snapshots into durable story, article-edge, claim, claim-edge, and correction-watch records.
- `backend/app/services/source_ledger.py`: observed source wiki metrics for corrections, original reporting, wire dependency, paywalls, bylines, policy signals, and RSS health.
- `backend/app/services/blindspot_viewer.py`: multi-lens blindspot cards, including paywall-concentration signals for coverage gaps.
- `backend/app/data/rss_sources.json`: curated RSS catalog.
- `backend/tests/`: backend regression tests.
- `backend/scripts/validate_rss_sources.py`: RSS health validation.
- `backend/scripts/backfill_rss_ownership_labels.py`: ownership label backfill.

## Reporter Verification Pipeline

- `backend/scripts/verify_and_promote_reporters.py`: multi-tier author-page verification. Only person-level author/profile pages can move a reporter to `verified`; RSS, byline-frequency, and Wikidata-only evidence remain supporting evidence.
- `backend/scripts/rss_verify_reporters.py`: batch RSS dc:creator evidence using the Rust parser. One feed download per source, bulk supporting-evidence updates.
- `backend/scripts/wikidata_verify_strong.py`: Wikidata employer cross-check. Matches Wikidata P108 employer labels against RSS catalog sources as supporting evidence.
- `backend/scripts/promote_byline_verified.py`: byline consistency evidence. Uses article observation counts as source-level support without treating source homepages as author pages.
- `backend/scripts/wayback_verify_reporters.py`: Wayback Machine cached author page discovery and verification.
- `backend/scripts/verify_reporter_intelligence.py`: quality gates for verified author-profile citations, high-confidence profile validity, alias conflicts, and the honest 70% eligible-cohort coverage target.
- `backend/scripts/plan_reporter_source_enrichment.py`: source/reporter backlog planner. Dedupe identity keys only use real author/profile URLs, not source homepages or feeds.
- `docs/agent/reporter-verification-90-percent-roadmap.md`: target-state plan for reaching 90% verified eligible reporter coverage without weakening the evidence model.

## Rust Backend Workspace

- `backend/Cargo.toml`: workspace root and shared lockfile owner.
- `backend/crates/thesis-evidence/`: pure versioned evidence acceptance rules, Kani harnesses, and an independent-root Verus model.
- `backend/crates/thesis-ingest/`: pure HTML cleanup, article metadata/image extraction, GDELT parsing/taxonomy, and source-host normalization/matching used by RSS and the PyO3 API.
- `backend/crates/thesis-search/`: personalized ranking, lexical topics, article comparison, comparison keywords, country aliases, and MinHash duplicate detection; property tests cover comparison scores and counts, score bounds, keyword rules, alias matching, and MinHash symmetry/range.
- `backend/crates/thesis-search/src/language_diagnostics.rs`: deterministic article-language scoring; Kani checks severity monotonicity, while Hypothesis differentials cover Unicode and pattern handling. Regex and phrase matching are not formally proved.
- `backend/crates/thesis-db/`: SQLx connection and typed evidence evaluation, claim-read, and relationship-list queries against the Alembic schema.
- `backend/crates/thesis-api/`: Axum routes for migrated API operations.
- `backend/crates/thesis-server/`: shadow Rust listener for evidence policy and claim reads, evidence evaluation, relationship reads, personalized ranking, and `POST /compare/articles`; FastAPI remains the public application server.
- `backend/rss_parser_rust/`: remaining RSS parser/fetcher modules and temporary PyO3 bridge; depends on `thesis-ingest`, `thesis-evidence`, and `thesis-search`.
- `docs/architecture/rust-backend-migration.md`: current dependency map, module phases, and deletion conditions.
- `docs/agents/formal-audit/verification-manifest.json`: implemented invariants and actual verification status.

## Rust RSS Parser

- `backend/rss_parser_rust/src/parser.rs`: feed parsing with universal author extraction (dc:creator, dc:author, itunes:author, media:credit, atom:author/name, atom:uri, link rel=author, multi-author splitting).
- `backend/crates/thesis-ingest/src/cleaner.rs`: HTML-to-text cleanup shared with the feed parser.
- `backend/crates/thesis-ingest/src/html_extract.rs`: article body, metadata, and image extraction behind the unchanged PyO3 functions.
- `backend/crates/thesis-ingest/src/gdelt.rs`: typed GDELT TSV parsing, identity filtering, and domain filtering with a bounded-row property test.
- `backend/crates/thesis-ingest/src/gdelt_taxonomy.rs`: CAMEO root normalization, stable root counts, Goldstein bucket rules, proptest properties, and a Kani threshold harness.
- `backend/crates/thesis-ingest/src/source_url_guard.rs`: Python-compatible host normalization, label-boundary matching, and configured BBC/Asia Plus families. Kani checks the bounded byte suffix kernel; Verus checks the abstract byte-sequence boundary rule.
- `backend/crates/thesis-ingest/verus/source_url_guard.rs`: Verus model for the source-host label-boundary rule; it is not a refinement proof of the Rust module.
- `backend/crates/thesis-evidence/verus/independent_roots.rs`: Verus model proving that a qualifying duplicate from an existing root preserves root membership for arbitrary sequence lengths; it is not a Rust refinement proof.
- `backend/crates/thesis-search/src/country_mentions.rs`: country alias indexing, longest-token matching, sorted deduplicated substring patterns, and article text composition.
- `backend/crates/thesis-search/src/minhash.rs`: MinHash signatures, collision-free exact grouping, connected duplicate groups, proptest properties, and Kani harnesses.
- `backend/crates/thesis-search/src/comparison_keywords.rs`: Python-compatible ASCII keyword extraction, Unicode word boundaries, stable frequency ordering, proptest properties, and Kani comparator harnesses.
- `backend/crates/thesis-search/verus/alias_ranges.rs`: Verus proof that nested alias-span containment is transitive for arbitrary bounds; Kani also exercises the production range helper with a concrete assumption witness.
- `backend/crates/thesis-search/verus/minhash_ratio.rs`: Verus proof of the mathematical match-count ratio bound for arbitrary lengths; not a Rust refinement proof.
- `backend/crates/thesis-search/verus/comparison_keyword_priority.rs`: Verus proof of the natural-number frequency/first-seen priority relation; not a Rust refinement proof.
- `backend/rss_parser_rust/src/country_mentions.rs`: PyO3 adapter with atomically replaceable alias snapshots.
- `backend/rss_parser_rust/src/blindspot.rs`: Python-facing vector math; Kani checks the bounded production self-dot-product property.
- `backend/crates/thesis-search/src/topics.rs`: typed keyword extraction, lexical clustering, deterministic feed ordering, property tests, and a Kani Jaccard bound.
- `backend/rss_parser_rust/src/topics.rs`: Python serialization adapters for the existing topic-binding function names.
- `backend/rss_parser_rust/src/gdelt.rs`: Python datetime/dict serialization wrappers over the `thesis-ingest` core.
- `backend/rss_parser_rust/src/types.rs`: `ParsedArticle` with `authors` and `author_urls` fields, Python dict serialization.

## Frontend Hotspots

- `frontend/app/`: route-driven pages.
- `frontend/components/`: reusable UI and feature components.
- `frontend/components/contradiction-panel.tsx`: cluster context panel for disputed claims, agreed facts, and missing evidence.
- `frontend/components/story-lineage-panel.tsx`: expanded topic panel for story origin, article variants, claim seeds, and correction matches.
- `frontend/components/article-detail-modal.tsx`: expanded reader workspace, annotations, source/reporter wiki panels, AI analysis, and Language Forensics diagnostics.
- `frontend/components/blindspot-view.tsx`: multi-lens blindspot UI, including paywall badges when access barriers affect the sampled coverage.
- `frontend/app/wiki/source/[sourceName]/source-wiki-view.tsx`: source wiki profile UI with Source Ledger metrics and scan-level source facts.
- `frontend/lib/`: API wrappers and helpers.
- `frontend/lib/news-lens.ts`: source-type lens definitions and article filtering helpers.
- `frontend/hooks/`: query/state hooks.
- `frontend/hooks/useNewsLens.ts`: local-storage backed News Lens state.
- `frontend/__tests__/`: frontend tests.

## Verification Entry Points

- Preferred: `scripts/self-test`.
- Strongest path in this repo: `./verify.sh` (invoked by `scripts/self-test`).
- Orientation command: `scripts/agent-summary`.
- Triage helper: `scripts/diagnose`.

## Notes For Future Agents

- Treat `AGENTS.md` as the short map and `docs/agent/*` as detailed operational docs.
- If verification fails with reusable patterns, update `docs/agent/known-errors.md`.
- If you learn a repeatable repo-specific practice, update `docs/agent/learnings.md`.
