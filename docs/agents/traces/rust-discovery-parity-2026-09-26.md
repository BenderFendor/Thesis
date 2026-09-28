# Task worksheet: Rust discovery parity handoff
Date: 2026-09-26
Status: Main reviewed source handoffs; user clearance for extraction/router wiring is pending.
Goal: Record the 2,932-LOC RustDiscovery/RustDbOwnership handoff from snapshot #E9DD.
Files: three Rust handoff files plus docs, test catalog, trace, and papercuts.md.
Verification: Cargo tests unrun under lock; formatter/Python probe are worker-reported.
Risk: High — lineage persistence/API behavior; Unicode number parity remains unresolved.

## Goal

Record the discovery provider handoff, test inventory, source-only review status,
and the unresolved ASCII-versus-Unicode number parsing difference.

## Status

Main reviewed the RustDiscovery and RustDbOwnership source handoffs. The user
has not explicitly cleared lineage extraction or production router wiring.
No production router wiring or module extraction has been performed.

## Files changed

- `backend/crates/thesis-server/src/providers/discovery.rs` (RustDiscovery):
  lexical/heartbeat parity, fallback detail projection, lineage mapping, and
  five server regressions listed below.
- `backend/crates/thesis-db/src/discovery.rs` (RustDbOwnership): typed lineage
  persistence transaction and four SQLx regressions listed below.
- `backend/crates/thesis-db/src/lib.rs` (RustDbOwnership): exported lineage
  persistence API types.
- `docs/Log.md`: provider handoff, verification status, and parity risk.
- `docs/agent/learnings.md`: Python/Rust regex-boundary lesson.
- `docs/agent/known-errors.md`: unresolved Unicode parity risk.
- `docs/agent/test-catalog.md`: five server and four SQLx tests with commands.
- `docs/agents/traces/rust-discovery-parity-2026-09-26.md`: this worksheet.
- `papercuts.md`: missing-path and hashline-anchor frictions.
- This documentation update changed no Rust source.

## Commands and results

- No Cargo, build, or test command was run; the Cargo lock gate remains closed.
- Server command from the repository root, not run: `cargo test --manifest-path backend/Cargo.toml --message-format short -p thesis-server --lib providers::discovery::tests`.
- SQLx command from `backend/`, not run: `cargo test -p thesis-db discovery::tests --lib --message-format short`; requires `DATABASE_URL` pointing to a disposable PostgreSQL cluster.
- RustDiscovery reported a scoped formatter check; it was not rerun here.
- RustDiscovery reported the Python probe result:
  `{'中10文': [], '10文': [], '中10': [], '١٢': ['١٢'], 'س١٢': []}`.
  This result is worker-reported, not independently reproduced.
- Ran `papercut list`, then logged both the missing-path and hashline-anchor
  frictions in `papercuts.md`.

## Tests added or recorded

Server (`thesis-server`; Cargo tests unrun):

- `lexical_titles_flow_through_trending_snapshot_and_detail_without_neighbor_queries`
- `lineage_article_edges_link_only_from_the_earliest_article`
- `lineage_number_percent_backtracking_matches_python_regex_boundary`
- `lineage_route_serializes_persisted_rows_after_lexical_detail_fallback`
- `stats_heartbeat_failure_serializes_the_fastapi_zero_payload_without_database_access`

SQLx (`thesis-db`; Cargo tests unrun, disposable PostgreSQL required):

- `lineage_upserts_are_idempotent_and_claim_corrections_win`
- `existing_article_claim_keeps_its_original_story_cluster`
- `lineage_filters_existing_articles_and_falls_back_when_none_exist`
- `lineage_failure_rolls_back_all_graph_rows`

## Assumptions

- The 2,932 LOC count and handoff behavior summary come from the main-agent
  source review of snapshot #E9DD. The user has not cleared the follow-up gate.
- Rust's expected `10` matches in the CJK-adjacent inputs and no Arabic-Indic
  matches are inferred from its ASCII byte predicates, not runtime observations.
- The Python regex result and formatter status are reported by RustDiscovery.

## Risk

High for lineage persistence and API behavior while Cargo tests remain gated.
The ASCII-byte Rust number parser is inferred from source to differ from Python's
Unicode `\d`/`\b` on the probed CJK and Arabic-Indic inputs. No
`.agent/risk-tiers.yaml` exists.

## Rollback

Revert this task's documentation changes to `docs/Log.md`,
`docs/agent/learnings.md`, `docs/agent/known-errors.md`,
`docs/agent/test-catalog.md`, this worksheet, and the `papercuts.md` entries.
The three Rust worker-owned files are outside this documentation rollback scope.
