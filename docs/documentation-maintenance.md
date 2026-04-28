# Documentation Maintenance

## Purpose

Keep `README.md`, `docs/`, and the GitHub Wiki synced with the repo's real behavior.

Documentation should change when the repo changes in ways that affect users, contributors, maintainers, setup, deployment, debugging, or project behavior.

This workflow follows GitHub's wiki model: the README gives a quick project entry point, while the GitHub Wiki holds longer documentation and can be edited locally through the separate `OWNER/REPO.wiki.git` repository.

## Documentation Surfaces

### README.md

Use `README.md` as the repo front page.

It should answer:

- What does this project do?
- Who is it for?
- What is the fastest way to install and run it?
- What are the core commands?
- Where are the deeper docs?
- What is the current project status?

Keep the README short enough to scan. Move long explanations, reference tables, and troubleshooting detail into `docs/` or the wiki.

### docs/

Use `docs/` for developer, maintainer, and agent-facing documentation that should live inside the repo and be reviewed with code changes.

Good uses:

- contributor setup
- architecture notes for maintainers
- API/reference notes for developers
- local development workflows
- testing workflows
- style guides
- agent operating docs
- decision records

### GitHub Wiki

Use the wiki for longer end-user or maintainer-facing pages.

Good uses:

- Getting Started
- Configuration
- User Workflows
- Architecture overview
- Troubleshooting
- Release Notes
- FAQ

The wiki is a separate Git repository. For `OWNER/REPO`, the wiki remote is:

```bash
https://github.com/OWNER/REPO.wiki.git
```

Editing `docs/` does not update the GitHub Wiki.

## When To Update Docs

Check docs when a change touches:

- install commands
- package manager or lockfiles
- dependency versions
- required system packages
- environment variables
- config files
- CLI flags
- public APIs
- user workflows
- architecture
- data flow
- database schema
- auth behavior
- deployment
- screenshots
- troubleshooting
- errors users may hit
- release notes
- breaking changes

Do not update docs for purely internal refactors unless the refactor changes how users, contributors, agents, or maintainers interact with the project.

## README Sync Rules

Update `README.md` when:

- the project description changes
- setup steps change
- the main command changes
- the default workflow changes
- dependencies or prerequisites change
- project status changes
- links to docs/wiki pages change
- the README promises behavior that no longer matches the code

Do not copy the whole wiki into the README. Link to deeper docs:

```md
For local development, see [Development workflow](docs/agent/workflows.md).
For long-form user guides, see the GitHub Wiki.
```

## Wiki Sync Rules

Update the wiki when:

- a long guide is stale
- troubleshooting changed
- architecture changed enough that an end user or maintainer would misunderstand the system
- setup or workflow needs more explanation than belongs in the README
- release notes need a user-facing entry

Do not rewrite the whole wiki unless asked. Make the smallest accurate change tied to the repo diff.

Suggested wiki page map:

- `Home.md`: overview, quick links, current status
- `Getting-Started.md`: install, setup, first run
- `Configuration.md`: environment variables and defaults
- `User-Workflows.md`: how to use the app
- `Architecture.md`: high-level system map
- `Troubleshooting.md`: known symptoms and fixes
- `Release-Notes.md`: user-visible changes by date
- `_Sidebar.md`: wiki navigation

## Local Wiki Workflow

From the repo root, inspect the origin:

```bash
git config --get remote.origin.url
```

Clone the wiki next to the repo if it is not already present:

```bash
cd ..
git clone https://github.com/OWNER/REPO.wiki.git REPO.wiki
cd REPO.wiki
```

Sync before editing:

```bash
git pull --ff-only
git status --short
```

Edit only the relevant Markdown pages.

Review:

```bash
git diff --check
git diff
```

Commit and push:

```bash
git add .
git commit -m "docs: update wiki for <changed area>"
git push origin HEAD
```

## Final Response Format

Use one of these:

```txt
Docs updated:
- README.md: updated quick start command.
- docs/documentation-maintenance.md: added wiki workflow.
- Wiki: Troubleshooting.md updated with the new API key error.
- Wiki commit: <hash>
```

```txt
Docs checked, no update needed:
- Reason: change only renamed internal helpers and did not affect setup, usage, config, API, architecture, troubleshooting, or user workflows.
```

```txt
Docs update needed but not pushed:
- Reason: wiki repo was not initialized or credentials lacked write access.
- Needed page: Troubleshooting.md
- Needed change: document the new DATABASE_URL validation error.
```

## Prompt For Codex

Use this after a feature or refactor:

```txt
Check documentation health for the current repo changes.

Steps:
1. Read AGENTS.md.
2. Read docs/documentation-maintenance.md.
3. Read docs/documentation-style-guide.md.
4. Inspect the current git diff and recent commits.
5. Decide whether README.md, files in docs/, or the GitHub Wiki need updates.
6. Update only documentation surfaces that are actually stale.
7. Keep README.md short. Move long details to docs/ or the wiki.
8. Apply the documentation style guide: concrete claims, exact commands, exact file paths, no AI-sounding filler, no vague robust/seamless/crucial prose, and no fake summary endings.
9. If the wiki needs an update, clone or open OWNER/REPO.wiki.git, pull latest, edit relevant Markdown pages, run git diff --check, commit, and push.
10. Run available markdown/docs checks. If none exist, run git diff --check.

Final response must include one of:
- Docs updated: ...
- Docs checked, no update needed: ...
- Docs update needed but not pushed: ...
```

## Source Basis

- GitHub Docs: wikis can host repository documentation and can hold long-form content beyond the README.
- GitHub Docs: wiki pages can be edited locally by cloning `https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.wiki.git`; pushed changes to the default branch become live.
- Diataxis: split documentation by user need: tutorials, how-to guides, reference, and explanation.
- Microsoft Writing Style Guide: prefer short, simple sentences, active voice, and clear technical language.
