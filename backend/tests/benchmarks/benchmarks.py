#!/usr/bin/env python3
"""
Performance Benchmark Suite

Load testing scripts for profiling FastAPI backend performance.
Supports wrk2 for consistent latency measurements and locust for complex scenarios.

Usage:
    python benchmarks.py --endpoint /news/page --users 10 --duration 30 --warmup 10
    python benchmarks.py --endpoint /api/search/semantic --users 50 --duration 60
    python benchmarks.py --all --users 10,50,100 --duration 30
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import httpx

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
OUTPUT_DIR = Path("/home/bender/classwork/Thesis/backend/tests/benchmarks/results")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class EndpointCategory(Enum):
    HTTP_API = "http_api"
    WEBSOCKET = "websocket"
    BACKGROUND_TASK = "background_task"


@dataclass
class Endpoint:
    path: str
    method: str
    category: EndpointCategory
    description: str
    payload: Optional[Dict[str, Any]] = None
    headers: Dict[str, str] = field(default_factory=dict)


ENDPOINTS = [
    Endpoint(
        path="/news/page",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="Paginated news feed",
        payload={"limit": 50, "sort_order": "desc"},
    ),
    Endpoint(
        path="/news/page/cached",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="Cached paginated news feed",
        payload={"limit": 50, "offset": 0},
    ),
    Endpoint(
        path="/news/recent",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="Recent articles (lightweight)",
        payload={"limit": 50},
    ),
    Endpoint(
        path="/api/search/semantic",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="Semantic search endpoint",
        payload={"query": "technology", "limit": 10},
    ),
    Endpoint(
        path="/news/categories",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="List categories",
    ),
    Endpoint(
        path="/news/sources",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="List sources",
    ),
    Endpoint(
        path="/health",
        method="GET",
        category=EndpointCategory.HTTP_API,
        description="Health check",
    ),
]


@dataclass
class BenchmarkResult:
    endpoint: str
    users: int
    duration_seconds: int
    completed_requests: int
    failed_requests: int
    requests_per_second: float
    avg_latency_ms: float
    min_latency_ms: float
    max_latency_ms: float
    p50_ms: float
    p75_ms: float
    p95_ms: float
    p99_ms: float
    timestamp: str
    error_message: Optional[str] = None


def wait_for_server(url: str, timeout: int = 60) -> bool:
    """Wait for the server to become available."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{url}/health", timeout=5)
            if resp.status_code == 200:
                return True
        except httpx.RequestError:
            pass
        time.sleep(1)
    return False


async def run_http_benchmark_async(
    endpoint: Endpoint,
    users: int,
    duration: int,
    warmup: int = 5,
) -> BenchmarkResult:
    """Run HTTP benchmark using async HTTP client."""

    client = httpx.AsyncClient(base_url=BACKEND_URL, timeout=30.0)

    async def make_request() -> Tuple[float, bool, int]:
        start = time.perf_counter()
        try:
            resp = await client.request(
                endpoint.method,
                endpoint.path,
                params=endpoint.payload,
                headers=endpoint.headers,
            )
            duration_ms = (time.perf_counter() - start) * 1000
            return duration_ms, resp.status_code < 500, resp.status_code
        except Exception as e:
            duration_ms = (time.perf_counter() - start) * 1000
            return duration_ms, False, 500

    latencies: List[float] = []
    success_count = 0
    error_count = 0

    async def worker():
        nonlocal success_count, error_count
        while True:
            if time.time() - benchmark_start > duration:
                break
            latency, success, status = await make_request()
            latencies.append(latency)
            if success:
                success_count += 1
            else:
                error_count += 1

    benchmark_start = time.time()

    tasks = [worker() for _ in range(users)]
    await asyncio.gather(*tasks)

    await client.aclose()

    total_time = time.time() - benchmark_start
    total_requests = len(latencies)

    latencies.sort()

    if total_requests == 0:
        return BenchmarkResult(
            endpoint=endpoint.path,
            users=users,
            duration_seconds=duration,
            completed_requests=0,
            failed_requests=0,
            requests_per_second=0,
            avg_latency_ms=0,
            min_latency_ms=0,
            max_latency_ms=0,
            p50_ms=0,
            p75_ms=0,
            p95_ms=0,
            p99_ms=0,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    p50_idx = int(total_requests * 0.50)
    p75_idx = int(total_requests * 0.75)
    p95_idx = int(total_requests * 0.95)
    p99_idx = int(total_requests * 0.99)

    return BenchmarkResult(
        endpoint=endpoint.path,
        users=users,
        duration_seconds=duration,
        completed_requests=success_count,
        failed_requests=error_count,
        requests_per_second=total_requests / total_time,
        avg_latency_ms=statistics.mean(latencies),
        min_latency_ms=min(latencies),
        max_latency_ms=max(latencies),
        p50_ms=latencies[p50_idx],
        p75_ms=latencies[p75_idx],
        p95_ms=latencies[p95_idx],
        p99_ms=latencies[p99_idx],
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def run_http_benchmark(
    endpoint: Endpoint,
    users: int,
    duration: int,
    warmup: int = 5,
) -> BenchmarkResult:
    """Synchronous wrapper for HTTP benchmark."""
    return asyncio.run(run_http_benchmark_async(endpoint, users, duration, warmup))


def run_wrk2_benchmark(
    endpoint: str,
    users: int,
    duration: int,
    rate: Optional[int] = None,
) -> Dict[str, Any]:
    """Run wrk2 benchmark if available."""
    try:
        cmd = [
            "wrk2",
            "-t4",
            f"-c{users}",
            f"-d{duration}s",
            "-s",
            "/home/bender/classwork/Thesis/backend/tests/benchmarks/lua_scripts/latency.lua",
            f"{BACKEND_URL}{endpoint}",
        ]
        if rate:
            cmd.insert(2, f"-R{rate}")

        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=duration + 30
        )
        return {"success": True, "output": result.stdout, "error": result.stderr}
    except FileNotFoundError:
        return {"success": False, "error": "wrk2 not found"}


def run_locust_benchmark(
    endpoint: str,
    users: int,
    duration: int,
    spawn_rate: int = 10,
) -> Dict[str, Any]:
    """Run locust benchmark if available."""
    try:
        cmd = [
            "locust",
            "-f",
            "/home/bender/classwork/Thesis/backend/tests/benchmarks/locustfile.py",
            "--host",
            BACKEND_URL,
            "--users",
            str(users),
            "--spawn-rate",
            str(spawn_rate),
            "--run-time",
            f"{duration}s",
            "--headless",
            "--csv",
            str(OUTPUT_DIR / "locust_results"),
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=duration + 60
        )
        return {"success": True, "output": result.stdout, "error": result.stderr}
    except FileNotFoundError:
        return {"success": False, "error": "locust not found"}


def run_all_benchmarks(
    user_counts: List[int],
    duration: int,
    warmup: int = 5,
) -> Dict[str, Any]:
    """Run benchmarks for all endpoints with multiple user counts."""
    results = {
        "metadata": {
            "backend_url": BACKEND_URL,
            "user_counts": user_counts,
            "duration_seconds": duration,
            "warmup_seconds": warmup,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        "endpoints": {},
    }

    for endpoint in ENDPOINTS:
        print(f"\n{'=' * 60}")
        print(f"Benchmarking: {endpoint.path} ({endpoint.description})")
        print(f"{'=' * 60}")

        endpoint_results = []

        for users in user_counts:
            print(f"\n  Users: {users}, Duration: {duration}s (warmup: {warmup}s)")

            try:
                result = run_http_benchmark(endpoint, users, duration, warmup)
                endpoint_results.append(
                    {
                        "users": users,
                        "completed_requests": result.completed_requests,
                        "failed_requests": result.failed_requests,
                        "requests_per_second": round(result.requests_per_second, 2),
                        "latency": {
                            "avg_ms": round(result.avg_latency_ms, 2),
                            "min_ms": round(result.min_latency_ms, 2),
                            "max_ms": round(result.max_latency_ms, 2),
                            "p50_ms": round(result.p50_ms, 2),
                            "p75_ms": round(result.p75_ms, 2),
                            "p95_ms": round(result.p95_ms, 2),
                            "p99_ms": round(result.p99_ms, 2),
                        },
                        "timestamp": result.timestamp,
                    }
                )

                print(f"    RPS: {result.requests_per_second:.1f}")
                print(
                    f"    Latency (p50/p95/p99): {result.p50_ms:.1f}/{result.p95_ms:.1f}/{result.p99_ms:.1f}ms"
                )
                print(
                    f"    Success: {result.completed_requests}, Errors: {result.failed_requests}"
                )

            except Exception as e:
                print(f"    ERROR: {e}")
                endpoint_results.append(
                    {
                        "users": users,
                        "error": str(e),
                    }
                )

        results["endpoints"][endpoint.path] = {
            "description": endpoint.description,
            "category": endpoint.category.value,
            "results": endpoint_results,
        }

    return results


def save_results(results: Dict[str, Any], filename: str) -> Path:
    """Save benchmark results to JSON file."""
    filepath = OUTPUT_DIR / filename
    with open(filepath, "w") as f:
        json.dump(results, f, indent=2)
    return filepath


def print_summary(results: Dict[str, Any]) -> None:
    """Print a summary of benchmark results."""
    print(f"\n{'=' * 60}")
    print("BENCHMARK SUMMARY")
    print(f"{'=' * 60}")

    for endpoint_path, endpoint_data in results.get("endpoints", {}).items():
        print(f"\n{endpoint_path} ({endpoint_data['description']})")

        for run in endpoint_data.get("results", []):
            if "error" in run:
                print(f"  Users {run['users']}: ERROR - {run['error']}")
            else:
                latency = run.get("latency", {})
                rps = run.get("requests_per_second", 0)
                print(
                    f"  Users {run['users']}: RPS={rps:.1f}, "
                    f"p50={latency.get('p50_ms', 0):.1f}ms, "
                    f"p95={latency.get('p95_ms', 0):.1f}ms, "
                    f"p99={latency.get('p99_ms', 0):.1f}ms"
                )


def main():
    parser = argparse.ArgumentParser(description="Performance Benchmark Suite")
    parser.add_argument(
        "--endpoint",
        "-e",
        help="Specific endpoint to benchmark",
    )
    parser.add_argument(
        "--users",
        "-u",
        default="10,50,100",
        help="Comma-separated list of user counts (default: 10,50,100)",
    )
    parser.add_argument(
        "--duration",
        "-d",
        type=int,
        default=30,
        help="Duration per benchmark in seconds (default: 30)",
    )
    parser.add_argument(
        "--warmup",
        "-w",
        type=int,
        default=5,
        help="Warmup duration in seconds (default: 5)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all benchmarks",
    )
    parser.add_argument(
        "--output",
        default="benchmark_results.json",
        help="Output filename",
    )

    args = parser.parse_args()

    user_counts = [int(u) for u in args.users.split(",")]

    print(f"Backend URL: {BACKEND_URL}")
    print(f"User counts: {user_counts}")
    print(f"Duration: {args.duration}s (warmup: {args.warmup}s)")

    if not wait_for_server(BACKEND_URL, timeout=30):
        print("ERROR: Server not available. Exiting.")
        sys.exit(1)

    if args.all:
        results = run_all_benchmarks(user_counts, args.duration, args.warmup)
    elif args.endpoint:
        endpoint = next((e for e in ENDPOINTS if e.path == args.endpoint), None)
        if not endpoint:
            print(f"ERROR: Unknown endpoint: {args.endpoint}")
            print(f"Available endpoints: {[e.path for e in ENDPOINTS]}")
            sys.exit(1)

        all_results = []
        for users in user_counts:
            print(f"\nBenchmarking {endpoint.path} with {users} users...")
            result = run_http_benchmark(endpoint, users, args.duration, args.warmup)
            all_results.append(result)

        results = {
            "metadata": {
                "backend_url": BACKEND_URL,
                "user_counts": user_counts,
                "duration_seconds": args.duration,
            },
            "endpoints": {
                endpoint.path: {
                    "description": endpoint.description,
                    "results": all_results,
                }
            },
        }
    else:
        parser.print_help()
        sys.exit(1)

    filepath = save_results(results, args.output)
    print(f"\nResults saved to: {filepath}")
    print_summary(results)


if __name__ == "__main__":
    main()
