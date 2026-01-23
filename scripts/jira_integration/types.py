"""
Data models for Todo.md parsing and Jira integration.
"""

from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class TodoStatus(Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


@dataclass
class TodoItem:
    """Represents a single checklist item in Todo.md"""

    text: str
    status: TodoStatus
    priority: Optional[str] = None  # P0/P1/P2/P3
    jira_key: Optional[str] = None
    children: List["TodoItem"] = field(default_factory=list)
    description: Optional[str] = None
    line_number: int = 0
    section_title: Optional[str] = None
    parent_key: Optional[str] = None  # For subtasks


@dataclass
class TodoSection:
    """Represents a section header in Todo.md"""

    title: str
    level: int  # 1 for ##, 2 for ###
    jira_key: Optional[str] = None
    items: List[TodoItem] = field(default_factory=list)
    description: Optional[str] = None
    line_number: int = 0


@dataclass
class TodoDocument:
    """Represents the entire Todo.md document"""

    sections: List[TodoSection] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    last_sync: Optional[datetime] = None


@dataclass
class SyncState:
    """Tracks sync state between Todo.md and Jira"""

    last_sync: Optional[datetime] = None
    todo_items: dict[str, datetime] = field(
        default_factory=dict
    )  # jira_key -> last_synced
    jira_issues: dict[str, datetime] = field(
        default_factory=dict
    )  # jira_key -> last_synced
    conflicts: List[dict] = field(default_factory=list)


@dataclass
class JiraIssue:
    """Represents a Jira issue"""

    key: str
    summary: str
    description: Optional[str]
    status: str
    priority: Optional[str]
    issue_type: str
    parent_key: Optional[str] = None
    updated: Optional[datetime] = None
    fields: dict = field(default_factory=dict)
