"""
Conflict resolution for bidirectional sync.
Provides interactive prompts for resolving conflicts.
"""

import os
import sys
from datetime import datetime
from typing import Literal

from scripts.jira_integration.types import TodoItem, JiraIssue, TodoStatus


class Resolution:
    """Represents a conflict resolution"""

    def __init__(
        self,
        action: Literal["push", "pull", "skip", "manual"],
        timestamp: datetime = None,
    ):
        self.action = action
        self.timestamp = timestamp or datetime.now()


class ConflictResolver:
    """Handles interactive conflict resolution between Todo.md and Jira"""

    COLORS = {
        "reset": "\033[0m",
        "red": "\033[91m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "cyan": "\033[96m",
        "bold": "\033[1m",
    }

    @classmethod
    def colorize(cls, text: str, color: str) -> str:
        """Add ANSI color codes to text"""
        return f"{cls.COLORS.get(color, '')}{text}{cls.COLORS['reset']}"

    def __init__(self, mode: str = "interactive"):
        self.mode = mode  # interactive, latest, manual

    def resolve(
        self, todo_item: TodoItem, jira_issue: JiraIssue, dry_run: bool = False
    ) -> Resolution:
        """Resolve conflict between Todo.md item and Jira issue"""
        if self.mode == "interactive":
            return self._interactive_resolve(todo_item, jira_issue, dry_run)
        elif self.mode == "latest":
            return self._latest_resolve(todo_item, jira_issue)
        else:
            return Resolution(action="skip")

    def _interactive_resolve(
        self, todo_item: TodoItem, jira_issue: JiraIssue, dry_run: bool
    ) -> Resolution:
        """Interactive prompt for conflict resolution"""
        print()
        print(self.colorize("⚠️  CONFLICT DETECTED", "yellow"))
        print()
        print(f"Item: {todo_item.text}")
        print(f"Jira:  {jira_issue.key}")
        print()
        print(
            f"Status:   Todo.md={self._status_display(todo_item.status.value)}, "
            f"Jira={jira_issue.status}"
        )
        print(
            f"Updated:   Todo.md=now, "
            f"Jira={jira_issue.updated.strftime('%Y-%m-%d %H:%M') if jira_issue.updated else 'unknown'}"
        )
        print()

        # Show differences
        self._show_differences(todo_item, jira_issue)

        print()
        print("Options:")
        print("  1. Use Todo.md version (push to Jira)")
        print("  2. Use Jira version (pull to Todo.md)")
        print("  3. Skip (keep both as-is)")
        if not dry_run:
            print("  4. Manual merge (open in editor)")

        while True:
            try:
                choice = input("Select [1-4]: ").strip()
                if choice == "1":
                    return Resolution(action="push")
                elif choice == "2":
                    return Resolution(action="pull")
                elif choice == "3":
                    return Resolution(action="skip")
                elif choice == "4" and not dry_run:
                    return self._manual_merge(todo_item, jira_issue)
                else:
                    print("Invalid choice. Please enter 1-4.")
            except (EOFError, KeyboardInterrupt):
                print()
                return Resolution(action="skip")

    def _latest_resolve(self, todo_item: TodoItem, jira_issue: JiraIssue) -> Resolution:
        """Auto-resolve using latest timestamp"""
        if not jira_issue.updated:
            return Resolution(action="push")

        # Todo item is considered "now" (just edited)
        # So prefer Jira if it was updated recently
        jira_age = (datetime.now() - jira_issue.updated).total_seconds()

        if jira_age > 3600:
            return Resolution(action="push")
        else:
            return Resolution(action="pull")

    def _manual_merge(self, todo_item: TodoItem, jira_issue: JiraIssue) -> Resolution:
        """Open editor for manual merge"""
        import tempfile
        import subprocess

        print()
        print("Opening editor for manual merge...")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(f"# Todo.md Version\n\n")
            f.write(f"{todo_item.text}\n")
            f.write(f"Status: {todo_item.status.value}\n")
            if todo_item.description:
                f.write(f"\n{todo_item.description}\n")

            f.write(f"\n---\n\n")
            f.write(f"# Jira Version ({jira_issue.key})\n\n")
            f.write(f"{jira_issue.summary}\n")
            f.write(f"Status: {jira_issue.status}\n")
            if jira_issue.description:
                f.write(f"\n{jira_issue.description}\n")

            temp_path = f.name

        try:
            editor = os.getenv("EDITOR", "vim")
            subprocess.call([editor, temp_path])

            with open(temp_path, "r") as f:
                merged = f.read()

            print()
            print("Merged content:")
            print(merged)

            choice = input("Accept merge? [y/n]: ").strip().lower()
            if choice == "y":
                lines = merged.split("\n")
                for line in lines:
                    if line.strip() and not line.startswith("#"):
                        todo_item.text = line.strip()
                        break

                return Resolution(action="push")
            else:
                return Resolution(action="skip")

        finally:
            os.unlink(temp_path)

    def _show_differences(self, todo_item: TodoItem, jira_issue: JiraIssue):
        """Show key differences between versions"""
        differences = []

        if todo_item.text != jira_issue.summary:
            differences.append(("Summary", todo_item.text, jira_issue.summary))

        if todo_item.status.value.lower() != jira_issue.status.lower():
            todo_status = self._status_display(todo_item.status.value)
            differences.append(("Status", todo_status, jira_issue.status))

        if differences:
            print("Differences:")
            for field, todo_val, jira_val in differences:
                print(f"  {field}:")
                print(f"    Todo.md: {todo_val}")
                print(f"    Jira:   {jira_val}")

    def _status_display(self, status: str) -> str:
        """Format status for display"""
        status_map = {"todo": "To Do", "in_progress": "In Progress", "done": "Done"}
        return status_map.get(status, status)
