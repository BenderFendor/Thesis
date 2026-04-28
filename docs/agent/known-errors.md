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

## Property test failure: source URL guard normalizes `www`

Symptom:

```txt
FAILED tests/test_source_url_guard.py::test_extract_domain_uses_google_news_site_scope
AssertionError: assert 'cnn.com' == 'www.cnn.com'
```

Cause:

- `extract_domain()` normalizes domains by stripping `www.`, while the property test currently expects the unnormalized host for Google News `site:` feeds.

Fix:

- Treat as a pre-existing test/expectation mismatch unless this task modifies `extract_domain`.
- If working in this area, align test expectation and extractor normalization semantics together.

## Property test failure: country mentions alias overmatches generated suffix

Symptom:

```txt
FAILED tests/test_country_mentions.py::test_extract_article_mentioned_countries_dedupes_and_sorts_alias_matches
AssertionError: assert ['CN', 'RU', 'US'] == ['CN', 'US']
```

Cause:

- Hypothesis can generate suffix text that includes additional country aliases (for example `Russia`), which invalidates the test's fixed expected set.

Fix:

- Treat as a pre-existing brittle property-test expectation unless the task changes country mention extraction.
- If touching this area, constrain generated text or make the assertion tolerate extra valid matches.
