# Research harness probe

Goal: exercise the built-in questions through the real research SSE endpoint
and verify tool selection, article evidence, citations, and graceful gaps.

Command: `backend/.venv/bin/python backend/scripts/probe_research_harness.py`.

Results after the semantic archive fallback: climate change completed in 14.22
seconds with a sourced answer; technology returned cited comparisons in one run
and timed out in another while fetching several publishers; political news
returned current dated archive articles. The probe also exposed over-eager
parallel tool requests, which remain a follow-up steering improvement.

Focused backend tests, frontend lint, TypeScript, and the research frontend
tests pass. The full repository verifier remains red. Browser screenshot
verification is unavailable because Chrome DevTools could not connect.
