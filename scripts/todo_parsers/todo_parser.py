"""
Parser for Todo.md files.
Extracts sections, checklist items, priorities, and Jira keys.
"""

import re
from pathlib import Path
from typing import List, Tuple, Optional
from datetime import datetime

from scripts.jira_integration.types import (
    TodoDocument,
    TodoSection,
    TodoItem,
    TodoStatus,
)


class TodoParser:
    """Parses Todo.md markdown files into structured data"""

    # Regex patterns
    HEADER_PATTERN = re.compile(r"^(#{1,3})\s+(.+)$")
    CHECKLIST_PATTERN = re.compile(
        r"^(\s*)-\s+\[([ x\-])\]\s*(.+?)(\s*<!--\s*JIRA:\s*([A-Z0-9]+-\d+)\s*-->)?$"
    )
    PRIORITY_PATTERN = re.compile(r"\b(P[0-3])\b")
    INDENT_PATTERN = re.compile(r"^(\s*)")
    BLANK_PATTERN = re.compile(r"^\s*$")
    CODE_BLOCK_START = re.compile(r"^```")
    CODE_BLOCK_END = re.compile(r"^```")

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.lines = self._read_lines()

    def _read_lines(self) -> List[str]:
        """Read all lines from file"""
        with open(self.file_path, "r", encoding="utf-8") as f:
            return f.readlines()

    def parse(self) -> TodoDocument:
        """Parse entire Todo.md file"""
        print(f"DEBUG - Starting parse of {self.file_path}")
        sections: List[TodoSection] = []
        current_section: Optional[TodoSection] = None
        current_items: List[TodoItem] = []
        item_stack: List[Tuple[TodoItem, int]] = []  # (item, indent_level)
        in_code_block = False
        line_number = 0

        print(f"DEBUG - Total lines to parse: {len(self.lines)}")

        processed_count = 0
        for line in self.lines:
            line_number += 1
            processed_count += 1

            if processed_count <= 30:
                print(f"DEBUG - Line {line_number}: {repr(line[:80])}")

            # Skip code blocks
            if self.CODE_BLOCK_START.match(line):
                print(f"DEBUG - Line {line_number}: Entered code block")
                in_code_block = True
                continue
            if self.CODE_BLOCK_END.match(line):
                print(f"DEBUG - Line {line_number}: Exited code block")
                in_code_block = False
                continue
            if in_code_block:
                continue

            # Check for section header
            header_match = self.HEADER_PATTERN.match(line)
            if header_match:
                # Save previous section
                if current_section:
                    self._build_item_hierarchy(current_items, current_section)

                # Start new section
                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                current_section = TodoSection(
                    title=title, level=level, line_number=line_number
                )
                current_items = []
                item_stack = []
                sections.append(current_section)
                # print(f"DEBUG - Created section: {title} at line {line_number}")
                continue

            # Check for checklist item (match at line start)
            checklist_match = self.CHECKLIST_PATTERN.match(line)
            if checklist_match:
                print(f"DEBUG - Line {line_number}: Found checklist item")
                print(f"  Line content: {line.rstrip()}")
                print(f"  Match groups: {checklist_match.groups()}")
                print(
                    f"  Current section: {current_section.title if current_section else None}"
                )

                if not current_section:
                    print(f"  Skipping item (no current section)")
                    continue

                indent = checklist_match.group(1)
                status_char = checklist_match.group(2)
                text = checklist_match.group(3).strip()
                jira_key = checklist_match.group(4)

                # Map status
                status = self._parse_status(status_char)

                # Extract priority
                priority = self._extract_priority(text)

                # Calculate indent level
                indent_level = len(indent)

                # Create item
                item = TodoItem(
                    text=text,
                    status=status,
                    priority=priority,
                    jira_key=jira_key,
                    line_number=line_number,
                    section_title=current_section.title,
                )

                # Handle nesting
                self._add_item_to_hierarchy(item, indent_level, item_stack)
                current_items.append(item)
                continue

        # Don't forget the last section
        if current_section:
            self._build_item_hierarchy(current_items, current_section)

        return TodoDocument(sections=sections)

    def _parse_status(self, status_char: str) -> TodoStatus:
        """Convert checklist status character to TodoStatus enum"""
        status_map = {
            " ": TodoStatus.TODO,
            "-": TodoStatus.IN_PROGRESS,
            "x": TodoStatus.DONE,
        }
        return status_map.get(status_char, TodoStatus.TODO)

    def _extract_priority(self, text: str) -> Optional[str]:
        """Extract P0/P1/P2/P3 from text"""
        match = self.PRIORITY_PATTERN.search(text)
        return match.group(0) if match else None

    def _add_item_to_hierarchy(
        self, item: TodoItem, indent_level: int, item_stack: List[Tuple[TodoItem, int]]
    ):
        """Add item to proper place in hierarchy based on indentation"""
        # Remove items with equal or higher indent (they're siblings or done)
        while item_stack and item_stack[-1][1] >= indent_level:
            item_stack.pop()

        # Set parent if there's a higher-level item
        if item_stack:
            parent_item, _ = item_stack[-1]
            parent_item.children.append(item)
            item.parent_key = parent_item.jira_key

        # Add to stack
        item_stack.append((item, indent_level))

    def _build_item_hierarchy(self, flat_items: List[TodoItem], section: TodoSection):
        """Assign top-level items to section, preserving hierarchy in children"""
        top_level_items = [item for item in flat_items if item.parent_key is None]
        section.items = top_level_items


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
    pattern = r"<!--\s*JIRA:\s*" + re.escape(jira_key) + r"\s*-->"
    if re.search(pattern, text):
        return text
    return f"{text} <!-- JIRA: {jira_key} -->"
