# Sequential tool steering

Goal: stop the agent from issuing parallel searches that conflict with the
research policy and waste model turns.

Implementation: `_preferred_tool_call` in `backend/news_research_agent.py`
selects one call for the current phase. The order is internal search, required
internal article fetches, then external search. Calls emitted alongside the
preferred call receive a deferred result explaining that research tools run one
at a time.

Verification: the new regression test proves an internal and external search
batch executes only the internal call. The focused stream suite passes 19 tests.
A live technology comparison completed in 11.74 seconds with a cited answer.
Touched-file Ruff and `git diff --check` pass.

The model may still choose several external tools across later turns; that is
allowed after internal evidence is exhausted. Full repository verification
remains a separate failing gate.
