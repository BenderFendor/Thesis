# Performance Baseline Report

**Date:** TBD
**Backend:** FastAPI at /home/bender/classwork/Thesis/backend
**Test Environment:** Development

## 1. Configuration Snapshot

### Database Configuration
- **pool_size:** 20
- **max_overflow:** 0
- **Database URL:** postgresql+asyncpg://newsuser:newspass@localhost:5432/newsdb

### Application Configuration
- **app_title:** Global News Aggregation API
- **app_version:** 1.0.0
- **enable_vector_store:** true
- **enable_database:** true
- **embedding_batch_size:** 64
- **embedding_max_per_minute:** 240

### Worker Configuration
- **UVICORN_WORKERS:** Not configured (default 1)
- **Server:** uvicorn with reload enabled in development

## 2. Dependencies
```
fastapi>=0.110.0
uvicorn>=0.27.0
feedparser>=6.0.10
pydantic>=2.8.0
httpx>=0.25.2
sqlalchemy>=2.0.35
asyncpg>=0.29.0
chromadb>=0.4.24
sentence-transformers>=2.7.0
```

## 3. Endpoint Inventory

### HTTP APIs
| Endpoint | Method | Description | Category |
|----------|--------|-------------|----------|
| /news/page | GET | Paginated news feed with filters | READ |
| /news/page/cached | GET | Cached paginated news | READ |
| /news/recent | GET | Recent articles (lightweight) | READ |
| /news/category/{category} | GET | Filter by category | READ |
| /news/source/{source} | GET | Filter by source | READ |
| /news/sources | GET | List all sources | INFO |
| /news/categories | GET | List all categories | INFO |
| /news/sources/stats | GET | Source statistics | INFO |
| /api/search/semantic | GET | Semantic search | SEARCH |
| /health | GET | Health check | SYSTEM |

### WebSocket Streams
| Endpoint | Method | Description |
|----------|--------|-------------|
| /ws | WebSocket | Real-time news stream |
| /news/stream | GET | Server-Sent Events stream |

### Background Tasks
| Task | Schedule | Description |
|------|----------|-------------|
| RSS Refresh | 600s interval | Fetch and parse RSS feeds |
| Cluster Update | 300s interval | Update topic clusters |
| Cluster Merge | 1800s interval | Merge similar clusters |
| Article Persistence | Continuous | Save articles to DB |
| Embedding Generation | Continuous | Generate vector embeddings |

## 4. Key Components

### Rust Extension
- **Module:** rss_parser_rust
- **Purpose:** Accelerated RSS parsing
- **Function:** parse_feeds_parallel

### Cache
- **Type:** In-memory (news_cache)
- **Size:** Dynamic (loaded from DB on startup)
- **Update Strategy:** Background RSS refresh

### Vector Store
- **Type:** ChromaDB
- **Embedding Model:** sentence-transformers
- **Usage:** Semantic search, clustering

## 5. Expected Bottleneck Areas

Based on code analysis:

1. **RSS Parsing** (parse_feeds_parallel)
   - Network I/O bound
   - Rate limiting from sources
   - Parser overhead

2. **Semantic Search** (/api/search/semantic)
   - Vector similarity search in ChromaDB
   - Database JOIN for article details
   - Embedding model inference

3. **News Feed Pagination** (/news/page)
   - Database cursor queries
   - Count queries for pagination
   - Multiple JOINs for related data

4. **Server-Sent Events Stream** (/news/stream)
   - Long-running connections
   - Cache lookup per request
   - OG image enrichment

5. **Clustering** (periodic_cluster_update)
   - HDBSCAN algorithm
   - Vector distance calculations
   - Batch database operations

## 6. Benchmarking Methodology

### Tools
- **Primary:** Custom async HTTP benchmark
- **Alternative:** wrk2 for latency distribution
- **Alternative:** locust for complex user scenarios

### Test Scenarios
1. **Single User:** Baseline latency, no contention
2. **10 Users:** Light concurrent load
3. **50 Users:** Moderate concurrent load
4. **100 Users:** High concurrent load

### Metrics Collected
- Requests per second (RPS)
- Latency percentiles (p50, p75, p95, p99)
- Error rates
- Memory usage
- CPU utilization

## 7. Baseline Measurements

### To be filled after running benchmarks:

```
| Endpoint            | Users | RPS    | p50ms | p95ms | p99ms | Errors |
|---------------------|-------|--------|-------|-------|-------|--------|
| /news/page          | 10    |        |       |       |       |        |
| /news/page          | 50    |        |       |       |       |        |
| /news/page          | 100   |        |       |       |       |        |
| /news/page/cached   | 10    |        |       |       |       |        |
| /news/page/cached   | 50    |        |       |       |       |        |
| /api/search/semantic| 10    |        |       |       |       |        |
| /health             | 100   |        |       |       |       |        |
```

## 8. Hypothesis Log

| # | Observation | Hypothesis | Confidence | Status |
|---|-------------|------------|------------|--------|
| 1 |                |            |            | pending |
| 2 |                |            |            | pending |
| 3 |                |            |            | pending |

## 9. Optimization History

| Date | Change | Before (p95) | After (p95) | Improvement |
|------|--------|--------------|-------------|-------------|
|      |        |              |             |             |

## 10. Notes

- Run benchmarks with: `python /home/bender/classwork/Thesis/backend/tests/benchmarks/benchmarks.py --all --users 10,50,100 --duration 30`
- Use locust for complex scenarios: `locust -f /home/bender/classwork/Thesis/backend/tests/benchmarks/locustfile.py`
- Monitor in real-time: `curl http://localhost:8000/profiling/summary`
