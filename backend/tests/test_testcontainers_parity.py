from __future__ import annotations

import time

import docker
import psycopg2
import pytest
import requests

pytest.importorskip("testcontainers")
from testcontainers.core.container import DockerContainer
from testcontainers.postgres import PostgresContainer

pytestmark = pytest.mark.slow


def _require_docker() -> None:
    try:
        docker.from_env().ping()
    except Exception as exc:
        pytest.skip(f"Docker daemon is not available: {exc}")


@pytest.fixture(scope="session")
def postgres_container() -> PostgresContainer:
    _require_docker()
    with PostgresContainer("postgres:16-alpine") as container:
        yield container


@pytest.fixture(scope="session")
def chroma_container() -> str:
    _require_docker()
    with DockerContainer("chromadb/chroma:0.5.23").with_exposed_ports(
        8000
    ) as container:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(8000)
        base_url = f"http://{host}:{port}"

        deadline = time.time() + 45
        while time.time() < deadline:
            for path in ("/api/v1/heartbeat", "/api/v2/heartbeat", "/"):
                try:
                    response = requests.get(f"{base_url}{path}", timeout=2)
                    if response.status_code < 500:
                        return base_url
                except requests.RequestException:
                    continue
            time.sleep(1)

        raise RuntimeError("Chroma container did not become healthy before timeout")


def test_postgres_container_accepts_queries(
    postgres_container: PostgresContainer,
) -> None:
    dsn = postgres_container.get_connection_url()
    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            row = cur.fetchone()
    assert row == (1,)


def test_chroma_container_responds(chroma_container: str) -> None:
    for path in ("/api/v1/heartbeat", "/api/v2/heartbeat", "/"):
        try:
            response = requests.get(f"{chroma_container}{path}", timeout=2)
            if response.status_code < 500:
                assert True
                return
        except requests.RequestException:
            continue

    pytest.fail("No healthy Chroma endpoint responded")


def test_postgres_and_chroma_are_available(
    postgres_container: PostgresContainer,
    chroma_container: str,
) -> None:
    assert postgres_container.get_connection_url()
    assert chroma_container.startswith("http://")
