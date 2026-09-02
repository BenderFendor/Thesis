#!/usr/bin/env bash
set -euo pipefail

exec node scripts/quality-hardening.mjs verify --scope repo "$@"
