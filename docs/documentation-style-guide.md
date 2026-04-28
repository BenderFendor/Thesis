# Documentation Style Guide

## Goal

Documentation should sound like a maintainer explaining the project to someone who needs to run, debug, modify, or trust the code.

Write concrete documentation. Prefer commands, file names, real defaults, examples, and failure modes over broad claims.

This guide treats common AI-writing signs as quality warnings, not proof of authorship. The fix is not to hide AI use; the fix is to make documentation specific, sourced, and useful.

## Required Style

Use:

- plain verbs
- short paragraphs
- concrete nouns
- real command examples
- exact file paths
- exact defaults
- exact error messages when useful
- active voice
- consistent names for the same concept
- headings that match the reader's task

Prefer:

```md
From the repo root, run `./runlocal.sh setup` to install local dependencies.
```

over:

```md
This command provides a seamless development experience.
```

Prefer:

```md
Set `OPEN_ROUTER_API_KEY` in `backend/.env`. The research agent returns provider errors when the key is missing.
```

over:

```md
The API configuration plays a crucial role in ensuring application stability.
```

## Documentation Types

Use the right kind of documentation for the job.

### Tutorial

Use when the reader is learning the project for the first time.

- Show a working path from zero to success.
- Do not explain every option.
- Do not branch into advanced cases.

### How-To Guide

Use when the reader has a specific task.

- Start with the goal.
- Give numbered steps.
- Include expected output or success criteria.
- Include common failure cases when likely.

### Reference

Use when the reader needs exact technical facts.

- List options, defaults, parameters, commands, schemas, and return values.
- Keep it neutral.
- Do not add motivational prose.

### Explanation

Use when the reader needs to understand why the system is shaped a certain way.

- Explain tradeoffs.
- Link to implementation files.
- Keep claims bounded to the actual project.

## README Style

The README should be direct and scannable.

Recommended sections:

~~~md
# Project Name

One short paragraph saying what the project does.

## Status

Current maturity: prototype, active, stable, archived, or another concrete state.

## Features

- Concrete feature
- Concrete feature
- Concrete feature

## Requirements

- Node.js version
- Python version
- System packages
- External services

## Quick Start

From the repo root:

```bash
command here
```

## Configuration

Short table of required environment variables.

## Usage

```bash
command here
```

## Documentation

- Link to deeper repo docs
- Link to the GitHub Wiki

## Development

```bash
test command
lint command
build command
```
~~~

Do not let the README become a dumping ground. If a section needs more than a few paragraphs, move it to `docs/` or the wiki and link to it.

## Wiki Style

Wiki pages should be longer than the README but still task-focused.

Every wiki page should start with:

```md
# Page Title

One or two sentences explaining what this page is for.

## When To Use This Page

- Situation 1
- Situation 2
```

For troubleshooting pages, use this format:

~~~md
## Error message or symptom

What it looks like:

```text
exact error here
```

Why it happens:

- Concrete cause
- Concrete cause

Fix:

```bash
command here
```

Check:

```bash
command here
```
~~~

## Banned AI-Sounding Patterns

Use the Wikipedia-style AI-writing signs as a quality checklist, not as proof that text is AI-generated. The point is to remove generic filler and unverifiable claims.

Avoid these unless the sentence contains a concrete technical claim that needs the phrase:

- "plays a crucial role"
- "serves as a testament"
- "seamless experience"
- "robust solution"
- "cutting-edge"
- "leverages the power of"
- "unlock the potential"
- "delves into"
- "in today's fast-paced world"
- "it is important to note"
- "this highlights"
- "this underscores"
- "not only X but also Y"
- "comprehensive guide" unless it actually covers the full topic
- "various"
- "several"
- "numerous"
- "key considerations" without listing the actual considerations
- "best practices" without naming the specific practice

## Banned Structure Habits

Avoid:

- starting every page with a grand overview
- ending every page with a vague future-looking paragraph
- adding horizontal rules between every section
- bolding random key phrases
- adding emoji in headings
- adding a table when bullets or a short paragraph would be clearer
- changing terms for variety, such as using "plugin", "extension", and "module" for the same thing

## Source And Accuracy Rules

When documentation describes behavior, verify it against the repo.

Use this order:

1. Code
2. Tests
3. Existing docs
4. Issues or commit messages
5. External docs

Do not document hoped-for behavior as real behavior.

Use:

```md
Currently, `scripts/self-test` delegates to `./verify.sh` when it exists.
```

Do not use:

```md
The test system supports flexible verification workflows.
```

## Commands

Every command block should name the working directory.

Good:

~~~md
From the repo root:

```bash
scripts/self-test
```
~~~

Bad:

```md
Install dependencies and start the project.
```

## Links

Use relative links for repo files:

```md
[Testing](docs/agent/testing.md)
```

Use wiki links only inside the wiki.

Do not paste raw URLs unless the URL itself is the thing being documented.

## Before Committing Docs

Check:

- Does the README still match the actual setup?
- Does the wiki duplicate stale README content?
- Are commands tested or copied from working scripts?
- Are file paths real?
- Are terms consistent?
- Are there AI-sounding filler phrases?
- Did this change add words without adding information?

Run:

```bash
git diff --check
```

## Source Basis

- Diataxis: organize docs around tutorials, how-to guides, reference, and explanation.
- Microsoft Writing Style Guide: use short sentences, active voice, imperative mood in procedures, and clear technical English.
- Wikipedia's "Signs of AI writing" advice: use AI-writing signs as indicators, not proof, and do not rely only on AI detectors.
