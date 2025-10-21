# RSS Ingestion Performance Optimization

This document describes the async RSS ingestion pipeline optimization implemented to improve performance by 60-65%.

## Overview

The optimization replaces the synchronous ThreadPoolExecutor-based RSS ingestion with an async pipeline that:
- Uses async HTTP fetching with httpx (up to 40 concurrent connections)
- Offloads CPU-bound feedparser parsing to ProcessPoolExecutor (bypasses GIL)
- Implements batched persistence for efficient database writes
- Provides dynamic resource configuration based on system capabilities

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Async Event Loop                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Fetch     │───▶│    Parse     │───▶│   Persist    │  │
│  │   Worker    │    │    Worker    │    │   Worker     │  │
│  │  (async)    │    │  (process)   │    │  (async)     │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                    │          │
│    fetch_queue         parse_queue         persist_queue   │
│   (bounded: 50)      (bounded: 100)      (bounded: 200)   │
│         │                   │                    │          │
│   Semaphore(N)      ProcessPoolExecutor    AsyncPG Pool    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## New Files

### `app/core/resource_config.py`
Dynamic resource configuration that auto-tunes based on system RAM and CPU:
- **CPU workers**: ProcessPoolExecutor workers (1-6 based on cores)
- **Fetch concurrency**: Async HTTP connections (15-40 based on RAM)
- **Queue sizes**: Bounded queues to prevent memory exhaustion
- **Batch sizes**: Persistence batch sizes (100-200 articles)

Uses `psutil` if available, falls back to conservative defaults.

### `app/services/metrics.py`
Pipeline metrics collection:
- Fetch/parse/persist counts and error counts
- Duration tracking
- Queue size monitoring
- Available via `/debug/metrics/pipeline` endpoint

### `app/services/scheduler.py`
Async task scheduler for periodic RSS refresh:
- Replaces old thread-based scheduler
- Runs as background asyncio.Task
- Gracefully handles cancellation

## Modified Files

### `app/services/rss_ingestion.py`
Added new async pipeline functions:
- `_blocking_parse_feed()`: CPU-bound parsing in ProcessPoolExecutor
- `_fetch_worker()`: Async HTTP fetching with httpx
- `_parse_worker()`: Offloads parsing to process pool
- `_persist_worker()`: Batched persistence with instant UI feedback
- `refresh_news_cache_async()`: Main async pipeline coordinator

Kept original `refresh_news_cache()` for backward compatibility.

### `app/main.py`
- Added signal handlers for graceful shutdown (SIGTERM/SIGINT)
- Integrated async scheduler (`periodic_rss_refresh`)
- Changed initial refresh to use `refresh_news_cache_async()`
- Added background task registration for async scheduler

### `app/api/routes/debug.py`
Added `/debug/metrics/pipeline` endpoint for monitoring pipeline performance.

### `requirements.txt`
Added `psutil>=5.9.0` as optional dependency for better resource tuning.

## Performance Improvements

### Current Performance (Estimated)
- 120 sources × ~3s fetch = ~6 minutes (5 concurrent threads)
- Parsing: GIL-blocked, ~30s total
- Persistence: sequential, ~60s total
- **Total: ~7-8 minutes**

### Target Performance
- 120 sources × ~1s fetch = ~2 minutes (40 concurrent async)
- Parsing: parallel processes, ~15s total
- Persistence: batched, ~20s total
- **Total: ~2.5-3 minutes (60-65% improvement)**

### Resource Usage
- **Current**: 5 threads, ~1 CPU core utilized
- **Target**: 40 async tasks + 6 processes = ~6-7 cores utilized
- **Memory**: Slightly higher (buffered queues) but bounded by `maxsize`

## Usage

The async pipeline is automatically used on startup. Both sync and async versions are available:

```python
# Async version (recommended)
await refresh_news_cache_async(source_progress_callback)

# Sync version (backward compatibility)
refresh_news_cache(source_progress_callback)
```

## Monitoring

Monitor pipeline performance via the debug endpoint:
```bash
curl http://localhost:8000/debug/metrics/pipeline
```

Response includes:
- Fetch/parse/persist counts and errors
- Duration in seconds
- Queue sizes

## Testing

Run the test script to verify the implementation:
```bash
python backend/test_async_ingestion.py
```

## Graceful Shutdown

The pipeline handles SIGTERM and SIGINT gracefully:
1. Sets shutdown event to stop workers
2. Flushes any pending batches
3. Shuts down ProcessPoolExecutor
4. Closes HTTP client connections

## Backward Compatibility

The original `refresh_news_cache()` function remains unchanged and fully functional. The old thread-based scheduler `start_cache_refresh_scheduler()` is still available but the new async scheduler is used by default.

## Future Improvements

1. Add retry logic with exponential backoff for failed fetches
2. Implement progressive timeout strategy (fast sources get priority)
3. Add Prometheus metrics integration
4. Implement circuit breaker for consistently failing sources
5. Add rate limiting per domain to be respectful
6. Consider Redis caching for frequently accessed feeds
