#!/usr/bin/env bash
set -euo pipefail

THESIS_BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
THESIS_PG_TMP="$(mktemp -d /tmp/thesis-http-differential.XXXXXX)"
THESIS_PG_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"

cleanup() {
	if [[ -d "$THESIS_PG_TMP/data" ]]; then
		pg_ctl -D "$THESIS_PG_TMP/data" -m immediate stop >/dev/null 2>&1 || true
	fi
	rm -rf "$THESIS_PG_TMP"
}
trap cleanup EXIT

initdb -D "$THESIS_PG_TMP/data" -U thesis --auth=trust >/dev/null
pg_ctl -D "$THESIS_PG_TMP/data" \
	-l "$THESIS_PG_TMP/postgres.log" \
	-o "-h 127.0.0.1 -p $THESIS_PG_PORT -k $THESIS_PG_TMP" \
	-w start >/dev/null
createdb -h 127.0.0.1 -p "$THESIS_PG_PORT" -U thesis thesis_test

THESIS_TEST_DATABASE_URL="postgresql://thesis@127.0.0.1:$THESIS_PG_PORT/thesis_test"
cd "$THESIS_BACKEND_DIR"
DATABASE_URL="$THESIS_TEST_DATABASE_URL" \
	.venv/bin/alembic -c alembic.ini upgrade 20260720_0003
THESIS_TEST_DATABASE_URL="$THESIS_TEST_DATABASE_URL" \
	.venv/bin/pytest -q tests/test_rust_evidence_http_differential.py
