#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
from collections.abc import Iterable
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect import cycles inside a Python package tree."
    )
    parser.add_argument(
        "--source",
        default="backend/app",
        help="Directory containing Python modules to analyze.",
    )
    parser.add_argument(
        "--package-root",
        default="backend",
        help="Directory used as the import package root for module names.",
    )
    return parser.parse_args()


def iter_python_files(source_dir: Path) -> Iterable[Path]:
    return sorted(
        path for path in source_dir.rglob("*.py") if "__pycache__" not in path.parts
    )


def module_name(path: Path, package_root: Path) -> str:
    parts = list(path.relative_to(package_root).with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def closest_known_module(name: str, known_modules: set[str]) -> str | None:
    parts = name.split(".")
    for idx in range(len(parts), 0, -1):
        candidate = ".".join(parts[:idx])
        if candidate in known_modules:
            return candidate
    return None


def build_graph(source_dir: Path, package_root: Path) -> dict[str, set[str]]:
    modules = {
        module_name(path, package_root): path for path in iter_python_files(source_dir)
    }
    known_modules = set(modules)
    graph: dict[str, set[str]] = {module: set() for module in modules}

    for module, path in modules.items():
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue

        package_parts = module.split(".")[:-1]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target = closest_known_module(alias.name, known_modules)
                    if target:
                        graph[module].add(target)
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0:
                    anchor_parts: list[str] = []
                else:
                    levels_up = node.level - 1
                    if levels_up > len(package_parts):
                        continue
                    anchor_parts = package_parts[: len(package_parts) - levels_up]

                base_name: str | None = None
                if node.module:
                    base_name = ".".join(anchor_parts + node.module.split("."))
                    target = closest_known_module(base_name, known_modules)
                    if target:
                        graph[module].add(target)

                for alias in node.names:
                    if alias.name == "*":
                        continue
                    if base_name:
                        candidate = f"{base_name}.{alias.name.split('.')[0]}"
                    else:
                        candidate = ".".join(anchor_parts + [alias.name.split(".")[0]])
                    target = closest_known_module(candidate, known_modules)
                    if target:
                        graph[module].add(target)

    return graph


def strongly_connected_components(graph: dict[str, set[str]]) -> list[list[str]]:
    index = 0
    stack: list[str] = []
    on_stack: set[str] = set()
    indices: dict[str, int] = {}
    low_link: dict[str, int] = {}
    components: list[list[str]] = []

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = index
        low_link[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)

        for dependency in graph[node]:
            if dependency not in indices:
                visit(dependency)
                low_link[node] = min(low_link[node], low_link[dependency])
            elif dependency in on_stack:
                low_link[node] = min(low_link[node], indices[dependency])

        if low_link[node] == indices[node]:
            component: list[str] = []
            while True:
                current = stack.pop()
                on_stack.remove(current)
                component.append(current)
                if current == node:
                    break
            components.append(sorted(component))

    for module in sorted(graph):
        if module not in indices:
            visit(module)

    return components


def find_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    cycles: list[list[str]] = []
    for component in strongly_connected_components(graph):
        if len(component) > 1:
            cycles.append(component)
        elif component and component[0] in graph[component[0]]:
            cycles.append(component)
    return cycles


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source).resolve()
    package_root = Path(args.package_root).resolve()
    graph = build_graph(source_dir, package_root)
    cycles = find_cycles(graph)
    edge_count = sum(len(deps) for deps in graph.values())

    print(f"Scanned {len(graph)} modules with {edge_count} internal imports.")
    if not cycles:
        print("No backend import cycles detected.")
        return 0

    print(f"Detected {len(cycles)} backend import cycle(s):")
    for cycle in cycles:
        print(f"- {' -> '.join(cycle + [cycle[0]])}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
