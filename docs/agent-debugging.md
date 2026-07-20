# Evidence-based debugging

Thesis keeps a small local evidence layer so a coding agent can diagnose failures from facts instead of reconstructing them from a vague symptom.

## What is collected

Runtime data is written under `runtime-data/` by default. Override the location with `THESIS_RUNTIME_DIR`.

- Existing structured application events remain JSONL and now default to `runtime-data/logs/`.
- `performance_<service>_<pid>.jsonl` stores one resource sample every five seconds.
- `traces_<service>_<pid>.jsonl` stores completed OpenTelemetry spans when `OTEL_ENABLED=1`.
- Frontend errors, unhandled promise rejections, resource failures, navigation timing, and browser long tasks are sent to the existing `/debug/logs/frontend` endpoint.

Resource samples include process and host CPU, process RSS/VMS, host memory and swap, disk usage and cumulative I/O, network counters, thread/file-descriptor counts, event-loop lag, and NVIDIA GPU state when `nvidia-smi` is available.

The embedding worker also records sparse `model_load` and `embedding_batch` operation events. Those include duration, input count, batch size, character count, result count, and embedding dimension without storing input text.

## Collect a bundle

Reproduce the problem, then run:

```bash
./scripts/collect-debug-bundle --since 30m
```

The command prints a directory and ZIP path under `debug-bundles/`. It is best-effort: it still produces a bundle when the backend, Docker, Node, Postgres, or Chroma is unavailable.

The bundle contains:

- Time-filtered JSONL logs
- Current and recent resource snapshots
- Existing profiling, query, startup, pipeline, storage-drift, and debug reports
- Git revision, branch, dirty state, and recent commits
- Python, Node, platform, Docker Compose, disk, and sanitized configuration context
- A deterministic `summary.md`

Give an agent the repository, the user-visible symptom, and the generated ZIP. Correlate records using timestamps plus `service`, `operation`, `request_id`, and `trace_id`.

## Useful endpoints

```text
GET /debug/observability/resources
GET /debug/observability/performance?since_minutes=30&limit=500
GET /debug/observability/runtime
GET /debug/observability/health
GET /debug/logs/report
GET /profiling/summary
GET /profiling/queries
```

The embedding worker also exposes `GET /debug/resources` on its own port.

## Configuration

```env
THESIS_OBSERVABILITY_ENABLED=1
THESIS_PERFORMANCE_SAMPLE_SECONDS=5
THESIS_RUNTIME_DIR=/path/to/runtime-data
THESIS_SERVICE_NAME=backend
THESIS_LOG_MAX_BYTES=26214400
THESIS_LOG_BACKUP_COUNT=3
OTEL_ENABLED=1
OTEL_SAMPLE_RATE=1.0
OTEL_CONSOLE_EXPORT=0
```

OpenTelemetry remains optional. Resource sampling and structured request events do not require an external collector, Prometheus, Grafana, Loki, Tempo, or Pyroscope.

## Privacy and size rules

- Query parameter values are not recorded by request tracing; only parameter names are retained.
- Browser telemetry records the pathname, not URL query strings.
- Embedding text is never logged.
- The bundle collector whitelists configuration keys and redacts secrets and database passwords.
- Runtime JSONL files rotate at 25 MiB by default and retain three backups. Override the cap and backup count with `THESIS_LOG_MAX_BYTES` and `THESIS_LOG_BACKUP_COUNT`.
- Generated runtime data and bundles are ignored by Git.

Use `py-spy`, `tracemalloc`, Playwright traces, or `EXPLAIN ANALYZE` only after the lightweight evidence identifies which service or operation needs deeper profiling.
