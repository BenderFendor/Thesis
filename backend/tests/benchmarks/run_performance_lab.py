#!/usr/bin/env python3
"""
Performance Lab Integration Script

Orchestrates the entire performance profiling workflow:
1. Captures configuration
2. Runs benchmarks
3. Generates reports

Usage:
    python run_performance_lab.py
    python run_performance_lab.py --quick
    python run_performance_lab.py --users 10,50 --duration 60
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
OUTPUT_DIR = Path("/home/bender/classwork/Thesis/backend/tests/benchmarks/results")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def wait_for_server(url: str, timeout: int = 60) -> bool:
    """Wait for the server to become available."""
    print(f"Waiting for server at {url}...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{url}/health", timeout=5)
            if resp.status_code == 200:
                print("Server is ready!")
                return True
        except httpx.RequestError:
            pass
        time.sleep(1)
    print("Server not available within timeout")
    return False


def reset_profiling(url: str) -> None:
    """Reset profiling data."""
    try:
        resp = httpx.post(f"{url}/profiling/reset", timeout=10)
        if resp.status_code == 200:
            print("Profiling reset")
    except Exception as e:
        print(f"Warning: Could not reset profiling: {e}")


def get_profiling_summary(url: str) -> dict:
    """Get profiling summary."""
    try:
        resp = httpx.get(f"{url}/profiling/summary", timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Warning: Could not get profiling summary: {e}")
    return {}


def get_bottlenecks(url: str) -> dict:
    """Get bottleneck analysis."""
    try:
        resp = httpx.get(f"{url}/profiling/bottlenecks", timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Warning: Could not get bottlenecks: {e}")
    return {}


def run_quick_benchmark(url: str) -> dict:
    """Run quick benchmark against key endpoints."""
    results = {}
    endpoints = [
        ("/health", "GET", {}),
        ("/news/page", "GET", {"limit": 10}),
        ("/news/categories", "GET", {}),
    ]

    for path, method, params in endpoints:
        latencies = []
        for _ in range(5):
            try:
                start = time.perf_counter()
                resp = httpx.request(method, f"{url}{path}", params=params, timeout=10)
                latency_ms = (time.perf_counter() - start) * 1000
                if resp.status_code < 500:
                    latencies.append(latency_ms)
            except Exception:
                pass

        if latencies:
            latencies.sort()
            results[path] = {
                "avg_ms": round(sum(latencies) / len(latencies), 2),
                "p50_ms": round(latencies[len(latencies) // 2], 2),
                "p95_ms": round(latencies[int(len(latencies) * 0.95)], 2),
                "samples": len(latencies),
            }

    return results


def run_full_benchmark(url: str, users: list, duration: int) -> dict:
    """Run full benchmark suite."""
    print("\nRunning full benchmark suite...")
    print(f"  Users: {users}")
    print(f"  Duration: {duration}s per test")

    sys.path.insert(0, "/home/bender/classwork/Thesis/backend")
    from tests.benchmarks.benchmarks import run_all_benchmarks

    results = run_all_benchmarks(users, duration)
    return results


def generate_report(
    baseline: dict, after: dict, config: dict, output_path: str
) -> None:
    """Generate markdown performance report."""
    timestamp = datetime.now(timezone.utc).isoformat()

    report = f"""# Performance Optimization Report

**Generated:** {timestamp}
**Environment:** Development

## Executive Summary

| Metric | Baseline | Optimized | Change |
|--------|----------|-----------|--------|
| Avg p95 Latency | TBD ms | TBD ms | TBD% |
| Throughput | TBD RPS | TBD RPS | TBD% |
| Error Rate | TBD% | TBD% | TBD% |

## Configuration

### Database
- Pool Size: {config.get("database", {}).get("pool_size", "N/A")}
- Max Overflow: {config.get("database", {}).get("max_overflow", "N/A")}

### Application
- Embedding Batch Size: {config.get("app", {}).get("embedding_batch_size", "N/A")}
- Vector Store: {config.get("app", {}).get("enable_vector_store", "N/A")}

## Benchmark Results

### Before Optimization

"""

    for endpoint, data in baseline.get("endpoints", {}).items():
        report += f"\n#### {endpoint}\n"
        report += f"_{data.get('description', '')}_  \n"
        for result in data.get("results", []):
            if "error" not in result:
                latency = result.get("latency", {})
                report += f"- {result.get('users', '?')} users: "
                report += f"RPS={result.get('requests_per_second', 0):.1f}, "
                report += f"p95={latency.get('p95_ms', 0):.1f}ms  \n"

    report += """

## Bottleneck Analysis

"""

    bottlenecks = after.get("bottlenecks", [])
    for b in bottlenecks[:10]:
        report += f"- **{b.get('type', 'unknown')}**: {b.get('target', '?')} "
        report += f"(p95: {b.get('p95_ms', b.get('avg_ms', 0)):.1f}ms) - {b.get('severity', '?')}\n"

    report += """

## Recommendations

1. **Priority 1:** [Highest impact optimization]
2. **Priority 2:** [Second priority]
3. **Priority 3:** [Third priority]

## Next Steps

- [ ] Implement priority 1 fix
- [ ] Re-run benchmarks
- [ ] Validate improvement
- [ ] Move to next optimization
"""

    with open(output_path, "w") as f:
        f.write(report)

    print(f"\nReport saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Performance Lab Integration")
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run quick benchmark (5 samples per endpoint)",
    )
    parser.add_argument(
        "--users",
        "-u",
        default="10,50,100",
        help="Comma-separated user counts (default: 10,50,100)",
    )
    parser.add_argument(
        "--duration",
        "-d",
        type=int,
        default=30,
        help="Duration per benchmark in seconds (default: 30)",
    )
    parser.add_argument(
        "--skip-wait",
        action="store_true",
        help="Skip waiting for server",
    )

    args = parser.parse_args()
    user_counts = [int(u) for u in args.users.split(",")]

    print("=" * 60)
    print("PERFORMANCE LAB")
    print("=" * 60)

    if not args.skip_wait and not wait_for_server(BACKEND_URL, timeout=30):
        sys.exit(1)

    print("\n1. Capturing configuration...")
    os.chdir("/home/bender/classwork/Thesis/backend")
    config_result = subprocess.run(
        [sys.executable, "tests/benchmarks/capture_config.py"],
        capture_output=True,
        text=True,
    )

    config = {}
    config_path = (
        "/home/bender/classwork/Thesis/backend/tests/benchmarks/config_snapshot.json"
    )
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)

    print("2. Resetting profiling state...")
    reset_profiling(BACKEND_URL)

    print("\n3. Running baseline benchmarks...")
    if args.quick:
        baseline = run_quick_benchmark(BACKEND_URL)
    else:
        baseline = run_full_benchmark(BACKEND_URL, user_counts, args.duration)

    baseline_path = OUTPUT_DIR / "baseline_results.json"
    with open(baseline_path, "w") as f:
        json.dump(baseline, f, indent=2)
    print(f"   Baseline results saved to: {baseline_path}")

    print("\n4. Analyzing bottlenecks...")
    bottlenecks = get_bottlenecks(BACKEND_URL)
    bottlenecks_path = OUTPUT_DIR / "bottlenecks.json"
    with open(bottlenecks_path, "w") as f:
        json.dump(bottlenecks, f, indent=2)
    print(f"   Bottlenecks saved to: {bottlenecks_path}")

    print("\n5. Generating report...")
    report_path = OUTPUT_DIR / "PERFORMANCE_REPORT.md"
    generate_report(baseline, bottlenecks, config, str(report_path))

    print("\n" + "=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"\nArtifacts:")
    print(f"  - Config: {config_path}")
    print(f"  - Baseline: {baseline_path}")
    print(f"  - Bottlenecks: {bottlenecks_path}")
    print(f"  - Report: {report_path}")


if __name__ == "__main__":
    main()
