"""Markdown table and section helpers for generated indexes."""

from __future__ import annotations

import re
from collections.abc import Sequence

BACKTICK_RE = re.compile(r"^`([^`]+)`$")


def split_row(line: str) -> list[str] | None:
    line = line.strip()
    if not line.startswith("|"):
        return None
    line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line)]


def scrape_rows(text: str) -> dict[str, tuple[str, list[str]]]:
    """Table rows whose first cell is a backticked path: path -> (description, aliases)."""
    rows: dict[str, tuple[str, list[str]]] = {}
    for line in text.split("\n"):
        cells = split_row(line)
        if not cells or len(cells) < 2:
            continue
        match = BACKTICK_RE.match(cells[0])
        if not match:
            continue
        aliases = cells[2] if len(cells) > 2 else ""
        rows.setdefault(match.group(1), (cells[1].strip(),
                                         [alias.strip() for alias in aliases.split(",") if alias.strip()]))
    return rows


def cell(value: str) -> str:
    return value.replace("|", "\\|").strip()


def table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(["---"] * len(header)) + "|"]
    out.extend("| " + " | ".join(cell(value) for value in row) + " |" for row in rows)
    return out


def section_bounds(lines: Sequence[str], heading: str) -> tuple[int, int] | None:
    """(start, end) of a `## ` section including its heading line, or None."""
    for i, line in enumerate(lines):
        if line.strip() == heading:
            for j in range(i + 1, len(lines)):
                if lines[j].startswith("## "):
                    return i, j
            return i, len(lines)
    return None


def replace_table(lines: list[str], heading: str, new_table: list[str]) -> None:
    """Swap only the first table of a section; prose around it stays."""
    bounds = section_bounds(lines, heading)
    if not bounds:
        return
    start, end = bounds
    first: int | None = None
    last = 0
    for k in range(start + 1, end):
        if lines[k].lstrip().startswith("|"):
            if first is None:
                first = k
            last = k + 1
        elif first is not None:
            break
    if first is None:
        insert = end
        while insert > start + 1 and not lines[insert - 1].strip():
            insert -= 1
        lines[insert:insert] = ["", *new_table]
    else:
        lines[first:last] = new_table


def drop_section(lines: list[str], heading: str) -> list[str]:
    """Remove a section and a `---` rule right above it."""
    bounds = section_bounds(lines, heading)
    if not bounds:
        return lines
    start, end = bounds
    probe = start - 1
    while probe >= 0 and not lines[probe].strip():
        probe -= 1
    if probe >= 0 and lines[probe].strip() == "---":
        start = probe
    rest = lines[:start] + lines[end:]
    while rest and not rest[-1].strip():
        rest.pop()
    return [*rest, ""]


def authored_text(text: str, files_heading: str) -> str:
    """Text without the generated file table, so regenerated tables never count as edits."""
    lines = text.splitlines()
    bounds = section_bounds(lines, files_heading)
    if not bounds:
        return "\n".join(lines).rstrip()
    start, end = bounds
    content = [line for line in lines[start + 1:end] if not line.lstrip().startswith("|")]
    if any(line.strip() for line in content):
        lines = lines[:start + 1] + content + lines[end:]
    else:
        lines = lines[:start] + lines[end:]
    return "\n".join(lines).rstrip()
