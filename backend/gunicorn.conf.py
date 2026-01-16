"""
Gunicorn configuration for FastAPI production deployment.

Usage:
    gunicorn -c gunicorn.conf.py app.main:app

Or with uv:
    uv run gunicorn -c gunicorn.conf.py app.main:app
"""

import os
import multiprocessing

# Server socket
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")
backlog = 2048

# Worker processes
workers = int(os.getenv("GUNICORN_WORKERS", multiprocessing.cpu_count()))
worker_class = "uvicorn.workers.UvicornWorker"
threads = int(os.getenv("GUNICORN_THREADS", "1"))

# Worker memory limits
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "100"))

# Timeout
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
keepalive = 5

# Process naming
proc_name = "thesis-fastapi"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# Logging
errorlog = "-"
accesslog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Graceful restart
graceful_timeout = 30
max_requests = 1000
max_requests_jitter = 100

# Preload app for better memory usage - DISABLED because startup tasks
# (RSS refresh, schedulers) need to run once per worker, not once globally
preload_app = False


def on_starting(server):
    """Called just before the master process is initialized."""
    pass


def on_reload(server):
    """Called to recycle workers during reload."""
    pass


def worker_int(worker):
    """Called when a worker receives SIGINT or SIGQUIT."""
    pass


def worker_abort(worker):
    """Called when a worker receives SIGABRT."""
    pass
