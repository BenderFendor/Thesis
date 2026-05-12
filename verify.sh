#!/usr/bin/env bash
set -e

echo "--- TypeScript / Frontend ---"
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint

echo "--- Python / Backend ---"
bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'
uvx ruff check backend/ --fix
uvx ruff format backend/

echo "--- Rust ---"
cargo clippy --manifest-path backend/rss_parser_rust/Cargo.toml -- -D warnings
cargo fmt --manifest-path backend/rss_parser_rust/Cargo.toml --all -- --check
(cd backend/rss_parser_rust && uv run maturin develop --release 2>&1)
cp backend/rss_parser_rust/target/release/librss_parser_rust.so backend/.venv/lib/python3.13/site-packages/rss_parser_rust/rss_parser_rust.abi3.so

echo "--- Tests ---"
bash -lc 'cd backend && .venv/bin/pytest tests -m "not slow"'

echo "--- All checks passed ---"
