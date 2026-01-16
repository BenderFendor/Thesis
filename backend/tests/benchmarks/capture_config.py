#!/usr/bin/env python3
"""
Configuration Capture Script

Captures current system configuration for performance baseline documentation.

Usage:
    python capture_config.py
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.database import engine

OUTPUT_FILE = (
    "/home/bender/classwork/Thesis/backend/tests/benchmarks/config_snapshot.json"
)


def get_python_packages() -> Dict[str, str]:
    """Get installed Python package versions."""
    result = subprocess.run(
        ["pip", "freeze"],
        capture_output=True,
        text=True,
    )
    packages = {}
    for line in result.stdout.strip().split("\n"):
        if "==" in line:
            name, version = line.split("==")
            packages[name] = version
    return packages


def get_system_info() -> Dict[str, Any]:
    """Get system information."""
    return {
        "platform": os.uname().sysname,
        "release": os.uname().release,
        "version": os.uname().version,
        "cpu_count": os.cpu_count(),
    }


def capture_config() -> Dict[str, Any]:
    """Capture complete configuration snapshot."""
    config = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "app": {
            "title": settings.app_title,
            "version": settings.app_version,
            "enable_vector_store": settings.enable_vector_store,
            "enable_database": settings.enable_database,
            "embedding_batch_size": settings.embedding_batch_size,
            "embedding_max_per_minute": settings.embedding_max_per_minute,
            "frontend_origins": list(settings.frontend_origins),
        },
        "database": {
            "pool_size": 20,
            "max_overflow": 0,
            "url": os.getenv(
                "DATABASE_URL",
                "postgresql+asyncpg://newsuser:newspass@localhost:5432/newsdb",
            )[:50]
            + "...",
        },
        "system": get_system_info(),
        "packages": get_python_packages(),
    }

    if engine:
        config["database"]["pool_status"] = {
            "size": engine.pool.size() if hasattr(engine.pool, "size") else "N/A",
            "checkedout": engine.pool.checkedout()
            if hasattr(engine.pool, "checkedout")
            else "N/A",
        }

    return config


def main():
    print("Capturing configuration...")
    config = capture_config()

    with open(OUTPUT_FILE, "w") as f:
        json.dump(config, f, indent=2)

    print(f"Configuration saved to: {OUTPUT_FILE}")
    print(f"\nSummary:")
    print(f"  App: {config['app']['title']} v{config['app']['version']}")
    print(f"  Database pool: {config['database'].get('pool_status', {})}")
    print(f"  Python packages: {len(config['packages'])}")
    print(
        f"  System: {config['system']['platform']} ({config['system']['cpu_count']} CPUs)"
    )


if __name__ == "__main__":
    main()
