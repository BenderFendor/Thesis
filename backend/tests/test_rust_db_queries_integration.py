"""Run thesis-db SQLx integration queries against a disposable local PostgreSQL server."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _require_postgres_tools() -> None:
    missing = [tool for tool in ("initdb", "pg_ctl", "createdb") if shutil.which(tool) is None]
    if missing:
        pytest.skip(f"PostgreSQL test binaries unavailable: {', '.join(missing)}")


def _free_port() -> int:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


def test_thesis_db_queries_against_disposable_postgres() -> None:
    _require_postgres_tools()
    pg_root = Path(tempfile.mkdtemp(prefix="thesis-db-queries-"))
    data_dir = pg_root / "data"
    port = _free_port()
    subprocess.run(
        ["initdb", "-D", str(data_dir), "-U", "thesis", "--auth=trust"],
        check=True,
        cwd=BACKEND,
        stdout=subprocess.DEVNULL,
    )
    log_path = pg_root / "postgres.log"
    subprocess.run(
        [
            "pg_ctl",
            "-D",
            str(data_dir),
            "-l",
            str(log_path),
            "-o",
            f"-h 127.0.0.1 -p {port} -k {pg_root}",
            "-w",
            "start",
        ],
        check=True,
        cwd=BACKEND,
        stdout=subprocess.DEVNULL,
    )
    try:
        subprocess.run(
            ["createdb", "-h", "127.0.0.1", "-p", str(port), "-U", "thesis", "thesis_test"],
            check=True,
            cwd=BACKEND,
            stdout=subprocess.DEVNULL,
        )
        env = os.environ.copy()
        env["DATABASE_URL"] = f"postgresql://thesis@127.0.0.1:{port}/thesis_test"
        subprocess.run(
            ["cargo", "test", "--locked", "-p", "thesis-db", "--lib"],
            check=True,
            cwd=BACKEND,
            env=env,
            timeout=900,
        )
    finally:
        subprocess.run(
            ["pg_ctl", "-D", str(data_dir), "-m", "fast", "-w", "stop"],
            check=False,
            cwd=BACKEND,
            stdout=subprocess.DEVNULL,
        )
