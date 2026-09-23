# Research provider outage and mobile activity

Goal: classify provider unavailability accurately and keep research activity
usable on narrow screens. Provider availability itself remains upstream.

Changes: research route emits retryable provider_unavailable for 502/503;
message renderer explains recovery, including stored 503 errors. Mobile message
margins are responsive, action buttons wrap, and tool output uses native details
with bounded vertical scrolling and wrapping.

Verification: six focused backend tests and three frontend tests passed;
frontend lint, TypeScript and touched-file Ruff passed. Browser accessibility
inspection confirms the page and three configured models are available.
Full self-test returned `verification repo: failed`. A live political-news
request using Nemotron 3.5 Lightning streamed 51,364 bytes but did not reach a
terminal event before the 100-second client timeout. This does not establish
successful provider recovery. Chrome screenshot attachment failed because
DevToolsActivePort was unavailable.

No automatic model substitution was added. Retry uses the selected model;
users can choose a configured alternative. Visual screenshot verification and
the broader tool-planning policy remain open.
