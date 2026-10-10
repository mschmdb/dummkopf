"""Curator extra: a deterministic scan for an LLM-written weekly report.

Finds open loops, topics without movement, conflicting "as of" dates and stale active
notes. Read-only, no network. Sensitive notes are left out and only counted.
"""

from __future__ import annotations

import datetime as dt
import re
from importlib.resources import files
from typing import TypedDict

from dummkopf.config import Config
from dummkopf.extras.common import age, open_notes, read_note, require, topic_folders
from dummkopf.locale import get_locale
from dummkopf.messages import text as say

MAX_LINES = 3
LINE_WIDTH = 120


class OpenLoop(TypedDict):
    path: str
    updated: str
    lines: list[str]


class Dated(TypedDict):
    path: str
    updated: str


class Conflict(TypedDict):
    path: str
    dates: list[str]


class CuratorScan(TypedDict):
    open_loops: list[OpenLoop]
    stale_topics: list[Dated]
    conflicting_dates: list[Conflict]
    stale_active: list[Dated]
    sensitive_files: int
    sensitive_topics: int


def open_pattern(config: Config) -> re.Pattern[str]:
    words = get_locale(config.ui.locale).open_words
    return re.compile(r"\b(?:" + "|".join(re.escape(word) for word in words) + r")\b", re.IGNORECASE)


def scan(config: Config, open_days: int | None = None, stale_days: int | None = None) -> CuratorScan:
    require(config, "curator")
    today = dt.date.today()
    open_limit = today - dt.timedelta(days=config.curator.open_days if open_days is None else open_days)
    stale_limit = today - dt.timedelta(days=config.curator.stale_days if stale_days is None else stale_days)
    pattern = open_pattern(config)
    label = get_locale(config.ui.locale).updated_label
    notes = open_notes(config)
    loops: list[OpenLoop] = []
    conflicts: list[Conflict] = []
    stale_active: list[Dated] = []
    newest: dict[str, tuple[dt.date, str]] = {}
    for rel in notes.files:
        data, body, text = read_note(config, rel)
        resolved = age(config, rel, data)
        if pattern.search(body) and resolved and resolved[0] < open_limit:
            lines: list[str] = []
            for line in body.splitlines():
                stripped = line.strip()
                if stripped and stripped not in lines and pattern.search(line):
                    lines.append(stripped[:LINE_WIDTH])
                if len(lines) >= MAX_LINES:
                    break
            loops.append(OpenLoop(path=rel, updated=resolved[1], lines=lines))
        dates = list(dict.fromkeys(match.group(1) for match in label.finditer(text)))
        if len(dates) >= 2:
            conflicts.append(Conflict(path=rel, dates=dates))
        updated = data.get(config.frontmatter.updated)
        if (data.get(config.frontmatter.status) == config.status.active and isinstance(updated, str)
                and resolved and resolved[1] == updated and resolved[0] < stale_limit):
            stale_active.append(Dated(path=rel, updated=updated))
        if rel.startswith(config.layout.topics + "/") and resolved:
            topic = "/".join(rel.split("/")[:2])
            if topic not in newest or resolved[0] > newest[topic][0]:
                newest[topic] = resolved
    stale_topics = [Dated(path=topic + "/", updated=newest[topic][1]) for topic in topic_folders(config)
                    if topic in newest and newest[topic][0] < stale_limit]
    return CuratorScan(open_loops=sorted(loops, key=lambda item: item["path"]), stale_topics=stale_topics,
                       conflicting_dates=sorted(conflicts, key=lambda item: item["path"]),
                       stale_active=sorted(stale_active, key=lambda item: item["path"]),
                       sensitive_files=notes.sensitive_files, sensitive_topics=notes.sensitive_topics)


def render_markdown(result: CuratorScan) -> str:
    none = say("curator_none", "plain")
    lines = ["# " + say("curator_title", "plain"), "", "## " + say("curator_open_loops", "plain"), ""]
    for loop in result["open_loops"]:
        lines.append(f"- `{loop['path']}` ({loop['updated']})")
        lines += ["  - " + line for line in loop["lines"]]
    lines += [none] if not result["open_loops"] else []
    lines += ["", "## " + say("curator_stale_topics", "plain"), ""]
    lines += [f"- `{item['path']}` ({item['updated']})" for item in result["stale_topics"]] or [none]
    lines += ["", "## " + say("curator_conflicts", "plain"), ""]
    lines += [f"- `{item['path']}`: {', '.join(item['dates'])}" for item in result["conflicting_dates"]] or [none]
    lines += ["", "## " + say("curator_stale_active", "plain"), ""]
    lines += [f"- `{item['path']}` ({item['updated']})" for item in result["stale_active"]] or [none]
    lines += ["", say("curator_skipped", "plain", files=result["sensitive_files"],
                      topics=result["sensitive_topics"])]
    return "\n".join(lines) + "\n"


def prompt(config: Config) -> str:
    """The weekly LLM prompt, filled with this brain's folders, keys and marker."""
    template = files("dummkopf").joinpath("templates", "curator-prompt.md").read_text(encoding="utf-8")
    fm = config.frontmatter
    values = {
        "report_dir": config.curator.report_dir.rstrip("/") + "/",
        "links_file": config.links.output,
        "updated": fm.updated, "status": fm.status, "key_fact": fm.key_fact, "summary": fm.summary,
        "aliases": fm.aliases, "period": fm.period, "entities": fm.entities,
        "active": config.status.active, "marker": config.sensitive.marker,
        "paths_file": config.sensitive.paths_file,
    }
    for key, value in values.items():
        template = template.replace("{" + key + "}", value)
    return template
