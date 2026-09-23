# Research history polish

Goal: make the research drawer readable beside the shared navigation.

Implemented: one 18rem drawer width bounded by its parent; simplified header,
compact conversation rows, touch-visible actions, and readable error previews.
Untitled research names are replaced with the first question on message updates.
Existing stored titles are not migrated until the conversation updates.

Checks: four research state tests passed. Frontend lint and TypeScript were run;
the repository self-test was invoked separately. The in-app browser confirms
the page loads, but its history was collapsed, so expanded visual verification
remains open. Provider recovery remains outside this sidebar change.

Rollback: revert the sidebar presentation and title-update changes.
