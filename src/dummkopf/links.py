"""Link checks for write packets: no dead links, no links across sensitivity or scope barriers."""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import NotRequired, TypedDict
from urllib.parse import unquote, urlsplit

from dummkopf.access import Access, Note
from dummkopf.errors import AccessDenied
from dummkopf.messages import text as say

ALLOWED_SCHEMES = ("http", "https", "mailto")


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


def references(text: str) -> list[str]:
    # Code samples are not links of the note.
    text = re.sub(r"(?ms)^```.*?^```[^\n]*", "", text)
    text = re.sub(r"`[^`\n]*`", "", text)
    markdown = re.findall(r'!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["\'][^)]*)?\)', text)
    wiki = ["wiki:" + value.split("|")[0] for value in re.findall(r"\[\[([^\]\n]+)\]\]", text)]
    return [value.strip("<>") for value in markdown] + wiki


def reference_line(text: str, reference: str) -> int | None:
    needle = "[[" + reference[5:] if reference.startswith("wiki:") else "](" + reference
    for number, line in enumerate(text.splitlines(), 1):
        if needle in line or "(<" + reference + ">" in line:
            return number
    return None


HINTS = {"link-denied": "hint_link_denied", "link-scope": "hint_link_scope", "link-missing": "hint_link_missing"}


def crosses_barrier(barriers: tuple[str, ...], note: Note, source: Note) -> bool:
    """`work>private` in scopes.link_barriers: a work note must not link to a private one."""
    return note.scope + ">" + source.scope in barriers


def link_issues(access: Access, note: Note, overlay: Mapping[str, str],
                previous: Note | None = None) -> list[Issue]:
    """Security problems are always errors; other problems only for links new in this write."""
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
            if len(candidates) != 1:
                problem("link-missing", "link_wiki_missing")
                continue
            rel = next(iter(candidates))
        else:
            parsed = urlsplit(reference)
            if parsed.scheme in ALLOWED_SCHEMES:
                continue
            if parsed.scheme or parsed.netloc:
                problem("link-denied", "link_scheme", security=True)
                continue
            target = unquote(parsed.path)
            if not target:
                continue
            path = (access.root / PurePosixPath(note.path).parent / target).resolve()
            if not path.is_relative_to(access.root):
                problem("link-denied", "link_escapes", security=True)
                continue
            rel = path.relative_to(access.root).as_posix()
        target_path = access.root / rel
        if rel not in overlay and not target_path.exists():
            problem("link-missing", "link_missing")
            continue
        if PurePosixPath(rel).parts[0] not in layout.roots:
            continue
        try:
            if rel in overlay:
                source = access.preview(rel, overlay[rel], overlay)
            elif target_path.suffix == ".md":
                source = access.read(rel)
            else:
                source = access.preview(rel + ".md", "# Link\n", overlay)
            if (source.sensitive and not note.sensitive) or crosses_barrier(
                    access.config.scopes.link_barriers, note, source):
                problem("link-scope", "link_scope", security=True)
        except AccessDenied:
            problem("link-denied", "link_denied", security=True)
    return problems
