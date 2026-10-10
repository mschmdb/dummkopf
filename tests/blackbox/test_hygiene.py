"""The suite stays black-box: it never imports the implementation and each file stays small."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

SUITE = Path(__file__).resolve().parent
FILES = sorted(SUITE.glob("*.py"))
IMPORT_LINE = re.compile(r"^\s*(?:import|from)\s+dummkopf\b", re.MULTILINE)
MAX_LINES = 500


def test_the_suite_has_test_files_to_scan() -> None:
    assert len(FILES) > 5


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.name)
def test_no_file_imports_dummkopf_by_text(path: Path) -> None:
    assert IMPORT_LINE.search(path.read_text(encoding="utf-8")) is None


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.name)
def test_no_file_imports_dummkopf_by_syntax_tree(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.append(node.module)
    assert [name for name in names if name.split(".")[0] == "dummkopf"] == []


@pytest.mark.parametrize("path", FILES, ids=lambda path: path.name)
def test_every_file_stays_under_500_lines(path: Path) -> None:
    assert len(path.read_text(encoding="utf-8").splitlines()) < MAX_LINES
