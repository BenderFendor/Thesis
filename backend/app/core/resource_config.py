"""Dynamic resource configuration based on system capabilities."""

import os
from typing import TypedDict

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False


class ResourceConfig(TypedDict):
    """System resource allocation configuration."""
    cpu_workers: int
    fetch_concurrency: int
    fetch_queue_size: int
    parse_queue_size: int
    persist_queue_size: int
    persist_batch_size: int


def get_system_resources() -> ResourceConfig:
    """
    Dynamically tune pipeline settings based on system RAM and CPU.
    
    Returns optimized configuration for RSS ingestion pipeline based on
    available system resources.
    """
    # Get CPU count
    cpu_cores = os.cpu_count() or 2
    
    # Get RAM (fallback to conservative estimate if psutil unavailable)
    if PSUTIL_AVAILABLE:
        total_ram_gb = psutil.virtual_memory().total / (1024**3)
    else:
        # Conservative fallback: assume 8GB
        total_ram_gb = 8.0
    
    # --- ProcessPoolExecutor Workers (CPU-bound parsing) ---
    # Reserve cores for FastAPI, databases, and OS
    if total_ram_gb <= 8 and cpu_cores > 2:
        # Low RAM: 8GB, 4 cores → 2 workers
        cpu_workers = max(1, cpu_cores // 2)
    elif cpu_cores > 4:
        # High RAM: 32GB, 8 cores → 6 workers (leave 2 for app)
        cpu_workers = max(2, cpu_cores - 2)
    else:
        # Very low resources: 4GB, 2 cores → 1 worker
        cpu_workers = 1
    
    # --- HTTP Fetch Concurrency (Network I/O) ---
    # This is separate from CPU workers - async can handle many more
    if total_ram_gb <= 8:
        fetch_concurrency = 15  # Conservative for laptop
    elif total_ram_gb <= 16:
        fetch_concurrency = 25  # Medium desktop
    else:
        fetch_concurrency = 40  # High-end server
    
    # --- Queue Sizes (Backpressure management) ---
    # Smaller queues on low-RAM systems prevent memory exhaustion
    if total_ram_gb <= 8:
        fetch_queue_size = 30
        parse_queue_size = 50
        persist_queue_size = 100
        persist_batch_size = 100  # Smaller batches
    else:
        fetch_queue_size = 50
        parse_queue_size = 100
        persist_queue_size = 200
        persist_batch_size = 200  # Larger batches for efficiency
    
    return ResourceConfig(
        cpu_workers=cpu_workers,
        fetch_concurrency=fetch_concurrency,
        fetch_queue_size=fetch_queue_size,
        parse_queue_size=parse_queue_size,
        persist_queue_size=persist_queue_size,
        persist_batch_size=persist_batch_size,
    )
