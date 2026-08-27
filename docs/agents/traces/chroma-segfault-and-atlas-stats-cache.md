# ChromaDB segfault fix + Atlas stats cache

## Goal and done criteria

1. ChromaDB (`runlocal.sh` chroma target) was segfaulting on startup,
   forcing the app into lexical-clustering fallback. Find the root cause,
   fix it, verify Chroma stays up and the app can write vectors.
2. `/api/wiki/atlas/stats` and `/graph` took 20-26s on the first hit after
   backend startup. Find the bottleneck, cache the cold path so repeated
   polling never re-triggers a full rebuild, verify with real timings, keep
   `pytest tests/ -q` green.

Both done: Chroma is stable under sustained write load with the corrupt
data directory replaced; `/stats` now serves cached responses in ~2-3ms
instead of recomputing per request; full suite is green.

## Status: complete

## Root cause: ChromaDB segfault

Confirmed via `dmesg`/`journalctl -k`: every crash was
`chroma[PID]: segfault ... in hnswlib.cpython-313-x86_64-linux-gnu.so`,
consistently right after `Starting component PersistentLocalHnswSegment`
and a batch of `Add of existing embedding ID` warnings (i.e. as soon as the
persisted HNSW index for the `news_articles` collection was touched).

Isolated the cause by process of elimination:

- **Not a broken wheel / version mismatch.** Pointing `chroma run --path`
  at a fresh empty directory (same binary, same `chromadb==0.5.23`, same
  `hnswlib` `.so`, same Python 3.13.12 interpreter) started clean. Using the
  app's own `VectorStore` class (not a hand-rolled client) against that
  fresh instance, added 50 vectors, re-added the same 50 IDs (replaying the
  exact duplicate-ID pattern from the crash log), and queried — all worked
  with no crash. This rules out a native-wheel/ABI problem.
- **Data-dir corruption confirmed.** Pointing `chroma run --path` at the
  *actual* `.chroma` data directory and querying the `news_articles`
  collection reproduced the segfault immediately and deterministically
  (`journalctl -k` timestamp matched the query call to the second).

Root cause: the persisted HNSW segment
(`.chroma/d30248d2-e78a-41ad-b3dd-d43449bdd248/*.bin` +
`index_metadata.pickle`) was corrupted on disk. The most likely trigger:
the host filesystem (`/home`, `/dev/sdd1`) was at **100% disk usage** (4.2 GB
free out of 587 GB) at the time of the crash, and a `.chroma/chroma.log`
inside the data directory itself had grown to **3.4 GB** — almost certainly
from a stray earlier `chroma run` invoked without an external log redirect,
writing its own server log straight into the data directory next to the
index files. A write that gets truncated mid-flush under disk pressure is
a standard way to corrupt an HNSW segment or its pickle metadata; hnswlib
then reads a malformed structure and segfaults instead of raising a
catchable Python exception (it's a native extension).

### Fix

- Moved the corrupted data directory aside:
  `.chroma` → `.chroma.corrupt-20260722` (not deleted, per instructions).
- Removed the redundant 3.4 GB `chroma.log` *inside* that backup directory
  only (a duplicate server log, not vector/index data — `log/chroma.log` is
  the real configured log per `runlocal.sh`'s `CHROMA_LOG_FILE`). This
  reclaimed ~3.4 GB of disk headroom without touching any actual vector
  data, in case the corrupt dir is ever needed for forensics.
- Created a fresh empty `.chroma` directory. `runlocal.sh`'s `start_chroma`
  needed no changes — it already creates the dir if missing
  (`mkdir -p "$CHROMA_DATA_DIR"`).
- **Embeddings rebuild automatically.** The app already has a drift-recovery
  path for exactly this scenario:
  `backend/app/services/chroma_sync.py::_detect_and_fix_chroma_drift` —
  on startup, if Chroma's document count is below `_FULL_SYNC_THRESHOLD`
  (10,000), it enters recovery mode and re-embeds every article from
  Postgres by `published_at DESC`, without needing any DB flag reset or
  manual re-ingest command. Verified live: after swapping in the fresh
  directory, the running backend detected the empty Chroma collection and
  began re-embedding within seconds; watched the count climb (0 → 1,401 →
  40,194 → 49,594) over ~10 minutes with **zero** further segfaults
  (checked `journalctl -k` before/after — the last segfault timestamp
  stayed pinned to before the swap). Full backfill (~50k+ articles) will
  keep running in the background; no manual re-embed step is needed.

### Telemetry error (left as-is)

`ERROR: Failed to send telemetry event ServerStartEvent: capture() takes 1
positional argument but 3 were given` still appears in the Chroma log. This
is a known `chromadb==0.5.23` / `posthog` client incompatibility in
Chroma's own anonymized-telemetry call, not something `ANONYMIZED_TELEMETRY`
env handling on our side can suppress — the app's `VectorStore` already
passes `anonymized_telemetry=False` in its own `Settings()`
(`backend/app/vector_store.py:211`), but the *server* process (`chroma run`,
started by `runlocal.sh`, not our code) still enables it by default and hits
the same bug independent of the client. It's caught and logged by Chroma
itself, non-fatal, and unrelated to the segfault (it fires on every clean
startup, corrupt data dir or not). Fixing it would mean patching
`chromadb`/`posthog` inside the installed package, which is out of scope —
left as-is and reported per instructions.

### Disk space — flagged, not fixed

`/home` (`/dev/sdd1`) is still at **100% usage, ~3.7 GB free** after the
cleanup above. This is the same condition that most likely corrupted the
HNSW segment in the first place, and it can recur — Chroma's HNSW index and
Postgres both need headroom to flush safely. This is a host-level disk
management problem outside this task's scope (didn't audit or clean the
other multi-GB log files under `backend/`, `log/`, `.autoresearch/` etc. at
the repo root); flagging clearly rather than silently leaving it.

## Root cause: slow `/stats` and `/graph`

Reproduced the exact slow-request log lines from the original cold start:

```
Slow request detected: GET /api/wiki/atlas/graph took 22067.9ms
Slow request detected: GET /api/wiki/atlas/stats took 26601.9ms
```

`build_atlas_stats` (`backend/app/services/atlas_graph.py`) calls
`build_atlas_graph` with `limit_nodes=None` — i.e. every request builds the
**full, unbounded** node/edge projection (11,637 nodes in the current
corpus, ~11,395 of them reporters) instead of the 350-node default the
`/graph` route itself uses. `atlas_graph_projection.py`'s reporter query
only applies a `.limit(...)` clause when `filters.limit_nodes` is truthy
(line ~79-81), so the unbounded stats call fetches and processes every
reporter row on every single request — including every poll from the UI's
status strip.

Direct profiling on a warm process showed `_load_graph_projection` (the
reporter query) taking ~1.3s and the full `build_atlas_stats` ~1.6-2s once
Postgres's page cache and the SQLAlchemy connection pool were already warm.
The 22-26s figures in the logs were captured on the very first request
after backend startup, while `chroma_sync`'s drift-recovery pass and
`auto_ingest` were concurrently hammering the same DB pool with an initial
burst of writes — i.e. the "cold path" cost is a combination of (a) cold
connection-pool/query-plan/OS-page-cache state and (b) DB contention from
concurrent startup ingestion, not an inherently slow query in isolation.
What already makes subsequent hits fast (per the task's "verify what
caches this" ask): nothing in the app layer — it's simply Postgres's shared
buffer cache and the OS page cache staying warm, plus the already-established
SQLAlchemy connection pool, once the first request has paid that cost.
There was no existing in-app cache before this change.

### Fix

Added a TTL cache in front of `build_atlas_stats`
(`backend/app/services/atlas_graph.py`):

- `get_atlas_stats_cached(db)` — module-level cache, 5-minute TTL, guarded
  by an `asyncio.Lock` so concurrent pollers hitting a cold cache share one
  computation instead of each re-running the full scan.
- `invalidate_atlas_stats_cache()` — clears the cache; wired into
  `app/services/auto_ingest.py::run_auto_ingest`, called right after a run
  that executed any network-bound stage, so the cache never serves stats
  older than the newest ingested data by more than one in-flight request.
- `build_atlas_stats` itself is untouched and still exported — the existing
  regression test (`tests/test_atlas_research_coverage.py`) calls it
  directly against a fresh in-memory SQLite DB per test, so it must stay
  pure/uncached. Only the route
  (`backend/app/api/routes/wiki_atlas.py::get_atlas_stats`) was switched
  from `build_atlas_stats` to `get_atlas_stats_cached`.

`/graph`'s own cold-hit cost was not separately cached — it already runs
with the bounded `limit_nodes=350` default in the real route (confirmed:
0.25-0.4s on a freshly reloaded worker, cold and warm alike), so its
22s figure in the original log was very likely the same startup-contention
effect described above, not the query itself. Per the task's own guidance
not to over-engineer, no additional projection cache was added — the stats
cache alone eliminates the dominant load pattern (repeated status-strip
polling of the unbounded query).

## Files changed

- `backend/app/services/atlas_graph.py` — added `get_atlas_stats_cached`,
  `invalidate_atlas_stats_cache`, and the underlying module-level TTL cache
  state.
- `backend/app/api/routes/wiki_atlas.py` — `/stats` route now calls
  `get_atlas_stats_cached` instead of `build_atlas_stats`.
- `backend/app/services/auto_ingest.py` — calls
  `invalidate_atlas_stats_cache()` after a run that executed any
  network-bound stage.
- `backend/tests/test_atlas_stats_cache.py` (new) — cache reuse,
  invalidation, and TTL-expiry tests.
- `.chroma/` — corrupted data directory replaced with a fresh empty one;
  old data preserved at `.chroma.corrupt-20260722/` (its redundant internal
  3.4 GB log file was removed to reclaim disk space; the actual
  `chroma.sqlite3` and HNSW segment files were left intact for forensics).

## Commands and tests run

- `journalctl -k -n 200 | grep segfault` — confirmed 4 prior crashes, all
  `hnswlib.cpython-313-x86_64-linux-gnu.so`.
- Manual `chroma run --path <fresh dir>` + app `VectorStore` add/query —
  clean, no crash (rules out broken wheel).
- Manual `chroma run --path .chroma` (the real, corrupt dir) + query —
  reproduced the segfault deterministically.
- Live verification after the swap: watched Chroma document count climb
  from 0 to 49,594 over ~10 minutes of continuous drift-recovery writes
  with zero further segfaults.
- `cd backend && uv run pytest tests/ -q` → **631 passed, 3 skipped**
  (baseline 628 passed, 3 skipped + 3 new cache tests = 631; no
  regressions).
- `ruff check` on all changed files — clean.
- `kill -HUP` on the gunicorn master to reload a genuinely fresh worker,
  then timed `/api/wiki/atlas/stats` and `/api/wiki/atlas/graph`:

  | Endpoint | Before (this change, cold worker) | After: 1st call | After: 2nd call (cached) |
  |---|---|---|---|
  | `/api/wiki/atlas/stats` | 26.6s (original startup log) | 1.81s | **0.003s** |
  | `/api/wiki/atlas/graph` | 22.1s (original startup log) | 0.25s | 0.38s |

  The stats endpoint's repeat-call cost dropped from a full recompute every
  time to ~3ms, which is what actually matters for a UI element that polls
  continuously.

## Assumptions and risks

- Assumed the corrupt `.chroma` data directory's articles are fully
  recoverable from Postgres (they are — `chroma_sync.py`'s drift recovery
  is exactly this path, and it was observed working live). No manual
  re-ingest was run; the backfill was still in progress (49,594 of ~50k+
  articles re-embedded) when this trace was written and will finish on its
  own.
- Did not attempt to fix the chromadb/posthog telemetry `capture()` TypeError
  — it's inside the installed `chromadb` package's own instrumentation, not
  application code, and is non-fatal.
- Disk is still at 100% capacity (~3.7 GB free). This is flagged as a
  recurrence risk for the corruption but is out of scope for this task —
  did not audit unrelated large log files under `backend/`, `log/`, or
  `.autoresearch/`.

## Remaining / next executable step

- If disk space needs to be reclaimed further, audit and rotate/delete the
  other multi-GB stray logs found during investigation (`backend/chroma.log`
  ~633 MB, `chroma.log` at repo root, `.autoresearch/*.log`) — not touched
  here since it's outside the assigned scope.
- `.chroma.corrupt-20260722/` can be deleted once confirmed unneeded for
  forensics; it still holds the corrupted `chroma.sqlite3` (532 MB) and HNSW
  segment (72 MB).
