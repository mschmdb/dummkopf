"""Link checks for write packets: no dead links, no links across sensitivity or scope barriers."""

from __future__ import annotations

import posixpath
import re
from collections.abc import Mapping
from dataclasses import replace
from pathlib import PurePosixPath
from typing import NotRequired, TypedDict
from urllib.parse import unquote, urlsplit

from dummkopf.access import Access, Note
from dummkopf.errors import AccessDenied
from dummkopf.files import inside_without_symlinks
from dummkopf.messages import text as say

ALLOWED_SCHEMES = ("http", "https", "mailto")
# Longer lines are skipped: link regexes are cheap per line, but a line of 80 000 `[` would make them crawl.
MAX_LINK_LINE = 10_000


class Issue(TypedDict):
    path: str
    code: str
    severity: str
    message: str
    line: NotRequired[int]


def issue(path: str, code: str, message: str, severity: str = "error", line: int | None = None) -> Issue:
    result = Issue(path=path, code=code, severity=severity, message=message)
    if line:
        result["line"] = line
    return result


MARKDOWN_LINK = re.compile(r'!?\[[^\]\n]{0,500}\]\((<[^>\n]{1,1000}>|[^\s)]{1,2000})(?:\s+["\'][^)\n]{0,500})?\)')
WIKI_LINK = re.compile(r"\[\[([^\]\n]{1,500})\]\]")


def references(text: str) -> list[str]:
    # Code samples are not links of the note.
    text = re.sub(r"(?ms)^```.*?^```[^\n]*", "", text)
    lines = [re.sub(r"`[^`\n]*`", "", line) for line in text.split("\n") if len(line) <= MAX_LINK_LINE]
    markdown = [value for line in lines for value in MARKDOWN_LINK.findall(line)]
    wiki = ["wiki:" + value.split("|")[0] for line in lines for value in WIKI_LINK.findall(line)]
    return [value.strip("<>") for value in markdown] + wiki


def reference_line(text: str, reference: str) -> int | None:
    needle = "[[" + reference[5:] if reference.startswith("wiki:") else "](" + reference
    for number, line in enumerate(text.splitlines(), 1):
        if needle in line or "(<" + reference + ">" in line:
            return number
    return None


HINTS = {"link-unavailable": "hint_link_unavailable", "link-scope": "hint_link_scope"}


def allowed_outside(access: Access, rel: str) -> bool:
    """An existing file, no symlink on the way, under a folder listed in links.allow_outside.

    The owner declared these folders public, so a link there reveals nothing hidden.
    """
    folders = [folder.rstrip("/") for folder in access.config.links.allow_outside]
    if not any(rel.startswith(folder + "/") for folder in folders):
        return False
    path = access.root / rel
    return path.is_file() and inside_without_symlinks(access.root, path)


def readable(access: Access, rel: str, overlay: Mapping[str, str]) -> bool:
    try:
        if rel in overlay:
            access.preview(rel, overlay[rel], overlay)
        else:
            access.read(rel)
    except AccessDenied:
        return False
    return True


def crosses_barrier(barriers: tuple[str, ...], note: Note, source: Note) -> bool:
    """`work>private` in scopes.link_barriers: a work note must not link to a private one."""
    return note.scope + ">" + source.scope in barriers


def link_issues(access: Access, note: Note, overlay: Mapping[str, str],
                previous: Note | None = None) -> list[Issue]:
    """Security problems are always errors; other problems only for links new in this write.

    A missing target and a hidden target give the same issue, so a link check never reveals
    that a sensitive or out-of-scope note exists.
    """
    layout = access.config.layout
    problems: list[Issue] = []
    old = set(references(previous.text)) if previous else set()
    for reference in references(note.text):
        def problem(code: str, key: str, security: bool = False, ref: str = reference) -> None:
            severity = "error" if security or ref not in old else "warning"
            problems.append(issue(note.path, code, say(key, "plain"), severity, reference_line(note.text, ref)))

        if reference.startswith("#"):
            continue
        if reference.startswith("wiki:"):
            name = reference[5:].split("#")[0]
            candidates = {path for path in set(access.paths()).union(overlay)
                          if PurePosixPath(path).stem == name or path in (name, name + ".md")}
            for candidate in (layout.topics + "/" + name + "/" + layout.topic_readme,
                              layout.notes + "/" + name + ".md", layout.bookmarks + "/" + name + ".md"):
                if candidate in overlay or (access.root / candidate).is_file():
                    candidates.add(candidate)
            candidates = {path for path in candidates if readable(access, path, overlay)}
            if len(candidates) != 1:
                problem("link-unavailable", "link_unavailable")
                continue
            rel = next(iter(candidates))
        else:
            try:
                parsed = urlsplit(reference)
            except ValueError:
                problem("link-invalid", "link_scheme", security=True)
                continue
            if parsed.scheme in ALLOWED_SCHEMES:
                continue
            if parsed.scheme or parsed.netloc:
                problem("link-invalid", "link_scheme", security=True)
                continue
            target = unquote(parsed.path)
            if not target:
                continue
            # Normalize without following symlinks: a symlink must look like any other unavailable target.
            joined = posixpath.normpath(posixpath.join(posixpath.dirname(note.path), target))
            if joined == ".." or joined.startswith("../") or posixpath.isabs(joined):
                problem("link-invalid", "link_escapes", security=True)
                continue
            rel = joined
        # Anything that is not a readable note answers like a missing file: folders of hidden topics,
        # files outside the note folders, .git. Otherwise a link check would map the repository.
        target_path = access.root / rel
        if rel not in overlay:
            if not PurePosixPath(rel).parts or PurePosixPath(rel).parts[0] not in layout.roots:
                if not allowed_outside(access, rel):
                    problem("link-unavailable", "link_unavailable")
                continue
            if target_path.is_dir():
                rel = rel + "/" + layout.topic_readme
                target_path = access.root / rel
            if rel not in overlay and not target_path.is_file():
                problem("link-unavailable", "link_unavailable")
                continue
        try:
            if rel in overlay:
                source = access.preview(rel, overlay[rel], overlay)
            elif target_path.suffix == ".md":
                source = access.read(rel)
            else:
                # A stand-in note carries the folder rules; the paths file lists the real target.
                source = access.preview(rel + ".md", "# Link\n", overlay)
                if access.sensitivity.is_listed(rel):
                    if not access.is_granted(rel):
                        raise AccessDenied("path_denied")
                    source = replace(source, sensitive=True)
            if (source.sensitive and not note.sensitive) or crosses_barrier(
                    access.config.scopes.link_barriers, note, source):
                problem("link-scope", "link_scope", security=True)
        except AccessDenied:
            problem("link-unavailable", "link_unavailable")
    return problems
