"""Read gate: every note read passes scope, sensitivity and path checks here."""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from dummkopf.config import Config
from dummkopf.errors import AccessDenied
from dummkopf.files import SKILL_FILE, iter_note_files
from dummkopf.frontmatter import parse_frontmatter
from dummkopf.sensitive import Sensitivity

TOPIC_RE = re.compile(r"[\w-]+")


@dataclass(frozen=True)
class Note:
    path: str
    text: str
    body: str
    title: str
    updated: str
    status: str
    scope: str
    key_fact: str
    aliases: tuple[str, ...]
    revision: str
    sensitive: bool


def exact_spelling(root: Path, rel: str) -> bool:
    """On case-insensitive file systems `Topics/X.md` opens `topics/x.md`; insist on the on-disk spelling."""
    current = root
    for part in PurePosixPath(rel).parts:
        candidate = current / part
        if not candidate.exists():
            return True
        try:
            if part not in os.listdir(current):
                return False
        except OSError:
            return False
        current = candidate
    return True


def denied() -> AccessDenied:
    """One message for missing, sensitive and out-of-scope paths, so nothing leaks."""
    return AccessDenied("path_denied")


class Access:
    def __init__(self, config: Config, scope: str | None = None, topic: str | None = None,
                 allow_sensitive: Sequence[str] = ()) -> None:
        self.config = config
        self.root = config.root
        self.scope = config.scopes.query_default if scope is None else scope
        if self.scope not in config.scopes.choices:
            raise AccessDenied("invalid_scope", choices=", ".join(config.scopes.choices))
        if topic is not None and not TOPIC_RE.fullmatch(topic):
            raise AccessDenied("invalid_topic")
        self.topic = topic
        self.allowed = tuple(self._grant(value) for value in allow_sensitive)
        paths_file = self.root / config.sensitive.paths_file
        if not paths_file.is_file() or paths_file.is_symlink():
            raise AccessDenied("sensitive_list_missing", file=config.sensitive.paths_file)
        try:
            self.sensitivity = Sensitivity.load(config)
        except (OSError, UnicodeError) as error:
            raise AccessDenied("sensitive_list_missing", file=config.sensitive.paths_file) from error
        self._texts: dict[Path, tuple[int, int, str]] = {}

    def with_grants(self, grants: Sequence[str]) -> Access:
        return Access(self.config, self.scope, self.topic, grants)

    def relative(self, value: str) -> str:
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or "\\" in value:
            raise denied()
        if len(path.parts) < 2 or path.parts[0] not in self.config.layout.roots:
            raise denied()
        return path.as_posix().rstrip("/")

    def _grant(self, value: str) -> str:
        rel = self.relative(value)
        if PurePosixPath(rel).parts[0] != self.config.layout.topics and not rel.endswith(".md"):
            raise AccessDenied("grant_needs_path")
        return rel

    def is_granted(self, rel: str) -> bool:
        return any(rel == grant or rel.startswith(grant + "/") for grant in self.allowed)

    def _text(self, path: Path) -> str:
        stat = path.stat()
        cached = self._texts.get(path)
        if cached and cached[:2] == (stat.st_mtime_ns, stat.st_size):
            return cached[2]
        text = path.read_bytes().decode("utf-8")
        self._texts[path] = (stat.st_mtime_ns, stat.st_size, text)
        return text

    def resolve(self, rel: str, allow_new: bool = False) -> Path:
        """Absolute path for a relative note path; rejects symlinks, skill folders and escapes."""
        path = self.root / rel
        if not exact_spelling(self.root, rel):
            raise denied()
        if path.suffix != ".md" or (not allow_new and not path.is_file()) or path.is_dir():
            raise denied()
        for candidate in (path, *path.parents):
            if candidate == self.root:
                break
            if candidate != path and candidate.exists() and not candidate.is_dir():
                raise denied()
            if candidate.is_symlink() or (candidate.is_dir() and (candidate / SKILL_FILE).exists()):
                raise denied()
        if path.name == SKILL_FILE or not path.resolve().is_relative_to(self.root):
            raise denied()
        return path

    def read(self, value: str) -> Note:
        return self._read(value, {})

    def preview(self, value: str, text: str, overlay: Mapping[str, str]) -> Note:
        """Read a note as it would look after a write package, without touching disk."""
        return self._read(value, {**overlay, value: text})

    def _read(self, value: str, overlay: Mapping[str, str]) -> Note:
        config = self.config
        fm = config.frontmatter
        rel = self.relative(value)
        if self.topic and not rel.startswith(config.layout.topics + "/" + self.topic + "/"):
            raise denied()
        path = self.resolve(rel, allow_new=rel in overlay)
        listed = self.sensitivity.is_listed(rel)
        granted = self.is_granted(rel)
        if listed and not granted:
            raise denied()
        try:
            text = overlay[rel] if rel in overlay else self._text(path)
            data, body, _ = parse_frontmatter(text)
            scope = str(data.get(fm.scope) or "")
            sensitive = self.sensitivity.has_marker(text)
            for parent in path.parents:
                if parent == self.root:
                    break
                readme = parent / config.layout.topic_readme
                key = readme.relative_to(self.root).as_posix()
                if readme == path or (key not in overlay and not readme.exists()):
                    continue
                if readme.is_symlink():
                    raise denied()
                parent_text = overlay[key] if key in overlay else self._text(readme)
                sensitive = sensitive or self.sensitivity.has_marker(parent_text)
                scope = scope or str(parse_frontmatter(parent_text)[0].get(fm.scope) or "")
        except (OSError, UnicodeError) as error:
            raise denied() from error
        if sensitive and not granted:
            raise denied()
        if scope and scope not in config.scopes.values:
            raise denied()
        if self.scope != config.scopes.all and scope and scope != self.scope:
            raise denied()
        aliases = data.get(fm.aliases) or []
        alias_list = aliases if isinstance(aliases, list) else [aliases]
        title = next((line.lstrip("# ").strip() for line in body.splitlines() if line.startswith("# ")),
                     path.stem)
        return Note(rel, text, body, title, str(data.get(fm.updated) or ""), str(data.get(fm.status) or ""),
                    scope or config.scopes.mixed_label, str(data.get(fm.key_fact) or ""),
                    tuple(str(alias) for alias in alias_list),
                    hashlib.sha256(text.encode("utf-8")).hexdigest(), listed or sensitive)

    def paths(self) -> list[str]:
        """Candidate note paths; listed sensitive paths are dropped unless something was granted."""
        layout = self.config.layout
        prefix = layout.topics + "/" + self.topic + "/" if self.topic else ""
        found = [rel for rel in iter_note_files(self.config) if rel.startswith(prefix)]
        if self.allowed:
            return found
        return [rel for rel in found if not self.sensitivity.is_listed(rel)]
