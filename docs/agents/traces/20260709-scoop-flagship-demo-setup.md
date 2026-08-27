# Agent Trace

## Task

- Task ID: scoop-flagship-demo-setup
- Risk: low
- Goal: select the strongest resume project from the local portfolio and create a bounded, non-destructive local showcase setup for Scoop.

## Changed Files

- `runlocal.sh`
- `scripts/flagship-demo-preflight`
- `docs/flagship-demo-plan.md`
- `docs/Log.md`

## Assumptions

- Existing unstaged Scoop feature work belongs to the user or another agent and must remain untouched.
- The showcase should use a compact reproducible dataset rather than a full live corpus.
- `/mnt/Big storage` remains the appropriate place for disposable Chroma data when it has the documented free-space reserve.

## Verification Performed

- `bash -n runlocal.sh`: passed.
- `bash -n scripts/flagship-demo-preflight`: passed.
- `bash scripts/flagship-demo-preflight --help`: passed.
- `bash scripts/flagship-demo-preflight --init-storage --print-env`: passed. It created the empty `/mnt/Big storage/scoop-demo` directory, found 189 GiB free on that mount, verified local dependencies and PostgreSQL, and found ports 3100/8100/8101/8102 available.
- `rg -n "GUNICORN_BIND.*BACKEND_PORT|export .*GUNICORN_BIND" runlocal.sh`: confirmed the launcher derives and exports the Gunicorn bind setting.
- `env GUNICORN_BIND=0.0.0.0:8100 .venv/bin/python -c 'import runpy; print(runpy.run_path("gunicorn.conf.py")["bind"])'` from `backend/`: passed and returned `0.0.0.0:8100`.
- `git diff --check -- runlocal.sh docs/Log.md`: passed.
- `scripts/self-test` was intentionally not run. Its strongest path invokes `verify.sh`, which runs `ruff --fix` and `ruff format` across the existing unstaged backend work. Running it would modify unrelated work that this task must preserve.
- `shellcheck` is not installed, so Bash syntax checks were used instead.

## Risk And Rollback

- The launcher change preserves the default `0.0.0.0:8000` bind and only changes behavior when `BACKEND_PORT` is overridden.
- Roll back by removing the new plan, preflight script, and log entry, then reverting the `GUNICORN_BIND` default/export in `runlocal.sh`.
