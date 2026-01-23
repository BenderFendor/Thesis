# Jira Bidirectional Sync

Bidirectional synchronization between `Todo.md` and Jira "Capstone scrum" project.

## Setup

### 1. Create .env file

Copy `.env.example` to `.env` and add your Jira credentials:

```bash
cp .env.example .env
# Edit .env with your credentials
```

Get API token from: https://id.atlassian.com/manage-profile/security/api-tokens

### 2. Configure project

Edit `.jira-config.yml` to match your Jira project:

```yaml
jira:
  project_key: CAP  # Your Jira project key

sync:
  conflict_mode: interactive  # or latest, manual
```

## Usage

### Sync (two-way)

```bash
cd backend
source .venv/bin/activate
python ../scripts/jira_sync.py sync
```

### Preview changes (dry-run)

```bash
python ../scripts/jira_sync.py sync --dry-run
```

### Sync specific section

```bash
python ../scripts/jira_sync.py sync --section "Phase 6"
```

### Other commands

```bash
# Validate configuration
python ../scripts/jira_sync.py validate

# Auto-detect Jira project config
python ../scripts/jira_sync.py detect-config

# Show sync status
python ../scripts/jira_sync.py status

# Pull Jira changes only
python ../scripts/jira_sync.py pull

# Push Todo.md changes only
python ../scripts/jira_sync.py push
```

## How It Works

### Hierarchy Mapping

| Todo.md | Jira |
|---------|-------|
| `## Phase X` | Epic |
| `### Subsection` | Story (if children) or Task |
| `- [ ] Item` | Subtask or Task |
| Indented items | Nested Subtasks |

### Status Mapping

| Todo.md | Jira |
|---------|-------|
| `[ ]` | To Do |
| `[-]` | In Progress |
| `[x]` | Done |

### Priority Mapping

| Todo.md | Jira |
|---------|-------|
| P0 | Highest |
| P1 | High |
| P2 | Medium |
| P3 | Low |

### Jira Keys

Items linked to Jira will have HTML comments:

```markdown
- [ ] Add feature X <!-- JIRA: CAP-123 -->
  - [ ] Subtask A <!-- JIRA: CAP-124 -->
```

## Conflict Resolution

When Todo.md and Jira have conflicting changes, you'll be prompted:

```
⚠️  CONFLICT DETECTED

Item: Add feature X
Jira:  CAP-123

Status:   Todo.md=todo, Jira=In Progress

Options:
  1. Use Todo.md version (push to Jira)
  2. Use Jira version (pull to Todo.md)
  3. Skip (keep both as-is)
  4. Manual merge (open in editor)

Select [1-4]:
```

## Troubleshooting

### Connection Failed

Check your `.env` credentials are correct:

```bash
# Verify Jira URL is accessible
curl $JIRA_URL

# Test connection
python scripts/jira_sync.py validate
```

### Project Not Found

Check your project key in `.jira-config.yml`:

```yaml
jira:
  project_key: CAP  # Must match your Jira project
```

Run `python scripts/jira_sync.py detect-config` to see available projects.

### Parse Errors

Ensure `Todo.md` uses proper markdown:

```markdown
## Section Title
- [ ] Item text
  - [ ] Nested item
```

## File Structure

```
scripts/
├── jira_sync.py          # Main CLI
├── jira/
│   ├── __init__.py
│   ├── types.py          # Data models
│   └── client.py         # Jira API wrapper
├── parsers/
│   ├── __init__.py
│   └── todo_parser.py   # Todo.md parser
├── writers/
│   ├── __init__.py
│   └── todo_writer.py   # Todo.md writer
└── sync/
    ├── __init__.py
    ├── engine.py         # Core sync logic
    └── conflict_resolver.py  # Conflict handling
```

## Development

### Run tests

```bash
cd scripts
pytest tests/ -v
```

### Install dependencies

```bash
cd backend
source .venv/bin/activate
uv pip install jira pyyaml python-frontmatter pytest pytest-cov
```
