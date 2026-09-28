#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
: "${THESIS_VERIFY_CONCURRENCY:=4}"
export THESIS_VERIFY_CONCURRENCY

node scripts/quality-hardening.mjs verify --scope repo "$@"

echo "== Rust backend workspace =="
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml --workspace

rust_openapi="$(mktemp)"
trap 'rm -f "$rust_openapi"' EXIT
cargo run --manifest-path backend/Cargo.toml --locked -p thesis-server -- --openapi > "$rust_openapi"
python3 scripts/check_openapi_compat.py backend/openapi.json "$rust_openapi" \
	--operation-inventory docs/agents/rust-openapi-operation-inventory.json
