"""
Simplified Todo.md parser that handles unstructured data robustly.
Uses heuristics instead of brittle regex patterns.
"""

from pathlib import Path
from typing import List, Optional
from datetime import datetime

from scripts.jira_integration.types import (
    TodoDocument,
    TodoSection,
    TodoItem,
    TodoStatus,
)


class SimpleTodoParser:
    """Simple, robust parser for Todo.md files"""

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.lines = self._read_lines()

    def _read_lines(self) -> List[str]:
        """Read all lines from file"""
        with open(self.file_path, "r", encoding="utf-8") as f:
            return f.readlines()

    def parse(self) -> TodoDocument:
        """Parse Todo.md using simple heuristics"""
        sections = []
        current_section = None
        current_items = []
        in_code_block = False

        for i, line in enumerate(self.lines, 1):
            # Track line numbers
            line_num = i

            # Skip empty lines
            if not line.strip():
                continue

            # Handle code blocks (skip everything between ``` and ```)
            if line.strip().startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue

            # Detect section headers (#, ##, ###)
            if line.strip().startswith("#"):
                # Save previous section
                if current_section and current_items:
                    current_section.items = current_items
                    sections.append(current_section)

                # Start new section
                header_text = line.strip().lstrip("#").strip()
                level = len(line.strip()) - len(line.strip().lstrip("#"))

                current_section = TodoSection(
                    title=header_text, level=level, line_number=line_num
                )
                current_items = []
                continue

            # Detect checklist items
            if self._is_checklist_item(line):
                item = self._parse_item(line, line_num, current_section)
                if item:
                    current_items.append(item)
                    # Add to section's items for hierarchy building later
                    continue

            # Table rows or other non-checklist content - skip for now
            # Can add description handling later

        # Don't forget the last section
        if current_section and current_items:
            current_section.items = current_items
            sections.append(current_section)

        # Build hierarchy for nested items
        for section in sections:
            section.items = self._build_hierarchy(section.items)

        return TodoDocument(sections=sections)

    def _is_checklist_item(self, line: str) -> bool:
        """Check if line is a checklist item"""
        stripped = line.strip()
        # Must start with dash or asterisk
        if not (stripped.startswith("-") or stripped.startswith("*")):
            return False
        # Must have [ ] or [x] or [-]
        if "[" in stripped and "]" in stripped:
            return True
        return False

    def _parse_item(
        self, line: str, line_num: int, section: Optional[TodoSection]
    ) -> Optional[TodoItem]:
        """Parse a single checklist line"""
        try:
            stripped = line.lstrip()

            # Get indentation level (number of leading spaces)
            indent = line[: len(line) - len(stripped)]
            indent_level = len(indent)

            # Extract text and status
            # Pattern: - [x] Text or - [ ] Text
            bracket_start = stripped.find("[")
            bracket_end = stripped.find("]")

            if bracket_start == -1 or bracket_end == -1:
                return None

            status_char = stripped[bracket_start + 1 : bracket_end]
            text = stripped[bracket_end + 1 :].strip()

            # Parse status
            status_map = {
                " ": TodoStatus.TODO,
                "-": TodoStatus.IN_PROGRESS,
                "x": TodoStatus.DONE,
            }
            status = status_map.get(status_char, TodoStatus.TODO)

            # Extract Jira key from HTML comment
            jira_key = None
            if "<!--" in text:
                comment_start = text.find("<!--")
                comment_end = text.find("-->", comment_start)
                if comment_end != -1:
                    comment_text = text[comment_start + 4 : comment_end]
                    # Look for JIRA: pattern
                    import re

                    jira_match = re.search(r"JIRA:\s*([A-Z0-9]+-\d+)", comment_text)
                    if jira_match:
                        jira_key = jira_match.group(1)
                        # Remove comment from text
                        text = text[:comment_start].strip()

            # Extract priority (P0, P1, P2, P3)
            priority = None
            import re

            priority_match = re.search(r"\b(P[0-3])\b", text)
            if priority_match:
                priority = priority_match.group(0)

            return TodoItem(
                text=text,
                status=status,
                priority=priority,
                jira_key=jira_key,
                line_number=line_num,
                section_title=section.title if section else None,
                children=[],
            )

        except Exception:
            return None

    def _build_hierarchy(self, flat_items: List[TodoItem]) -> List[TodoItem]:
        """Build parent-child relationships from flat list based on indentation"""
        if not flat_items:
            return []

        # For now, return items as flat list without nesting
        # Can implement proper hierarchy later if needed
        return flat_items


def format_status(todo_status: TodoStatus) -> str:
    """Convert TodoStatus to markdown checkbox"""
    status_map = {
        TodoStatus.TODO: "[ ]",
        TodoStatus.IN_PROGRESS: "[-]",
        TodoStatus.DONE: "[x]",
    }
    return status_map.get(todo_status, "[ ]")


def add_jira_key_to_text(text: str, jira_key: str) -> str:
    """Add Jira key comment to text if not already present"""
    if f"<!-- JIRA: {jira_key} -->" in text:
        return text
    return f"{text} <!-- JIRA: {jira_key} -->"
