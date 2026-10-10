"""Which Markdown files count as notes, and small Git date helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path

from dummkopf.config import Config, LayoutConfig

SKILL_FILE = "SKILL.md"


def skill_dirs(config: Config) -> frozenset[str]:
    """Folders holding a SKILL.md ship agent skills; dummkopf never touches them."""
    found: set[str] = set()
    for base in config.layout.roots:
        directory = config.root / base
        if directory.is_dir() and not directory.is_symlink():
            found.update(skill.parent.relative_to(config.root).as_posix() + "/"
                         for skill in directory.rglob(SKILL_FILE))
    return frozenset(found)


def inside_without_symlinks(root: Path, path: Path) -> bool:
    """True if neither the path nor a folder between it and root is a symlink."""
    current = path
    while current != root:
        if current.is_symlink():
            return False
        current = current.parent
    return True


def iter_note_files(config: Config) -> list[str]:
    """Note files under the note folders. Symlinks never count: a cloned brain may point anywhere."""
    skills = skill_dirs(config)
    found: list[str] = []
    for base in config.layout.roots:
        directory = config.root / base
        if directory.is_dir() and not directory.is_symlink():
            found.extend(path.relative_to(config.root).as_posix() for path in directory.rglob("*.md")
                         if path.is_file() and inside_without_symlinks(config.root, path))
    return sorted(rel for rel in found if not any(rel.startswith(skill) for skill in skills))


def topic_of(rel: str, layout: LayoutConfig) -> str:
    """`<topics>/<name>` for topic files, the full path for flat notes and bookmarks."""
    parts = rel.split("/")
    if parts[0] == layout.topics and len(parts) >= 2:
        return parts[0] + "/" + parts[1]
    return rel


def is_topic_readme(rel: str, layout: LayoutConfig) -> bool:
    parts = rel.split("/")
    return len(parts) == 3 and parts[0] == layout.topics and parts[2] == layout.topic_readme


def git_last_date(root: Path, rel: str, timeout: float = 30) -> str:
    """Committer date (YYYY-MM-DD) of the last commit touching rel, or '' if unknown."""
    try:
        done = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel], cwd=root,
                              capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    lines = done.stdout.strip().splitlines()
    return lines[0] if done.returncode == 0 and lines else ""
