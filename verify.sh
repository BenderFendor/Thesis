#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
: "${THESIS_VERIFY_CONCURRENCY:=4}"
export THESIS_VERIFY_CONCURRENCY

exec node scripts/quality-hardening.mjs verify --scope repo "$@"
