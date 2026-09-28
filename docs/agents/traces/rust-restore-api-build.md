# Rust restore-api-build trace

## Goal

Make the Rust workspace build, test, and pass strict Clippy on `main`'s
content, as batch 0 of `docs/architecture/rust-cutover-plan.md`.

## Status (2026-09-28)

- Commits: `a6d239b` (build restore and route wiring), `d835dff` (Clippy).
- `cargo test --workspace`: 516 passed with `DATABASE_URL` set to a temporary
  PostgreSQL on port 55432.
- `cargo clippy --workspace --all-targets -- -D warnings`: only dead-code
  warnings remain (OpenAPI-only `IntoParams` structs; Atlas entity-detail
  response types for an unregistered route).

## Decisions

- Kept `article_analysis::post_article_language_diagnostics` over the `core.rs`
  duplicate because it extracts URL-only articles as FastAPI does.
- Used a boxed `Rejection` type instead of raising Clippy's
  `large-error-threshold`.
- Did not change `Database::connect_lazy` timeouts to speed up tests; that
  would alter the production contract.

## Open items

- Decide how to handle OpenAPI-only `IntoParams` structs (typed parsing
  versus `#[expect(dead_code, reason = ...)]`).
- Wire `thesis-server/src/providers/` (about 22,000 lines never compiled).
- Implement Atlas entity detail (`GET /api/wiki/atlas/entities/{entity_id}`).
