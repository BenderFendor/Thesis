# Performance Profiling Laboratory

Comprehensive performance profiling suite for the FastAPI backend at `/home/bender/classwork/Thesis/backend`.

## Quick Start

```bash
# 1. Start the backend server
cd /home/bender/classwork/Thesis/backend
python -m app.main

# 2. In another terminal, run the performance lab
cd /home/bender/classwork/Thesis/backend
python tests/benchmarks/run_performance_lab.py --quick

# Or run full benchmarks
python tests/benchmarks/run_performance_lab.py --users 10,50,100 --duration 30
```

## Directory Structure

```
tests/benchmarks/
├── benchmarks.py              # Main benchmark suite
├── capture_config.py          # Configuration capture script
├── run_performance_lab.py     # Integration script
├── locustfile.py              # Locust load test scenarios
├── lua_scripts/
│   └── latency.lua            # wrk2 latency script
├── results/                   # Benchmark results (created on run)
│   ├── baseline_results.json
│   ├── bottlenecks.json
│   ├── PERFORMANCE_REPORT.md
│   └── config_snapshot.json
└── README.md

app/core/
├── profiling.py               # Profiling middleware and utilities
└── db_profiling.py            # Database query profiling

api/routes/
└── profiling.py               # Metrics endpoints
```

## Profiling Endpoints

Once the server is running, access these endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /profiling/metrics` | Prometheus-compatible metrics |
| `GET /profiling/summary` | JSON profiling summary |
| `GET /profiling/bottlenecks` | Bottleneck analysis |
| `GET /profiling/queries` | Database query statistics |
| `GET /profiling/startup` | Startup timing |
| `GET /profiling/slow-endpoints` | Slowest endpoints |
| `POST /profiling/reset` | Reset profiling data |

## Benchmark Commands

### Quick Benchmark (5 samples per endpoint)
```bash
python tests/benchmarks/benchmarks.py --quick
```

### Full Benchmark Suite
```bash
python tests/benchmarks/benchmarks.py --all --users 10,50,100 --duration 30
```

### Specific Endpoint
```bash
python tests/benchmarks/benchmarks.py --endpoint /news/page --users 50 --duration 60
```

### Using Locust
```bash
# Interactive
locust -f tests/benchmarks/locustfile.py --host=http://localhost:8000

# Headless
locust -f tests/benchmarks/locustfile.py --host=http://localhost:8000 \
  --users 100 --spawn-rate 10 --run-time 60s --headless
```

## Using wrk2

```bash
# Install wrk2 first
# Then run latency test
wrk2 -t4 -c100 -d30s -R50 -s tests/benchmarks/lua_scripts/latency.lua \
  http://localhost:8000/news/page
```

## Phases

### Phase 1: Instrumentation
- Profiling middleware captures per-request timing
- Database query profiling
- External service call tracking
- Memory/CPU monitoring

### Phase 2: Baseline Measurement
- Run benchmarks with 10, 50, 100 concurrent users
- Document current performance
- Identify initial bottlenecks

### Phase 3: Diagnosis
- Analyze bottleneck data
- Generate hypotheses
- Prioritize fixes

### Phase 4: Iteration
- Make one change at a time
- Re-run benchmarks
- Document improvements

### Phase 5: Report
- Compare before/after
- Generate recommendations
- Create production config

## Captured Metrics

### Per-Endpoint
- Request count
- Average latency
- Min/Max latency
- Percentiles (p50, p75, p95, p99)
- Error count

### Database
- Query timing
- Slow query detection
- N+1 pattern detection
- Connection pool stats

### External Services
- Rust parser timing
- Embedding service latency
- Timeout/error tracking

### Resources
- Memory usage (RSS, VMS)
- CPU utilization
- Garbage collection stats

## Files Generated

| File | Purpose |
|------|---------|
| `PERFORMANCE_BASELINE.md` | Initial baseline (fill in after first run) |
| `PERFORMANCE_REPORT.md` | Final optimization report |
| `tests/benchmarks/results/*.json` | Raw benchmark data |

## Best Practices

1. Always run benchmarks with consistent conditions
2. Make one change at a time
3. Re-run baseline before each major optimization
4. Document all changes in PERFORMANCE_REPORT.md
5. Monitor production metrics after deployment

## Requirements

- Python 3.10+
- httpx
- locust (optional, for complex tests)
- wrk2 (optional, for latency distribution)
- psutil (included in requirements.txt)

## Troubleshooting

### Server not available
```bash
# Check if server is running
curl http://localhost:8000/health

# Start server
cd /home/bender/classwork/Thesis/backend
python -m app.main
```

### Import errors
```bash
# Install dependencies
pip install -r requirements.txt
```

### Memory profiling issues
memray is optional. If not available, profiling falls back to psutil-only monitoring.
