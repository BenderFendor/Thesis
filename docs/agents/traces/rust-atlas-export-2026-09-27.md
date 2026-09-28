# Rust Atlas export implementation trace
Task slug: rust-atlas-export-2026-09-27
Goal: implement shadow `POST /api/wiki/atlas/export` with the source-derived JSON and CSV contracts.
Inventory: 139/178 operations; 106 parity-proven, 33 registered-unverified, 39 unregistered; export remains `migrated:false`.
Ownership: FastAPI remains public; Rust registration is shadow-only and parity is unverified.
Verification: standalone rustfmt passed; Cargo/Rust tests and runtime exercise were closed.
Risk tier: Normal read-only graph export; route and wire behavior remain unverified.

## Goal
Implement the FastAPI-compatible export operation using the existing Atlas projection. Preserve JSON and all three CSV formats, request overrides, validation status, attachment headers, OpenAPI registration, and inventory status without changing `thesis-db` or dependencies.

## Files changed
- `backend/crates/thesis-api/src/wiki_atlas/export.rs`: export handler, body parser, Python-compatible JSON/CSV rendering, and ten source tests.
- `backend/crates/thesis-api/src/wiki_atlas.rs`: module/re-export/router wiring and export date validation.
- `backend/crates/thesis-api/src/lib.rs`: central OpenAPI operation and request-schema regression assertions.
- `docs/agents/rust-openapi-operation-inventory.json`: export marked registered and not migrated; counts updated to 139/33/39.
- `docs/architecture/rust-backend-migration.md`, `docs/Log.md`, `docs/agent/{known-errors,lean-codebase-plan,learnings,test-catalog,testing}.md`: current route/count/test state and verification limits.
- `.agent/traces/rust-atlas-export-2026-09-27.md` and `docs/agents/traces/rust-atlas-export-2026-09-27.md`: paired worksheets.
- `papercuts.md`: edit-tool friction log.

## Commands run
- `scripts/agent-summary`: completed.
- `ss -ltnp 'sport = :8000'`: no listener on localhost port 8000.
- One bounded, read-only FastAPI attempt:
  ```bash
  curl --include --silent --show-error --connect-timeout 2 --max-time 5 --request POST --header 'Content-Type: application/json' --data-binary '{"filters":{"limit_nodes":1,"limit_edges":1},"format":"json","include_evidence":false}' http://127.0.0.1:8000/api/wiki/atlas/export
  ```
  It failed with exit 7: `curl: (7) Failed to connect to 127.0.0.1:8000 after 0 ms: Could not connect to server`. No response status, headers, or body were available. No service was started.
- `rustfmt --edition 2021 backend/crates/thesis-api/src/wiki_atlas/export.rs backend/crates/thesis-api/src/wiki_atlas.rs backend/crates/thesis-api/src/lib.rs`: passed with no output.
- `rustfmt --edition 2021 backend/crates/thesis-api/src/wiki_atlas/export.rs`: passed after direct deserialization and float-helper extraction.
- A read-only Python JSON parse/count check passed for the inventory and confirmed export is registered but not migrated.
- `papercut log`: recorded the initial inventory check's missing B15/migrated row fields; both fields were added and totals rechecked.
- `papercut log`: recorded the distinct `AtlasIndexSlice-t3` versus `AtlasIndexSlice` session-lookup failure.
- `papercut log`: recorded the initial mirrored-trace edit rejection; re-read and retry succeeded.
- No Cargo command, Rust test/build/Clippy, self-test, or Rust runtime execution was run.

## Complexity metrics

The repository gate in `scripts/check-complexity` flags cyclomatic complexity
above 10 or cognitive complexity above 15. `command -v cccc` and the configured
cache lookup found no CCCC binary. The gate downloads its pinned CCCC 1.6.0
binary when absent; no download was attempted. Cargo/Clippy execution was
closed, so exact before/after complexity scores are unavailable.

The float formatter now delegates special values, scientific notation, and
fixed notation to `write_special_float`, `write_scientific_float`, and
`write_fixed_float`. Each helper writes directly to the output buffer; the
shortest-digit `String` remains the only float-rendering temporary allocation.

## Tests added
Ten tests in `backend/crates/thesis-api/src/wiki_atlas/export.rs::tests`:
- `csv_nodes_match_python_quoting_unicode_and_datetime_format`
- `csv_relationships_keep_integral_floats_booleans_and_empty_options`
- `csv_evidence_quotes_text_and_preserves_duplicate_edge_rows`
- `json_export_keeps_field_and_evidence_order_and_last_duplicate_value`
- `json_export_keeps_supplied_layout_positions`
- `export_overrides_match_python_truthiness_without_query_length_caps`
- `export_validation_rejects_invalid_dates_without_query_length_constraints`
- `export_body_syntax_and_validation_errors_use_422`
- `each_format_returns_the_python_attachment_filename_and_media_type`
- `float_csv_text_matches_python_integral_and_exponent_forms`

The existing central OpenAPI test now checks the export operation ID, 200/422 responses, and `AtlasExportRequest` schema. These Rust tests were added but not run because the shared Cargo/Rust execution gate was closed.

## Assumptions
- Python route/service/models and the existing Rust Atlas DTO/projection are the contract sources. They establish all four formats, names, media types, field order, Python CSV rules, dates, evidence deduplication, and request overrides.
- JSON evidence deduplication keeps the first-seen position and last value; CSV evidence keeps repeated edge rows.
- Body `q` and `selected` have no 200/160 length caps. Those caps apply only to graph query parameters.
- The request body deserializes directly into `AtlasExportRequest`; malformed JSON and type errors still map to 422. The `[]` shape fixture checks status only.
- The localhost:8000 attempt is unavailable runtime evidence, not a parity result.

## Risk tier
Normal. The handler only reads the current Atlas projection, but compilation, database behavior, HTTP behavior, and FastAPI byte parity remain unverified.

## Rollback
Remove the export module, parent re-export/router route and export-only validation, central `ApiDoc` path/test assertions, and revert the inventory and documentation count/registration delta. Do not revert unrelated Atlas index/search work.

## Status
Implementation and scoped documentation are complete. FastAPI remains public. Export is registered but `migrated:false`; source tests, compiled behavior, runtime response, and FastAPI parity are unverified. No files were staged or committed.
