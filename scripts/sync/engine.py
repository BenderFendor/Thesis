"""
Core sync engine for bidirectional Todo.md <-> Jira synchronization.
"""

import json
import dataclasses
from pathlib import Path
from datetime import datetime
from typing import List, Tuple, Dict, Any
from enum import Enum

from scripts.jira_integration.types import TodoDocument, TodoItem, JiraIssue, SyncState
from scripts.jira_integration.client import JiraConnector
from scripts.sync.conflict_resolver import ConflictResolver, Resolution


class ChangeType(Enum):
    CREATE_TODO = "create_todo"
    CREATE_JIRA = "create_jira"
    UPDATE_TODO = "update_todo"
    UPDATE_JIRA = "update_jira"
    CONFLICT = "conflict"
    DELETE_TODO = "delete_todo"
    DELETE_JIRA = "delete_jira"


@dataclasses.dataclass
class Change:
    """Represents a detected change"""

    change_type: ChangeType
    item: TodoItem = None
    issue: JiraIssue = None
    resolution: Resolution = None


class SyncEngine:
    """Main synchronization engine"""

    def __init__(self, todo_file: str, jira_client: JiraConnector, config: dict):
        self.todo_file = Path(todo_file)
        self.jira = jira_client
        self.config = config
        self.sync_state = self._load_sync_state()
        self.resolver = ConflictResolver(
            mode=config.get("sync", {}).get("conflict_mode", "interactive")
        )

    def _load_sync_state(self) -> SyncState:
        """Load sync state from .jira-sync-state.json"""
        state_file = self.todo_file.parent / ".jira-sync-state.json"
        if state_file.exists():
            with open(state_file, "r") as f:
                data = json.load(f)
                return SyncState(**data)
        return SyncState()

    def _save_sync_state(self):
        """Save sync state to .jira-sync-state.json"""
        state_file = self.todo_file.parent / ".jira-sync-state.json"
        with open(state_file, "w") as f:
            json.dump(dataclasses.asdict(self.sync_state), f, indent=2)

    def detect_changes(
        self, todo_doc: TodoDocument, jira_issues: List[JiraIssue]
    ) -> List[Change]:
        """Detect changes between Todo.md and Jira"""
        changes = []

        todo_map: Dict[str, TodoItem] = {}
        jira_map: Dict[str, JiraIssue] = {}

        for item in self._get_all_items(todo_doc):
            if item.jira_key:
                todo_map[item.jira_key] = item

        for issue in jira_issues:
            jira_map[issue.key] = issue

        for item in self._get_all_items(todo_doc):
            if not item.jira_key:
                changes.append(Change(change_type=ChangeType.CREATE_JIRA, item=item))

        for issue in jira_issues:
            if issue.key not in todo_map:
                changes.append(Change(change_type=ChangeType.CREATE_TODO, issue=issue))

        for key in set(todo_map.keys()) & set(jira_map.keys()):
            todo_item = todo_map[key]
            jira_issue = jira_map[key]

            if self._has_status_change(todo_item, jira_issue):
                changes.append(
                    Change(
                        change_type=ChangeType.CONFLICT,
                        item=todo_item,
                        issue=jira_issue,
                    )
                )

        return changes

    def _get_all_items(self, doc: TodoDocument) -> List[TodoItem]:
        """Get all items recursively including nested"""
        items = []
        for section in doc.sections:
            for item in section.items:
                items.append(item)
                if item.children:
                    items.extend(self._get_nested_children(item))
        return items

    def _get_nested_children(self, item: TodoItem) -> List[TodoItem]:
        """Get all nested children recursively"""
        children = []
        for child in item.children:
            children.append(child)
            if child.children:
                children.extend(self._get_nested_children(child))
        return children

    def _has_status_change(self, todo_item: TodoItem, jira_issue: JiraIssue) -> bool:
        """Check if status has changed"""
        todo_status = todo_item.status.value.lower()
        jira_status = jira_issue.status.lower()
        return todo_status != jira_status

    def execute_changes(
        self, changes: List[Change], dry_run: bool = False
    ) -> List[Change]:
        """Execute detected changes"""
        executed = []

        for change in changes:
            if change.change_type == ChangeType.CREATE_JIRA:
                executed.append(self._create_jira_issue(change, dry_run))
            elif change.change_type == ChangeType.CREATE_TODO:
                executed.append(self._create_todo_item(change))
            elif change.change_type == ChangeType.CONFLICT:
                executed.append(self._resolve_conflict(change, dry_run))
            elif change.change_type == ChangeType.DELETE_TODO:
                executed.append(self._archive_todo_item(change))
            elif change.change_type == ChangeType.DELETE_JIRA:
                executed.append(self._archive_jira_issue(change, dry_run))

        return executed

    def _create_jira_issue(self, change: Change, dry_run: bool = False) -> Change:
        """Create new Jira issue from TodoItem"""
        item = change.item

        if not dry_run:
            print(f"Creating Jira issue: {item.text}")

            issue_type = self._determine_issue_type(item)

            try:
                jira_key = self.jira.create_issue(item, issue_type=issue_type)
                item.jira_key = jira_key
                print(f"  Created: {jira_key}")
            except Exception as e:
                print(f"  Error: {e}")

        return change

    def _create_todo_item(self, change: Change) -> Change:
        """Create new TodoItem from Jira issue"""
        issue = change.issue
        print(f"Adding to Todo.md: {issue.summary}")
        return change

    def _resolve_conflict(self, change: Change, dry_run: bool = False) -> Change:
        """Resolve conflict between Todo.md and Jira"""
        resolution = self.resolver.resolve(change.item, change.issue, dry_run)
        change.resolution = resolution

        if not dry_run:
            if resolution.action == "push":
                print(f"Pushing Todo.md version: {change.item.text}")
                self.jira.update_issue(change.issue.key, change.item)
            elif resolution.action == "pull":
                print(f"Pulling Jira version: {change.issue.key}")
                todo_status = self.jira.map_jira_status_to_todo(change.issue.status)
                change.item.status = todo_status
            elif resolution.action == "skip":
                print(f"Skipping conflict: {change.issue.key}")

        return change

    def _archive_todo_item(self, change: Change) -> Change:
        """Archive deleted Todo item to Log.md"""
        print(f"Archiving to Log.md: {change.item.text}")
        return change

    def _archive_jira_issue(self, change: Change, dry_run: bool = False) -> Change:
        """Close/archive Jira issue"""
        if not dry_run:
            print(f"Closing Jira issue: {change.issue.key}")
            self.jira.archive_issue(change.issue.key)
        return change

    def _determine_issue_type(self, item: TodoItem) -> str:
        """Determine Jira issue type based on item hierarchy"""
        config = self.config.get("sync", {}).get("issue_types", {})

        if item.children:
            return config.get("subsection", "Story")

        if item.parent_key:
            return config.get("item", "Sub-task")

        return config.get("item", "Task")

    def sync(
        self, todo_doc: TodoDocument, dry_run: bool = False, section_filter: str = None
    ) -> Tuple[TodoDocument, List[Change]]:
        """Perform full bidirectional sync"""
        if section_filter:
            todo_doc.sections = [
                s
                for s in todo_doc.sections
                if section_filter.lower() in s.title.lower()
            ]

        jira_issues = self.jira.get_all_issues()

        changes = self.detect_changes(todo_doc, jira_issues)

        executed = self.execute_changes(changes, dry_run)

        if not dry_run:
            self._update_sync_state(todo_doc, executed)

        return todo_doc, executed

    def _update_sync_state(self, todo_doc: TodoDocument, executed: List[Change]):
        """Update sync state after execution"""
        now = datetime.now()
        self.sync_state.last_sync = now

        for item in self._get_all_items(todo_doc):
            if item.jira_key:
                self.sync_state.todo_items[item.jira_key] = now
                self.sync_state.jira_issues[item.jira_key] = now

        self._save_sync_state()
