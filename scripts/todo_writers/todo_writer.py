"""
Writer for updating Todo.md files.
Preserves formatting while updating status, Jira keys, and inserting new items.
"""

import re
from pathlib import Path
from typing import List, Tuple

from scripts.jira_integration.types import (
    TodoDocument,
    TodoSection,
    TodoItem,
    TodoStatus,
)


class TodoWriter:
    """Writes TodoDocument back to Todo.md file"""

    # Regex patterns (same as parser)
    CHECKLIST_PATTERN = re.compile(
        r"^(\s*)-\s+\[([ x\-])\]\s*(.+?)(\s*<!--\s*JIRA:\s*([A-Z0-9]+-\d+)\s*-->)?$"
    )
    STATUS_UPDATE_PATTERN = re.compile(r"(-\s+)\[([ x\-])\]")

    def __init__(self, file_path: str, original_lines: List[str] = None):
        self.file_path = Path(file_path)
        self.original_lines = original_lines or self._read_lines()

    def _read_lines(self) -> List[str]:
        """Read all lines from file"""
        with open(self.file_path, "r", encoding="utf-8") as f:
            return f.readlines()

    def write(self, doc: TodoDocument):
        """Write TodoDocument to file, preserving formatting"""
        new_lines = []
        line_index = 0
        total_lines = len(self.original_lines)

        while line_index < total_lines:
            line = self.original_lines[line_index]
            line_number = line_index + 1

            # Skip code blocks
            if line.startswith("```"):
                while line_index < total_lines:
                    new_lines.append(self.original_lines[line_index])
                    line_index += 1
                    if self.original_lines[line_index - 1].strip() == "```":
                        break
                continue

            # Check for checklist items that need updating
            updated_line = self._update_line(line, doc, line_number)
            new_lines.append(updated_line)

            line_index += 1

        # Write new content
        with open(self.file_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

    def _update_line(self, line: str, doc: TodoDocument, line_number: int) -> str:
        """Update a single line if it's a checklist item"""
        match = self.CHECKLIST_PATTERN.match(line)

        if not match:
            return line

        indent = match.group(1)
        status_char = match.group(2)
        text = match.group(3).strip()
        jira_key = match.group(4)

        # Find corresponding item in document
        item = self._find_item_by_line(doc, line_number)

        if not item:
            return line

        # Update status checkbox
        new_status_char = self._get_status_char(item.status)
        if new_status_char != status_char:
            line = self.STATUS_UPDATE_PATTERN.sub(
                f"{indent}[{new_status_char}]", line, count=1
            )

        # Update Jira key if changed
        if item.jira_key and item.jira_key != jira_key:
            # Remove old key if exists
            if jira_key:
                line = re.sub(
                    r"<!--\s*JIRA:\s*" + re.escape(jira_key) + r"\s*-->", "", line
                )

            # Add new key
            line = line.rstrip()
            if not line.endswith(" -->"):
                line += " <!-- JIRA: " + item.jira_key + " -->"
            else:
                # Replace existing comment
                line = re.sub(
                    r"<!--\s*JIRA:\s*[A-Z0-9]+-\d+\s*-->",
                    f"<!-- JIRA: {item.jira_key} -->",
                    line,
                )

        return line

    def _find_item_by_line(self, doc: TodoDocument, line_number: int) -> TodoItem:
        """Find TodoItem that corresponds to line number"""
        for section in doc.sections:
            for item in self._find_all_items(section):
                if abs(item.line_number - line_number) < 5:
                    return item
        return None

    def _find_all_items(self, section: TodoSection) -> List[TodoItem]:
        """Recursively find all items in section (including nested)"""
        items = []
        for item in section.items:
            items.append(item)
            if item.children:
                items.extend(self._find_all_nested_children(item))
        return items

    def _find_all_nested_children(self, item: TodoItem) -> List[TodoItem]:
        """Recursively find all child items"""
        children = []
        for child in item.children:
            children.append(child)
            if child.children:
                children.extend(self._find_all_nested_children(child))
        return children

    def _get_status_char(self, status: TodoStatus) -> str:
        """Get checkbox character for TodoStatus"""
        status_map = {
            TodoStatus.TODO: " ",
            TodoStatus.IN_PROGRESS: "-",
            TodoStatus.DONE: "x",
        }
        return status_map.get(status, " ")

    def insert_new_items(self, doc: TodoDocument):
        """Insert new items from Jira that don't exist in file"""
        # Collect all existing line numbers
        existing_lines = {item.line_number for item in self._find_all_items_in_doc(doc)}

        # Find new items (those with line_number == 0)
        new_items = [
            item for item in self._find_all_items_in_doc(doc) if item.line_number == 0
        ]

        if not new_items:
            return

        # Group by section
        new_by_section = {}
        for item in new_items:
            if item.section_title not in new_by_section:
                new_by_section[item.section_title] = []
            new_by_section[item.section_title].append(item)

        # Insert after each section's last item
        lines = self.original_lines
        insert_index = len(lines)

        for section in doc.sections:
            if section.title in new_by_section:
                # Find last item in section
                section_items = self._find_all_items_in_section(section)
                if section_items:
                    last_item = section_items[-1]
                    insert_index = last_item.line_number

                    # Find where to insert (after the item's line)
                    # Need to handle nested items
                    while insert_index < len(lines):
                        if insert_index + 1 < len(lines) and lines[
                            insert_index + 1
                        ].strip().startswith("-"):
                            # Next is also a checklist item, might be child
                            insert_index += 1
                        else:
                            break
                    insert_index += 1
                else:
                    # Section has no items, find section header
                    insert_index = section.line_number

                # Insert new items
                for item in new_by_section[section.title]:
                    indent = "  " if item.parent_key else ""
                    status_char = self._get_status_char(item.status)
                    jira_comment = (
                        f" <!-- JIRA: {item.jira_key} -->" if item.jira_key else ""
                    )

                    new_line = f"{indent}- [{status_char}] {item.text}{jira_comment}\n"
                    lines.insert(insert_index, new_line)
                    insert_index += 1

        # Write updated file
        with open(self.file_path, "w", encoding="utf-8") as f:
            f.writelines(lines)

        self.original_lines = lines

    def _find_all_items_in_doc(self, doc: TodoDocument) -> List[TodoItem]:
        """Find all items in entire document"""
        items = []
        for section in doc.sections:
            items.extend(self._find_all_items_in_section(section))
        return items

    def _find_all_items_in_section(self, section: TodoSection) -> List[TodoItem]:
        """Find all items in section including nested"""
        items = []
        for item in section.items:
            items.append(item)
            if item.children:
                items.extend(self._find_all_nested_children(item))
        return items
