# Research tool evidence handoff

Goal: preserve retrieved evidence through final synthesis and execute last-turn
tool requests. Fixes are in backend/news_research_agent.py with regression checks
in backend/tests/test_news_research_agent_stream.py.

Verified: 23 focused research tests pass; touched-file Ruff passes. A live local
SSE request for "Compare how different sources cover technology news" completed
with a cited comparison, 329 model deltas and six tool results. The response
explicitly identifies summary-only evidence limitations.

Deployment boundary: the public API reproduced the old missing-evidence answer.
frontend/.env.local now targets http://localhost:8000 so the local page uses the
repaired service. The local Gunicorn worker was reloaded; no remote deployment
was performed. GET http://localhost:3000/search returned 200.

The repository self-test returned `verification repo: failed`.
Rollback: revert the tool-message inclusion and final-pending routing changes.
