"""
Job-based refresh management.

Provides endpoints for starting background refresh jobs and streaming their progress.
This separates the "status/progress" stream from the "data" endpoints.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.logging import get_logger
from app.models.news import NewsArticle
from app.services.cache import news_cache
from app.services.rss_ingestion import refresh_news_cache

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = get_logger("jobs")

# In-memory job store
_active_jobs: Dict[str, Dict[str, Any]] = {}
_job_queues: Dict[str, asyncio.Queue] = {}


class JobStartResponse(BaseModel):
    """Response when starting a new job."""
    job_id: str
    status: str
    stream_url: str


class JobStatus(BaseModel):
    """Current status of a job."""
    job_id: str
    status: str
    started_at: str
    progress: Dict[str, Any]
    error: Optional[str] = None


@router.post("/refresh", response_model=JobStartResponse)
async def start_refresh_job() -> JobStartResponse:
    """
    Start a background refresh job.
    
    Returns a job ID that can be used to stream progress via GET /jobs/{job_id}/stream.
    This separates job initiation from progress streaming for better SSE handling.
    """
    # Check if refresh is already in progress
    if news_cache.update_in_progress:
        # Find existing job
        for job_id, job in _active_jobs.items():
            if job.get("status") == "running":
                return JobStartResponse(
                    job_id=job_id,
                    status="already_running",
                    stream_url=f"/api/jobs/{job_id}/stream"
                )
    
    # Create new job
    job_id = str(uuid.uuid4())[:8]  # Short ID for readability
    job_queue: asyncio.Queue = asyncio.Queue()
    
    _active_jobs[job_id] = {
        "status": "starting",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "progress": {
            "sources_completed": 0,
            "total_sources": 0,
            "articles_fetched": 0,
        },
        "error": None,
    }
    _job_queues[job_id] = job_queue
    
    # Define progress callback that puts events into the queue
    def progress_callback(articles: list[NewsArticle], source_stat: Dict[str, Any]) -> None:
        """Send progress events to the job queue."""
        event = {
            "type": "source_complete",
            "source": source_stat.get("name"),
            "article_count": len(articles),
            "source_stat": source_stat,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            job_queue.put_nowait(event)
        except Exception as e:
            logger.warning("Failed to queue progress event: %s", e)
        
        # Update job progress
        job = _active_jobs.get(job_id)
        if job:
            job["progress"]["sources_completed"] += 1
            job["progress"]["articles_fetched"] += len(articles)
    
    # Start refresh in background task
    async def run_refresh():
        try:
            _active_jobs[job_id]["status"] = "running"
            
            # Run the blocking refresh in a thread
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: refresh_news_cache(source_progress_callback=progress_callback)
            )
            
            # Send completion event
            complete_event = {
                "type": "complete",
                "total_articles": len(news_cache.get_articles()),
                "source_stats": news_cache.get_source_stats(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await job_queue.put(complete_event)
            _active_jobs[job_id]["status"] = "complete"
            
        except Exception as e:
            logger.error("Refresh job %s failed: %s", job_id, e)
            error_event = {
                "type": "error",
                "message": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await job_queue.put(error_event)
            _active_jobs[job_id]["status"] = "error"
            _active_jobs[job_id]["error"] = str(e)
    
    asyncio.create_task(run_refresh())
    
    logger.info("Started refresh job: %s", job_id)
    
    return JobStartResponse(
        job_id=job_id,
        status="started",
        stream_url=f"/api/jobs/{job_id}/stream"
    )


@router.get("/{job_id}/stream")
async def stream_job_progress(job_id: str) -> StreamingResponse:
    """
    Stream progress events for a specific job via SSE.
    
    Events follow SSE spec with proper id, retry, and data fields.
    Client can resume with Last-Event-ID header.
    """
    if job_id not in _active_jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    job_queue = _job_queues.get(job_id)
    if not job_queue:
        raise HTTPException(status_code=404, detail=f"Job {job_id} queue not found")
    
    event_id = 0
    
    async def event_generator():
        nonlocal event_id
        
        # Send initial status
        job = _active_jobs.get(job_id, {})
        initial_event = {
            "status": job.get("status", "unknown"),
            "started_at": job.get("started_at"),
            "progress": job.get("progress", {}),
        }
        event_id += 1
        yield f"id: {event_id}\nretry: 3000\ndata: {json.dumps(initial_event)}\n\n"
        
        # Stream progress events
        try:
            while True:
                try:
                    # Wait for events with timeout
                    event = await asyncio.wait_for(job_queue.get(), timeout=30.0)
                    
                    event_id += 1
                    yield f"id: {event_id}\ndata: {json.dumps(event)}\n\n"
                    
                    # Check if job is complete
                    if event.get("type") in ("complete", "error"):
                        break
                        
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield f": keepalive\n\n"
                    
                    # Check if job is still running
                    job = _active_jobs.get(job_id, {})
                    if job.get("status") in ("complete", "error"):
                        break
                        
        except asyncio.CancelledError:
            logger.info("Job %s stream cancelled", job_id)
            raise
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Job-ID": job_id,
        }
    )


@router.get("/{job_id}/status", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    """Get current status of a job without streaming."""
    if job_id not in _active_jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    job = _active_jobs[job_id]
    return JobStatus(
        job_id=job_id,
        status=job.get("status", "unknown"),
        started_at=job.get("started_at", ""),
        progress=job.get("progress", {}),
        error=job.get("error"),
    )
