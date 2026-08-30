#!/usr/bin/env bash
echo "--- TypeScript / Frontend ---"
rm -f frontend/tsconfig.tsbuildinfo
npm --prefix frontend exec -- tsc -p frontend/tsconfig.json --noEmit
node scripts/check-imports.mjs
npm --prefix frontend run build
npm --prefix frontend run lint

echo "--- OpenAPI CLI Parity ---"
npm run cli:typecheck
npm run cli:test
npm run cli:schema:check

echo "--- Python / Backend ---"
bash -lc 'cd backend && MYPYPATH=. .venv/bin/mypy --explicit-package-bases app --strict'
uvx ruff@0.15.22 check backend/ --fix
uvx ruff@0.15.22 format backend/

echo "--- Rust ---"
cargo clippy --manifest-path backend/rss_parser_rust/Cargo.toml -- -D warnings
cargo fmt --manifest-path backend/rss_parser_rust/Cargo.toml --all -- --check
(cd backend/rss_parser_rust && uv run maturin develop --release 2>&1)
cp backend/rss_parser_rust/target/release/librss_parser_rust.so backend/.venv/lib/python3.13/site-packages/rss_parser_rust/rss_parser_rust.abi3.so

echo "--- Tests ---"
bash -lc 'cd backend && .venv/bin/pytest tests -m "not slow"'

echo "--- All checks passed ---"
