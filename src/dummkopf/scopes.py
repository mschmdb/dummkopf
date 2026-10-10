"""Effective scope of a note, computed without the read gate, for write and index checks."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path, PurePosixPath

from dummkopf.config import Config
from dummkopf.frontmatter import parse_frontmatter


def read_raw(path: Path) -> str | None:
    """File text, or None if missing, a symlink or unreadable."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None


def effective_scope(config: Config, rel: str, overlay: Mapping[str, str] | None = None) -> str:
    """The note's own scope, else the nearest README's. An empty string means mixed."""
    pending = overlay or {}
    path = PurePosixPath(rel)
    keys = [rel] + [(parent / config.layout.topic_readme).as_posix() for parent in path.parents if parent.parts]
    for key in dict.fromkeys(keys):
        text = pending[key] if key in pending else read_raw(config.root / key)
        if text is None:
            continue
        value = parse_frontmatter(text)[0].get(config.frontmatter.scope)
        if isinstance(value, str) and value:
            return value
    return ""
