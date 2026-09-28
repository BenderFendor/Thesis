# Workspace storage and log compression

## Goal and status

Compressed and bundled closed historical text logs to reduce logical and
allocated storage. Kept runtime JSONL available to its readers. Cargo dev/test
profiles now omit debug information and incremental compilation; the workspace
target will be measured after a clean rebuild.

## Reader and open-file audit

`runlocal.sh` writes to `LOG_DIR`, which defaults to `./log`. Historical
application logs under `backend/logs` have no application reader. The debug
routes read `debug_*.jsonl` from `DEBUG_LOG_DIR`; those files remain plain.
Repository references were checked before changing filenames.

`lsof +D backend/logs` and `lsof +D log` found no open regular files. The
recursive scan briefly listed its own `find` process holding directory handles;
it listed no log file descriptors. The newest source `.log` was dated
2026-07-19. The candidates had no symlinks, hard links, or existing `.log.gz`
destinations. Sampled files were ASCII, UTF-8, or empty text.

## Compression

Before compression, `backend/logs` contained 320,882 `.log` files and `log`
contained two. Together they held 208,095,175 logical bytes. The preflight
skipped 223 empty files and 43 files whose gzip stream would be larger. It
selected 320,618 files totaling 208,090,657 bytes; the measured compressed
outputs total 109,588,914 bytes, a logical reduction of 98,501,743 bytes.

The operation used `gzip -n` in batches of 1,000 with four workers. It retained
the source path with a `.gz` suffix, removed the original only after successful
compression, and confirmed each source/archive pair afterward. It left 266
plain `.log` files: 223 empty and 43 not profitable to compress. It did not
touch JSONL, `.txt` files, or Cargo outputs.

All 321,109 project gzip archives passed integrity checking:

```bash
find backend/logs backend/data log runtime-data backend/chroma.log.gz \
  -type f -name '*.gz' -print0 | xargs -0 -P 4 -n 1000 gzip -t --
```

The check exited 0 with no output. Before bundling, the selected archive paths
totaled 2,020,301,248 logical bytes. A broader scan of every `.gz` name also
found vendored Joblib compressed-
pickle test fixtures in virtual environments and worktrees. Those fixtures are
not gzip streams, so the broad scan exited 123; the project archive paths above
were checked separately.

Individual `.log.gz` files still consumed 1,624,965,120 allocated bytes for
419,316,883 apparent bytes because small files each occupy at least one 4 KiB
filesystem block. After confirming these paths have no application reader, I
bundled 320,755 `.log.gz` files into the lossless
`backend/logs/.historical-log-files-20260923.tar.gz` archive. Tar listed 320,755
members and its comparison mode matched every archived entry against the source
tree before the source files were removed. `gzip -t` passed on the outer
archive; the nested gzip streams had passed the earlier per-file check. This
removed 320,617 empty directories.

The logging rotation regression still passes through the production handler:

```text
cd backend
.venv/bin/pytest -q tests/test_console_logging.py
3 passed, 1 warning in 0.10s
```

The warning is the existing SQLAlchemy deprecation at
`backend/app/database.py:140`.

## Storage measurement

Before compression, `du -sh backend/target backend/logs runtime-data/logs`
reported 13G, 2.9G, and 552M. `du -sh --apparent-size backend/logs
runtime-data/logs` reported 1.9G and 277M. `df -h .` showed 587G total, 574G
used, 12G available, and 99% use.

The filesystem uses 4,096-byte blocks. Of the historical `backend/logs` files,
320,230 nonempty files were at most one block before compression. After
compression, `backend/logs` still used 2.9G by allocated size, while its
apparent size was 1,847,232,577 bytes (1.8G). Individual gzip files keep the
same per-file block allocation for these small logs. `runtime-data/logs` stayed
at 552M allocated and 290,651,523 apparent bytes.

The archive reduced `backend/logs` to 1,818,308,608 allocated bytes and
1,816,638,915 apparent bytes. The larger pre-existing rotated `app.log.N.gz`
files remain individually available. Cargo dev/test profiles changed from
`debug = 1` to `debug = 0`; both keep incremental compilation disabled. The
previous 14G target contained many duplicate test executables from repeated
verification. `cargo clean` removed 28,966 files and 15.0 GiB of build output.
After the 116-test workspace run, strict Clippy, the selected Kani harness, and
the comparison mutation run, `backend/target` measured 2,012,053,504 allocated
bytes and 1,991,110,735 apparent bytes. `log` is 6.2M allocated and 6,436,402
bytes apparent; `runtime-data/logs` is 552M allocated and 290,651,523 bytes
apparent.

```text
df -B1 --output=size,used,avail,pcent,target .
630247653376 611102810112 15469420544 98% /home
```

The archive retains all original `.log.gz` members and paths. Runtime JSONL was
not moved or compressed because existing observability and debug readers open
those files directly.

## Current measurement after migration checks

After the 121-test workspace run, strict Clippy, focused Kani check, Verus model
checks, and OpenAPI server build, `du -sh backend/target backend/logs
runtime-data/logs` reported 2.9G, 1.7G, and 552M. `df -h .` showed 14G
available at 98% filesystem use. The Rust build target is below 3G, down from
13G before the cleanup. The historical archive remains intact; JSONL logs stay
plain for active readers.
