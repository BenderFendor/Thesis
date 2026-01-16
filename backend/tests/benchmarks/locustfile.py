"""
Locust load test file for comprehensive performance testing.

Usage:
    locust -f locustfile.py --host=http://localhost:8000
    locust -f locustfile.py --host=http://localhost:8000 --users=100 --spawn-rate=10 --run-time=60s --headless --csv=results
"""

from __future__ import annotations

import random
import time
from locust import HttpUser, task, between, events
from locust.runners import MasterRunner

from app.core.logging import get_logger

logger = get_logger("locust")


class NewsApiUser(HttpUser):
    """User simulating news API usage patterns."""

    wait_time = between(1, 5)
    weight = 3

    def on_start(self):
        """Called when user starts."""
        self.categories = [
            "technology",
            "business",
            "science",
            "health",
            "entertainment",
            "sports",
        ]
        self.sources = ["bbc-news", "cnn", "reuters", "techcrunch", "the-verge"]

    @task(5)
    def browse_news_page(self):
        """Browse paginated news feed - most common action."""
        with self.client.request(
            "GET",
            "/news/page",
            params={"limit": random.choice([20, 50, 100])},
            name="/news/page",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(3)
    def browse_cached_news(self):
        """Browse cached news page."""
        offset = random.randint(0, 500)
        with self.client.request(
            "GET",
            "/news/page/cached",
            params={"limit": 50, "offset": offset},
            name="/news/page/cached",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(2)
    def get_recent_news(self):
        """Get recent news - lightweight endpoint."""
        with self.client.request(
            "GET",
            "/news/recent",
            params={"limit": 50},
            name="/news/recent",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(2)
    def search_semantic(self):
        """Perform semantic search."""
        queries = [
            "artificial intelligence",
            "climate change",
            "economic policy",
            "sports championship",
            "medical research",
            "technology startup",
        ]
        with self.client.request(
            "GET",
            "/api/search/semantic",
            params={"query": random.choice(queries), "limit": 10},
            name="/api/search/semantic",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 503:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(1)
    def filter_by_category(self):
        """Filter news by category."""
        with self.client.request(
            "GET",
            f"/news/category/{random.choice(self.categories)}",
            name="/news/category/:category",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(1)
    def get_sources(self):
        """Get list of sources."""
        with self.client.request(
            "GET",
            "/news/sources",
            name="/news/sources",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")

    @task(1)
    def get_categories(self):
        """Get list of categories."""
        with self.client.request(
            "GET",
            "/news/categories",
            name="/news/categories",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")


class NewsStreamUser(HttpUser):
    """User simulating WebSocket streaming usage."""

    wait_time = between(5, 15)
    weight = 1

    def on_start(self):
        """Called when user starts."""
        self.categories = ["technology", "business", "science"]

    @task(1)
    def stream_news(self):
        """Stream news via SSE."""
        category = random.choice(self.categories)
        with self.client.request(
            "GET",
            f"/news/stream?category={category}",
            name="/news/stream",
            catch_response=True,
            stream=True,
        ) as response:
            if response.status_code == 200:
                content = response.content
                if content:
                    response.success()
                else:
                    response.failure("Empty response")
            else:
                response.failure(f"Status {response.status_code}")


class BenchmarkUser(HttpUser):
    """User for benchmark-focused testing - minimal wait time."""

    wait_time = between(0.1, 0.5)
    weight = 1

    @task(10)
    def health_check(self):
        """Health check - very fast endpoint."""
        with self.client.request(
            "GET",
            "/health",
            name="/health",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}")


@events.init.add_listener
def on_locust_init(environment, **kwargs):
    """Called when locust is initialized."""
    if isinstance(environment.runner, MasterRunner):
        logger.info("Master node initialized")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Called when test stops."""
    logger.info("Test completed")


@events.quitting.add_listener
def on_quitting(environment, **kwargs):
    """Called when test is quitting."""
    logger.info("Test quitting")
