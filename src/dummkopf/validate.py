"""Validate write packets: structure, versions, metadata, paths, scope and sensitivity."""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from dummkopf.access import Access, Note
from dummkopf.config import Config
from dummkopf.errors import AccessDenied, Rejected
from dummkopf.frontmatter import KEY_RE, Data, dump_frontmatter, parse_frontmatter, shorten
from dummkopf.links import HINTS, Issue, issue, link_issues
from dummkopf.locale import get_locale
from dummkopf.messages import text as say
from dummkopf.tables import authored_text

EXPECTED_RE = re.compile(r"[a-f0-9]{12,64}")
KEBAB_RE = re.compile(r"[^\W_]+(?:-[^\W_]+)*")
ENTRY_KEYS = {"path", "content", "replace", "append", "expected", "metadata"}
CONTENT_KEYS = ("content", "replace", "append")


@dataclass(frozen=True)
class Change:
    note: Note
    previous: Note | None
    expected: str | None


@dataclass(frozen=True)
class Plan:
    changes: list[Change]
    issues: list[Issue]


def today() -> str:
    return dt.date.today().isoformat()


def is_source(rel: str, config: Config) -> bool:
    return config.layout.sources in PurePosixPath(rel).parts


def metadata_issues(note: Note, config: Config) -> list[Issue]:
    fm = config.frontmatter
    data, body, present = parse_frontmatter(note.text)
    problems: list[Issue] = []
    if not present:
        problems.append(issue(note.path, "frontmatter", say("missing_frontmatter", "plain")))
    try:
        dt.date.fromisoformat(str(data.get(fm.updated, "")))
    except ValueError:
        problems.append(issue(note.path, fm.updated, say("bad_updated", "plain", key=fm.updated)))
    for key in (fm.status, fm.key_fact, fm.summary):
        value = data.get(key)
        if not isinstance(value, str) or not value.strip() or value.strip() == fm.todo_placeholder:
            problems.append(issue(note.path, key, say("missing_text", "plain", key=key)))
    for key in fm.list_keys:
        if not isinstance(data.get(key), list):
            problems.append(issue(note.path, key, say("needs_list", "plain", key=key)))
    has_heading = any(line.startswith("# ") and line[2:].strip() for line in body.splitlines())
    if not body.strip() or (not is_source(note.path, config) and not has_heading):
        problems.append(issue(note.path, "body", say("missing_body", "plain")))
    return problems


def check_metadata(data: Mapping[str, Any]) -> None:
    for key, value in data.items():
        match = KEY_RE.match(key + ": x") if isinstance(key, str) else None
        values = value if isinstance(value, list) else [value]
        if (match is None or match[1] != key or not isinstance(value, str | list)
                or any(not isinstance(item, str) or any(char in item for char in "\n\r\0") for item in values)):
            raise Rejected("bad_metadata")


def normalize(content: str, metadata: Data, previous: Note | None, config: Config) -> str:
    fm = config.frontmatter
    files_heading = get_locale(config.ui.locale).files_heading
    incoming, body, _ = parse_frontmatter(content)
    old = parse_frontmatter(previous.text)[0] if previous else {}
    check_metadata({**incoming, **metadata})
    data: Data = {**old, **incoming, **metadata}
    if previous is None:
        body_changed = True
    elif PurePosixPath(previous.path).name == config.layout.topic_readme:
        body_changed = authored_text(body, files_heading) != authored_text(previous.body, files_heading)
    else:
        body_changed = body != previous.body
    metadata_changed = any(old.get(key) != value for key, value in {**incoming, **metadata}.items()
                           if key != fm.updated)
    if fm.updated not in incoming and fm.updated not in metadata and (body_changed or metadata_changed):
        data[fm.updated] = today()
    data.setdefault(fm.status, config.status.active)
    for key in fm.list_keys:
        data.setdefault(key, [])
    if fm.key_fact in data:
        summary = shorten(str(data[fm.key_fact]), fm.summary_max)
        if fm.key_fact in metadata and fm.summary not in metadata:
            data[fm.summary] = summary
        else:
            data.setdefault(fm.summary, summary)
    return dump_frontmatter(data) + body


def same_revision(previous: Note, expected: str | None) -> bool:
    return expected is not None and previous.revision.startswith(expected)


def appended_content(previous: Note | None, block: object, expected: str | None) -> str:
    if previous is None or not isinstance(block, str) or not block.strip():
        raise Rejected("append_needs")
    addition = block.strip("\n") + "\n"
    # A repeated package after a successful write must not append twice.
    if not same_revision(previous, expected) and previous.text.endswith("\n" + addition):
        return previous.text
    return previous.text.rstrip("\n") + "\n\n" + addition


def replaced_content(previous: Note | None, pairs: object, metadata: Data, expected: str | None,
                     limit: int) -> str:
    if previous is None or not isinstance(pairs, list) or not 1 <= len(pairs) <= limit:
        raise Rejected("replace_needs", max=limit)
    for pair in pairs:
        if (not isinstance(pair, dict) or set(pair) != {"old", "new"} or not isinstance(pair["old"], str)
                or not pair["old"] or not isinstance(pair["new"], str)):
            raise Rejected("replace_pair")
    current = parse_frontmatter(previous.text)[0]
    already_applied = (not same_revision(previous, expected)
                       and all(previous.text.count(pair["old"]) == 0
                               and (not pair["new"] or previous.text.count(pair["new"]) >= 1) for pair in pairs)
                       and all(current.get(key) == value for key, value in metadata.items()))
    if already_applied:
        return previous.text
    text = previous.text
    for pair in pairs:
        if text.count(pair["old"]) != 1:
            raise Rejected("replace_ambiguous")
        text = text.replace(pair["old"], pair["new"], 1)
    return text


def write_path(access: Access, value: str) -> str:
    layout = access.config.layout
    rel = access.relative(value)
    parts = PurePosixPath(rel).parts
    if parts[0] in layout.flat_roots and len(parts) != 2:
        raise AccessDenied("flat_path", root=parts[0])
    if parts[0] == layout.topics and len(parts) < 3:
        raise AccessDenied("topic_path", root=parts[0])
    for component in parts[1:]:
        stem = component[:-3] if component.endswith(".md") else component
        if component != layout.topic_readme and (stem != stem.lower() or not KEBAB_RE.fullmatch(stem)):
            raise AccessDenied("kebab_case")
    access.resolve(rel, allow_new=True)
    return rel


def add_marker(content: str, marker: str) -> str:
    data, body, _ = parse_frontmatter(content)
    return dump_frontmatter(data) + "\n" + marker + "\n" + body


def entry_fields(item: object) -> dict[str, Any]:
    if (not isinstance(item, dict) or not {"path", "expected"} <= set(item)
            or len(set(item).intersection(CONTENT_KEYS)) != 1 or set(item) - ENTRY_KEYS
            or not isinstance(item["path"], str)
            or ("content" in item and not isinstance(item["content"], str))
            or not isinstance(item.get("metadata", {}), dict)):
        raise Rejected("entry_shape")
    expected = item["expected"]
    if expected is not None and (not isinstance(expected, str) or not EXPECTED_RE.fullmatch(expected)):
        raise Rejected("expected_format")
    return item


def rules_error(problems: list[Issue]) -> Rejected:
    # Name the note path and line from the caller's own package; never the link target.
    errors = [problem for problem in problems if problem["severity"] == "error"]
    codes = ", ".join(sorted({problem["code"] for problem in errors}))
    details = []
    for problem in sorted(errors, key=lambda item: (item["path"], item.get("line", 0))):
        where = problem["path"] + (", " + say("issue_line", "plain", line=problem["line"])
                                   if "line" in problem else "")
        hint = say(HINTS[problem["code"]], "plain") if problem["code"] in HINTS else ""
        details.append("- " + where + ": " + problem["message"] + (" " + hint if hint else ""))
    return Rejected("packet_rules", codes=codes, details="\n".join(details))


def validate_packet(access: Access, packet: object) -> Plan:
    config = access.config
    limit = config.limits.max_changes
    if not isinstance(packet, dict) or set(packet) != {"changes"}:
        raise Rejected("packet_shape")
    items = packet["changes"]
    if not isinstance(items, list) or not 1 <= len(items) <= limit:
        raise Rejected("changes_count", max=limit)
    staged: list[tuple[str, Note | None, str | None]] = []
    overlay: dict[str, str] = {}
    sensitivity = access.sensitivity
    for raw in items:
        item = entry_fields(raw)
        rel = write_path(access, item["path"])
        if rel in overlay:
            raise Rejected("duplicate_path")
        expected: str | None = item["expected"]
        previous = access.read(rel) if (access.root / rel).exists() else None
        metadata: Data = dict(item.get("metadata", {}))
        if "content" in item:
            raw_content = item["content"]
        elif "append" in item:
            raw_content = appended_content(previous, item["append"], expected)
        else:
            raw_content = replaced_content(previous, item["replace"], metadata, expected, limit)
        if "content" not in item and previous and raw_content != previous.text:
            metadata.setdefault(config.frontmatter.updated, today())
        content = normalize(raw_content, metadata, previous, config)
        if (previous and PurePosixPath(rel).name == config.layout.topic_readme
                and authored_text(content, get_locale(config.ui.locale).files_heading)
                == authored_text(previous.text, get_locale(config.ui.locale).files_heading)):
            content = previous.text
        if sensitivity.is_always(rel) and not sensitivity.has_marker(content):
            content = add_marker(content, config.sensitive.marker)
        if previous is None and sensitivity.has_marker(content) and not access.is_granted(rel):
            # The marker comes from the caller; naming the flag reveals nothing foreign.
            raise AccessDenied("new_sensitive", path=rel)
        if previous and previous.text != content:
            if not same_revision(previous, expected):
                raise Rejected("version_conflict", rev=previous.revision[:12])
            if is_source(rel, config):
                raise Rejected("sources_readonly", sources=config.layout.sources)
            if sensitivity.has_marker(previous.text) and not sensitivity.has_marker(content):
                raise Rejected("marker_removal")
        elif previous is None and expected is not None:
            raise Rejected("expected_missing")
        overlay[rel] = content
        staged.append((rel, previous, expected))
    changes: list[Change] = []
    problems: list[Issue] = []
    for rel, previous, expected in staged:
        note = access.preview(rel, overlay[rel], overlay)
        if previous and previous.scope != note.scope:
            raise Rejected("scope_change")
        check_new_topic(access, rel, overlay)
        problems.extend(metadata_issues(note, config))
        problems.extend(link_issues(access, note, overlay, previous))
        changes.append(Change(note, previous, expected))
    if any(problem["severity"] == "error" for problem in problems):
        raise rules_error(problems)
    return Plan(changes, problems)


def check_new_topic(access: Access, rel: str, overlay: Mapping[str, str]) -> None:
    config = access.config
    parts = PurePosixPath(rel).parts
    if parts[0] != config.layout.topics:
        return
    readme = config.layout.topics + "/" + parts[1] + "/" + config.layout.topic_readme
    if (access.root / readme).exists():
        return
    if readme not in overlay:
        raise Rejected("topic_needs_readme", readme=config.layout.topic_readme)
    scope = parse_frontmatter(overlay[readme])[0].get(config.frontmatter.scope)
    if config.scopes.require_on_new_topic and scope not in config.scopes.values:
        raise Rejected("topic_needs_scope", choices=", ".join(config.scopes.values))
