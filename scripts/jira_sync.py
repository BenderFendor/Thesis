#!/usr/bin/env python3
"""
Main CLI for bidirectional Todo.md <-> Jira synchronization.
"""

import argparse
import sys
import os
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.todo_parsers.simple_parser import SimpleTodoParser
from scripts.jira_integration.client import JiraConnector
from scripts.todo_writers.todo_writer import TodoWriter
from scripts.sync.engine import SyncEngine
from scripts.sync.conflict_resolver import ConflictResolver
from scripts.jira_integration.types import TodoStatus


def load_config(config_path: str = None) -> dict:
    """Load configuration from YAML file"""
    import yaml

    script_dir = Path(__file__).parent.parent.resolve()
    config_path_str = (
        config_path if config_path else str(script_dir / ".jira-config.yml")
    )
    if not os.path.exists(config_path_str):
        print(f"Error: Config file not found: {config_path_str}")
        sys.exit(1)

    with open(config_path_str, "r") as f:
        config = yaml.safe_load(f)

    # Expand environment variables
    def expand_env(value):
        if isinstance(value, str):
            # Handle ${VAR} or $VAR format
            if "$" in value:
                # Find environment variable pattern
                import re

                match = re.search(r"\$\{([^}]+)\}", value)
                if not match:
                    # Try simple $VAR format
                    match = re.match(r"\$([A-Z_][A-Z0-9_]*)", value)

                if match:
                    env_var = match.group(1)
                    return os.getenv(env_var, value)
        elif isinstance(value, dict):
            return {k: expand_env(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [expand_env(v) for v in value]
        return value

    return expand_env(config)


def validate_command(args):
    """Validate configuration and Jira connection"""
    print("🔍 Validating configuration...")

    try:
        config = load_config(args.config)

        jira_config = config.get("jira", {})
        jira = JiraConnector(
            url=jira_config.get("url"),
            email=jira_config.get("email"),
            api_token=jira_config.get("api_token"),
            project_key=jira_config.get("project_key"),
        )

        print(f"  Jira URL: {jira.url}")
        print(f"  Email: {jira.email}")
        print(f"  Project: {jira.project_key}")

        if jira.test_connection():
            print("  ✓ Connection successful")

            project_config = jira.detect_project_config()
            print(f"  ✓ Project found: {project_config['project'].name}")
            print(f"  ✓ Issue types: {', '.join(project_config['issue_types'])}")
            print(f"  ✓ Statuses: {', '.join(project_config['statuses'])}")
            print(f"  ✓ Priorities: {', '.join(project_config['priorities'])}")
        else:
            print("  ✗ Connection failed")
            sys.exit(1)

    except Exception as e:
        print(f"  ✗ Error: {e}")
        sys.exit(1)


def detect_config_command(args):
    """Auto-detect and display Jira project configuration"""
    print("🔍 Detecting Jira project configuration...")

    try:
        config = load_config(args.config)
        jira_config = config.get("jira", {})
        jira = JiraConnector(
            url=jira_config.get("url"),
            email=jira_config.get("email"),
            api_token=jira_config.get("api_token"),
        )

        if not jira.test_connection():
            print("  ✗ Connection failed")
            sys.exit(1)

        project_config = jira.detect_project_config()

        print()
        print("Project Configuration:")
        print(f"  Name: {project_config['project'].name}")
        print(f"  Key: {project_config['project'].key}")
        print()
        print("Issue Types:")
        for it in project_config["issue_types"]:
            print(f"  - {it}")
        print()
        print("Statuses:")
        for s in project_config["statuses"]:
            print(f"  - {s}")
        print()
        print("Priorities:")
        for p in project_config["priorities"]:
            print(f"  - {p}")

    except Exception as e:
        print(f"  ✗ Error: {e}")
        sys.exit(1)


def sync_command(args):
    """Perform bidirectional sync"""
    print("🔄 Starting bidirectional sync...")

    try:
        # Load configuration
        config = load_config(args.config)

        # Parse Todo.md
        script_dir = Path(__file__).parent.parent.resolve()
        todo_path = Path(args.todo_file)
        if not todo_path.is_absolute():
            todo_path = script_dir / todo_path

        parser = SimpleTodoParser(str(todo_path))
        todo_doc = parser.parse()

        print(f"  Parsed {len(todo_doc.sections)} sections")
        total_items = sum(len(section.items) for section in todo_doc.sections)
        print(f"  Found {total_items} items")

        # Initialize Jira client
        jira_config = config.get("jira", {})
        jira = JiraConnector(
            url=jira_config.get("url"),
            email=jira_config.get("email"),
            api_token=jira_config.get("api_token"),
            project_key=jira_config.get("project_key"),
        )

        if not jira.test_connection():
            print("  ✗ Jira connection failed")
            sys.exit(1)

        print("  ✓ Connected to Jira")

        # Initialize sync engine
        sync_config = config.get("sync", {})
        engine = SyncEngine(Path(args.todo_file).resolve(), jira, config)

        # Perform sync
        if args.dry_run:
            print()
            print("  ⚠️  DRY RUN MODE - No changes will be made")

        print()

        todo_doc, changes = engine.sync(
            todo_doc, dry_run=args.dry_run, section_filter=args.section
        )

        # Summary
        print()
        print("Sync Summary:")
        print(f"  Total changes: {len(changes)}")

        if args.dry_run:
            print()
            print("Run without --dry-run to apply changes.")
        else:
            # Write updated Todo.md
            if changes:
                writer = TodoWriter(str(todo_path))
                writer.write(todo_doc)
                print(f"  ✓ Updated {todo_path}")
                print()
                print("✓ Sync complete!")
            else:
                print("  ✓ No changes needed")

    except Exception as e:
        print(f"  ✗ Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


def pull_command(args):
    """Pull Jira changes to Todo.md"""
    print("📥 Pulling changes from Jira...")
    # Reuse sync with pull-only mode
    args.dry_run = False
    args.section = None
    sync_command(args)


def push_command(args):
    """Push Todo.md changes to Jira"""
    print("📤 Pushing changes to Jira...")
    # Reuse sync with push-only mode
    args.dry_run = False
    args.section = None
    sync_command(args)


def status_command(args):
    """Show sync status"""
    print("📊 Sync Status")

    try:
        from scripts.jira_integration.types import SyncState
        import json

        state_file = Path(args.todo_file).resolve().parent / ".jira-sync-state.json"

        if state_file.exists():
            with open(state_file, "r") as f:
                state_data = json.load(f)

            last_sync = state_data.get("last_sync")
            if last_sync:
                dt = datetime.fromisoformat(last_sync)
                print(f"  Last sync: {dt.strftime('%Y-%m-%d %H:%M:%S')}")

            todo_items = state_data.get("todo_items", {})
            jira_issues = state_data.get("jira_issues", {})

            print(f"  Todo items linked: {len(todo_items)}")
            print(f"  Jira issues linked: {len(jira_issues)}")
        else:
            print("  No sync state found. Run sync first.")

    except Exception as e:
        print(f"  ✗ Error: {e}")


def main():
    # Load .env files from project root
    script_dir = Path(__file__).parent.parent.resolve()
    load_dotenv(script_dir / ".env")
    load_dotenv(script_dir / ".env.local")

    parser = argparse.ArgumentParser(
        description="Bidirectional Todo.md <-> Jira sync",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/jira_sync.py sync
  python scripts/jira_sync.py sync --dry-run
  python scripts/jira_sync.py sync --section "Phase 6"
  python scripts/jira_sync.py validate
  python scripts/jira_sync.py detect-config
        """,
    )

    # Global options
    parser.add_argument(
        "--config",
        "-c",
        default=None,
        help="Path to config file (default: .jira-config.yml in script directory)",
    )
    parser.add_argument(
        "--todo-file",
        "-t",
        default="Todo.md",
        help="Path to Todo.md file (default: Todo.md)",
    )

    # Subcommands
    subparsers = parser.add_subparsers(dest="command", required=True)

    # sync command
    sync_parser = subparsers.add_parser("sync", help="Two-way bidirectional sync")
    sync_parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without applying them"
    )
    sync_parser.add_argument(
        "--section", "-s", help='Sync specific section only (e.g., "Phase 6")'
    )

    # pull command
    subparsers.add_parser(
        "pull", help="Pull Jira changes to Todo.md (create new items only)"
    )

    # push command
    subparsers.add_parser(
        "push", help="Push Todo.md changes to Jira (create/update issues)"
    )

    # status command
    subparsers.add_parser("status", help="Show sync status")

    # validate command
    subparsers.add_parser("validate", help="Validate configuration and Jira connection")

    # detect-config command
    subparsers.add_parser(
        "detect-config", help="Auto-detect and display Jira project configuration"
    )

    args = parser.parse_args()

    # Execute command
    if args.command == "sync":
        sync_command(args)
    elif args.command == "pull":
        pull_command(args)
    elif args.command == "push":
        push_command(args)
    elif args.command == "status":
        status_command(args)
    elif args.command == "validate":
        validate_command(args)
    elif args.command == "detect-config":
        detect_config_command(args)


if __name__ == "__main__":
    main()
