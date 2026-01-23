"""
Jira API client wrapper.
Handles authentication, project config detection, and CRUD operations.
"""

import os
import re
from typing import List, Optional, Dict, Any
from datetime import datetime

try:
    from jira import JIRA
    from jira.exceptions import JIRAError
except ImportError:
    raise ImportError("jira package not installed. Run: uv pip install jira")

from scripts.jira_integration.types import TodoItem, JiraIssue


class JiraConnector:
    """Wrapper around jira-python library for Todo.md sync"""

    def __init__(
        self,
        url: str = None,
        email: str = None,
        api_token: str = None,
        project_key: str = None,
    ):
        self.url = url or os.getenv("JIRA_URL")
        self.email = email or os.getenv("JIRA_EMAIL")
        self.api_token = api_token or os.getenv("JIRA_API_TOKEN")
        self.project_key = project_key or os.getenv("JIRA_PROJECT_KEY", "CAP")

        if not all([self.url, self.email, self.api_token]):
            raise ValueError("JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set")

        # Initialize JIRA client
        self.jira = JIRA(server=self.url, basic_auth=(self.email, self.api_token))

        # Cache for project metadata
        self._project_config = None

    def detect_project_config(self) -> Dict[str, Any]:
        """Auto-detect project issue types, statuses, priorities"""
        if self._project_config:
            return self._project_config

        try:
            project = self.jira.project(self.project_key)

            # Get issue types
            issue_types = self.jira.issue_types_for_project(self.project_key)
            issue_type_names = [it.name for it in issue_types]

            # Get statuses
            statuses = self.jira.statuses()
            status_names = [s.name for s in statuses]

            # Get priorities
            priorities = self.jira.priorities()
            priority_names = [p.name for p in priorities]

            self._project_config = {
                "project": project,
                "issue_types": issue_type_names,
                "statuses": status_names,
                "priorities": priority_names,
                "issue_type_map": {it.name: it.id for it in issue_types},
                "status_map": {s.name: s.id for s in statuses},
                "priority_map": {p.name: p.id for p in priorities},
            }

            return self._project_config

        except JIRAError as e:
            raise RuntimeError(f"Failed to detect project config: {e}")

    def _get_issue_type_id(self, issue_type_name: str) -> str:
        """Get issue type ID from name"""
        config = self.detect_project_config()
        return config["issue_type_map"].get(issue_type_name)

    def _get_status_id(self, status_name: str) -> str:
        """Get status ID from name"""
        config = self.detect_project_config()
        return config["status_map"].get(status_name)

    def _get_priority_id(self, priority_name: str) -> str:
        """Get priority ID from name"""
        config = self.detect_project_config()
        return config["priority_map"].get(priority_name)

    def map_todo_status_to_jira(self, todo_status: str) -> str:
        """Map TodoStatus to Jira status name"""
        status_map = {"todo": "To Do", "in_progress": "In Progress", "done": "Done"}
        return status_map.get(todo_status, "To Do")

    def map_todo_priority_to_jira(self, todo_priority: Optional[str]) -> Optional[str]:
        """Map P0/P1/P2/P3 to Jira priority"""
        priority_map = {"P0": "Highest", "P1": "High", "P2": "Medium", "P3": "Low"}
        return priority_map.get(todo_priority) if todo_priority else None

    def map_jira_status_to_todo(self, jira_status: str) -> str:
        """Map Jira status name to TodoStatus"""
        status_map = {
            "To Do": "todo",
            "In Progress": "in_progress",
            "Done": "done",
            "Closed": "done",
        }
        return status_map.get(jira_status, "todo")

    def create_issue(
        self, item: TodoItem, parent_key: str = None, issue_type: str = "Sub-task"
    ) -> str:
        """Create a Jira issue from TodoItem, returns issue key"""
        try:
            # Map values
            jira_status = self.map_todo_status_to_jira(item.status.value)
            jira_priority = self.map_todo_priority_to_jira(item.priority)

            fields = {
                "project": {"key": self.project_key},
                "summary": item.text,
                "description": item.description or item.text,
                "issuetype": {"name": issue_type},
            }

            if jira_status:
                # Set via transition, not directly in creation
                pass

            if jira_priority:
                priority_id = self._get_priority_id(jira_priority)
                if priority_id:
                    fields["priority"] = {"id": priority_id}

            if parent_key:
                # For subtasks
                fields["parent"] = {"key": parent_key}

            issue = self.jira.create_issue(fields=fields)

            # Set status if not default
            if jira_status and jira_status != "To Do":
                try:
                    transitions = self.jira.transitions(issue)
                    for transition in transitions:
                        if transition.get("name") == jira_status:
                            self.jira.transition_issue(issue, transition["id"])
                            break
                except JIRAError:
                    pass  # Status transition may not be available

            return issue.key

        except JIRAError as e:
            raise RuntimeError(f"Failed to create issue: {e}")

    def update_issue(self, key: str, item: TodoItem):
        """Update existing Jira issue from TodoItem"""
        try:
            issue = self.jira.issue(key)

            # Map values
            jira_status = self.map_todo_status_to_jira(item.status.value)
            jira_priority = self.map_todo_priority_to_jira(item.priority)

            fields = {}

            if issue.fields.summary != item.text:
                fields["summary"] = item.text

            if issue.fields.description != (item.description or item.text):
                fields["description"] = item.description or item.text

            if jira_priority:
                priority_id = self._get_priority_id(jira_priority)
                if (
                    priority_id
                    and issue.fields.priority
                    and issue.fields.priority.id != priority_id
                ):
                    fields["priority"] = {"id": priority_id}

            if fields:
                issue.update(fields=fields)

            # Update status via transition
            current_status = issue.fields.status.name
            if jira_status and current_status != jira_status:
                transitions = self.jira.transitions(issue)
                for transition in transitions:
                    if transition.get("name") == jira_status:
                        self.jira.transition_issue(issue, transition["id"])
                        break

        except JIRAError as e:
            raise RuntimeError(f"Failed to update issue {key}: {e}")

    def get_issue(self, key: str) -> Optional[JiraIssue]:
        """Fetch issue details by key"""
        try:
            issue = self.jira.issue(key)
            return JiraIssue(
                key=issue.key,
                summary=issue.fields.summary,
                description=issue.fields.description,
                status=issue.fields.status.name,
                priority=issue.fields.priority.name if issue.fields.priority else None,
                issue_type=issue.fields.issuetype.name,
                parent_key=issue.fields.parent.key if issue.fields.parent else None,
                updated=datetime.fromisoformat(
                    issue.fields.updated.replace("Z", "+00:00")
                )
                if issue.fields.updated
                else None,
                fields={
                    "summary": issue.fields.summary,
                    "description": issue.fields.description,
                },
            )
        except JIRAError:
            return None

    def get_all_issues(self, project_key: str = None) -> List[JiraIssue]:
        """Fetch all issues in project"""
        project_key = project_key or self.project_key
        try:
            # Use JQL to fetch all issues
            jql = f'project = "{project_key}"'
            issues = self.jira.search_issues(
                jql,
                fields=[
                    "key",
                    "summary",
                    "description",
                    "status",
                    "priority",
                    "issuetype",
                    "parent",
                    "updated",
                ],
                maxResults=1000,
            )

            result = []
            for issue in issues:
                result.append(
                    JiraIssue(
                        key=issue.key,
                        summary=issue.fields.summary,
                        description=issue.fields.description,
                        status=issue.fields.status.name,
                        priority=issue.fields.priority.name
                        if issue.fields.priority
                        else None,
                        issue_type=issue.fields.issuetype.name,
                        parent_key=issue.fields.parent.key
                        if issue.fields.parent
                        else None,
                        updated=datetime.fromisoformat(
                            issue.fields.updated.replace("Z", "+00:00")
                        )
                        if issue.fields.updated
                        else None,
                    )
                )

            return result

        except JIRAError as e:
            raise RuntimeError(f"Failed to fetch issues: {e}")

    def archive_issue(self, key: str):
        """Close/archive an issue"""
        try:
            issue = self.jira.issue(key)

            # Try to transition to "Closed" or "Done"
            transitions = self.jira.transitions(issue)
            target_status = None

            for status in ["Closed", "Done"]:
                for transition in transitions:
                    if transition.get("name") == status:
                        target_status = transition
                        break
                if target_status:
                    break

            if target_status:
                self.jira.transition_issue(issue, target_status["id"])

        except JIRAError as e:
            raise RuntimeError(f"Failed to archive issue {key}: {e}")

    def test_connection(self) -> bool:
        """Test if connection to Jira is working"""
        try:
            self.jira.myself()
            return True
        except JIRAError:
            return False
