# Known Errors

## Backend virtualenv missing tools

Symptom:

```txt
backend/.venv/bin/mypy: No such file or directory
```

Cause:

- Backend virtual environment was not created or dependencies were not installed.

Fix:

```bash
./runlocal.sh setup
```

## PostgreSQL not running locally

Symptom:

```txt
Postgres is not running at localhost:5432.
```

Cause:

- Local PostgreSQL service is stopped.

Fix:

```bash
sudo systemctl start postgresql
```

## Asyncpg localhost DNS timeout in sandbox

Symptom:

```txt
asyncpg.connect ... loop.getaddrinfo(host, port, ...) ... TimeoutError
```

Cause:

- A DB-backed verifier ran inside the Codex network-restricted sandbox using a `localhost` database host.
- Async DNS resolution for `localhost` can hang or time out before the local PostgreSQL connection is attempted.

Fix:

```bash
DATABASE_URL=postgresql+asyncpg://newsuser:newspass@127.0.0.1:5432/newsdb uv run python <db-backed-script>
```

If the sandbox still blocks local DB access, rerun the exact verifier outside the sandbox with approval.

## ChromaDB version or state mismatch

Symptom:

```txt
ChromaDB* version mismatch / startup failures with existing local state
```

Cause:

- Existing `.chroma` state incompatible with current runtime/library version.

Fix:

```bash
rm -rf .chroma && docker-compose restart
```

Note: use this only when local disposable Chroma state reset is acceptable.

## Cloudscraper auto-refresh hang on 403 challenge pages

Symptom:

```txt
enrich_local_reporter_author_pages.py hangs while probing Cloudflare-blocked author/article pages
```

Cause:

- The `VeNoMouS/cloudscraper` 403 auto-refresh path can retry or wait too long on Cloudflare challenge pages from this environment.
- Axios, Report.az, Bloomberg, and NewsNation still returned blocked/challenge responses during live reporter enrichment tests.

Fix:

- Keep Cloudscraper fallback bounded with `auto_refresh_on_403=False` and no 403 retry loop.
- Leave generic 403 bypass disabled unless a targeted test sets `THESIS_CLOUDSCRAPER_GENERIC_BLOCKS=1`; Bloomberg generic 403 probing hung in live testing.
- Keep `THESIS_CLOUDSCRAPER_HARD_TIMEOUT_SECONDS` set or defaulted so the fallback returns the direct fetch outcome with `fallback_error=cloudscraper_timeout`.
- Record the blocked URL as `access_barrier` plus `fallback_error`; do not treat it as a missing author-page signal.
