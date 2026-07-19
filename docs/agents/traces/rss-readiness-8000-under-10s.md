# RSS Readiness: 8,000 Articles Under 10 Seconds

## Goal and done criteria

- Make at least 8,000 saved or already parsed articles visible within 10 seconds.
- Do not remove image extraction, persistence, embeddings, reporter work, ownership work, or detailed logs.
- Keep routine console output short while retaining per-source detail in rotating files.
- Separate local readiness from remote feed collection time.

## Status

Implemented and verified. The deterministic 8,000-article local publication path takes about 0.19 seconds. The real database startup loaded 10,000 articles in 0.534 seconds, and an isolated API worker completed startup with those 10,000 articles in 0.63 seconds.

The first real July 19 pull returned 7,867 articles from 261 configured sources. It published in 30.177 seconds: 26.296 seconds remote fetch, 0.189 seconds Rust parse, and 3.654 seconds local publication.

After starting all 270 feed URLs concurrently and adding the learned slowest-success-plus-one-second deadline, a second real pull published 7,891 articles in 21.343 seconds. Remote fetching ended in 17.456 seconds at the learned 17.441-second deadline; 254 of 270 requests completed within two seconds. One timed-out source kept its cached articles and was scheduled for a full-window late retry. The remote portion remains outside a deterministic 10-second bound because the measured slowest working feed took 16.441 seconds. Startup does not wait for it.

## Files changed

- `backend/app/core/config.py`
- `backend/app/core/logging.py`
- `backend/app/main.py`
- `backend/app/services/rss_ingestion.py`
- `backend/app/services/rss_parser_rust_bindings.py`
- `backend/app/vector_store.py`
- `backend/rss_parser_rust/src/fetcher.rs`
- `backend/rss_parser_rust/src/lib.rs`
- `backend/rss_parser_rust/src/parser.rs`
- `backend/rss_parser_rust/src/types.rs`
- `backend/tests/benchmarks/measure_rss_readiness.py`
- `backend/tests/test_console_logging.py`
- `backend/tests/test_rss_readiness.py`
- `backend/tests/test_startup_cache_readiness.py`
- `backend/tests/test_vector_store_logging.py`
- `README.md`
- `docs/Log.md`
- `docs/agent/known-errors.md`
- `docs/agent/learnings.md`

## Commands and tests run

- `uv run pytest -q backend/tests/test_rss_readiness.py --durations=3`
- `uv run pytest -q backend/tests/test_console_logging.py backend/tests/test_rss_readiness.py backend/tests/test_startup_cache_readiness.py`
- `uvx ruff check` on all changed Python files
- `uv run python -m cProfile` before and after the cache update change
- Direct database warmup measurement with `ENABLE_DATABASE=1`
- Isolated Gunicorn runtime on `127.0.0.1:4021` plus `GET /cache/status`
- `PYTHONPATH=. uv run python tests/benchmarks/measure_rss_readiness.py --wait-for-enrichment`
- `PYTHONPATH=backend uv run python backend/tests/benchmarks/measure_rss_readiness.py`
- `cargo check --manifest-path backend/rss_parser_rust/Cargo.toml`
- `cargo clippy --manifest-path backend/rss_parser_rust/Cargo.toml --all-targets --all-features -- -D warnings`
- `uv run pytest backend/tests/test_rss_readiness.py backend/tests/test_rss_resource_limits.py -q`: 10 passed
- `scripts/self-test`: passed, including 431 backend tests with 3 slow tests deselected

## Assumptions and risks

- “8,000+ sources” was interpreted as 8,000+ articles across the current 261-source catalog. This matches the reported 500-to-7,841 article behavior.
- A database-backed restart meets the 10-second readiness goal. A first-ever empty-database pull cannot guarantee 10 seconds because remote feed collection alone measured 26.296 seconds in the real run.
- The adaptive deadline follows the requested maximum-success rule exactly. It is intentionally not a percentile cutoff, so one unusually slow but successful feed can raise the next run's primary deadline.
- The deadline uses a 5-second default without history and remains bounded between 2 and the prior 25-second hard limit.
- Post-publish image work mutates the same cached article objects, then queues the enriched articles for database persistence and broadcasts another cache update.

## Rollback

- Set `STARTUP_CACHE_ARTICLE_LIMIT` lower to reduce per-worker startup memory.
- Revert the post-publish task split in `backend/app/services/rss_ingestion.py` to restore blocking enrichment, though that also restores the measured delay.
