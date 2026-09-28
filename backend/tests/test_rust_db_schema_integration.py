"""Exercise read-only FastAPI schema readiness and session rollback on disposable PostgreSQL."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

import pytest
from mako.template import Template

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def test_alembic_runtime_and_revision_authoring_are_disabled() -> None:
    with pytest.raises(RuntimeError, match="Alembic runtime migrations are disabled"):
        exec(compile((BACKEND / "alembic" / "env.py").read_text(), "alembic/env.py", "exec"))

    template = Template(filename=str(BACKEND / "alembic" / "script.py.mako"))
    with pytest.raises(RuntimeError, match="revision generation is disabled"):
        template.render()


def _free_port() -> int:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


def test_init_db_is_read_only_and_get_db_rolls_back_on_failure() -> None:
    missing = [tool for tool in ("initdb", "pg_ctl") if shutil.which(tool) is None]
    if missing:
        pytest.skip(f"PostgreSQL test binaries unavailable: {', '.join(missing)}")

    with tempfile.TemporaryDirectory(prefix="thesis-db-schema-") as temporary_root:
        pg_root = Path(temporary_root)
        data_dir = pg_root / "data"
        port = _free_port()
        subprocess.run(
            ["initdb", "-D", str(data_dir), "-U", "thesis", "--auth=trust"],
            check=True,
            cwd=BACKEND,
            stdout=subprocess.DEVNULL,
        )
        subprocess.run(
            [
                "pg_ctl",
                "-D",
                str(data_dir),
                "-l",
                str(pg_root / "postgres.log"),
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
            database_url = f"postgresql+asyncpg://thesis@127.0.0.1:{port}/postgres"
            program = textwrap.dedent(
                """
                import asyncio
                import os

                from sqlalchemy import text
                from sqlalchemy.exc import SQLAlchemyError
                from sqlalchemy.ext.asyncio import create_async_engine

                import app.database as database

                async def main():
                    engine = create_async_engine(os.environ["DATABASE_URL"])
                    database._engine = engine
                    try:
                        try:
                            await database.init_db()
                        except SQLAlchemyError:
                            pass
                        else:
                            raise AssertionError("init_db accepted a schema without an authority marker")

                        async with engine.connect() as connection:
                            before = await connection.scalar(
                                text("SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n "
                                     "ON n.oid = c.relnamespace WHERE n.nspname = 'public' "
                                     "AND c.relkind IN ('r', 'p', 'v', 'm', 'S')")
                            )
                        assert before == 0, f"init_db created public objects: {before}"

                        async with engine.begin() as connection:
                            await connection.execute(text(
                                "CREATE TABLE public.thesis_schema_authority ("
                                "singleton BOOLEAN PRIMARY KEY, schema_authority TEXT NOT NULL, "
                                "alembic_handoff_revision TEXT NOT NULL)"
                            ))
                            await connection.execute(text(
                                "INSERT INTO public.thesis_schema_authority "
                                "VALUES (TRUE, 'sqlx', '20260722_0006')"
                            ))
                            await connection.execute(text(
                                "CREATE TABLE public.rollback_probe (id INTEGER PRIMARY KEY)"
                            ))

                        async with engine.connect() as connection:
                            before = await connection.scalar(
                                text("SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n "
                                     "ON n.oid = c.relnamespace WHERE n.nspname = 'public' "
                                     "AND c.relkind IN ('r', 'p', 'v', 'm', 'S')")
                            )
                        await database.init_db()
                        async with engine.connect() as connection:
                            after = await connection.scalar(
                                text("SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n "
                                     "ON n.oid = c.relnamespace WHERE n.nspname = 'public' "
                                     "AND c.relkind IN ('r', 'p', 'v', 'm', 'S')")
                            )
                        assert after == before, f"init_db changed public schema objects: {before} -> {after}"

                        dependency = database.get_db()
                        session = await anext(dependency)
                        await session.execute(text("INSERT INTO public.rollback_probe VALUES (1)"))
                        try:
                            await dependency.athrow(RuntimeError("rollback probe"))
                        except RuntimeError as error:
                            assert str(error) == "rollback probe"
                        else:
                            raise AssertionError("get_db swallowed an endpoint failure")

                        async with engine.connect() as connection:
                            rows = await connection.scalar(text("SELECT COUNT(*) FROM public.rollback_probe"))
                        assert rows == 0, f"get_db committed a failed request: {rows} rows"
                    finally:
                        await engine.dispose()

                asyncio.run(main())
                """
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "DATABASE_URL": database_url,
                    "ENABLE_DATABASE": "1",
                    "PYTHON_DOTENV_DISABLED": "1",
                    "PYTHONPATH": str(BACKEND),
                }
            )
            subprocess.run(
                [sys.executable, "-c", program],
                check=True,
                cwd=BACKEND,
                env=environment,
                timeout=90,
                capture_output=True,
                text=True,
            )
        finally:
            subprocess.run(
                ["pg_ctl", "-D", str(data_dir), "-m", "fast", "-w", "stop"],
                check=False,
                cwd=BACKEND,
                stdout=subprocess.DEVNULL,
            )
