"""Frontmatter is the single source for INDEX.md and the README file tables.

migrate   add or complete frontmatter on notes
generate  rewrite the index tables and each topic README's file table
report    list notes without date, stale active notes and missing key facts
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path

from dummkopf.config import Config
from dummkopf.files import git_last_date, is_source, is_topic_readme, iter_note_files, skill_dirs, write_generated
from dummkopf.frontmatter import Data, dump_frontmatter, parse_frontmatter, shorten
from dummkopf.locale import get_locale
from dummkopf.messages import text as say
from dummkopf.scopes import effective_scope, read_raw
from dummkopf.sensitive import Sensitivity
from dummkopf.tables import drop_section, replace_table, scrape_rows, section_bounds, table


def read_text(path: Path) -> str:
    """Text of a file dummkopf only reads; missing, symlinked or unreadable files count as empty."""
    return read_raw(path) or ""


def topic_dirs(config: Config) -> list[str]:
    base = config.root / config.layout.topics
    if not base.is_dir():
        return []
    skills = skill_dirs(config)
    if base.is_symlink():
        return []
    return sorted(path.name for path in base.iterdir()
                  if path.is_dir() and not path.is_symlink() and (path / config.layout.topic_readme).is_file()
                  and not (path / config.layout.topic_readme).is_symlink()
                  and config.layout.topics + "/" + path.name + "/" not in skills)


def _seed(config: Config, rel: str, index_rows: dict[str, tuple[str, list[str]]],
          cache: dict[str, dict[str, tuple[str, list[str]]]]) -> tuple[str, list[str]] | None:
    """Key fact and aliases from an existing table row, for notes written before frontmatter."""
    if is_topic_readme(rel, config.layout):
        return index_rows.get(config.layout.topics + "/" + rel.split("/")[1] + "/")
    parent = (config.root / rel).parent
    while parent.is_relative_to(config.root) and parent != config.root:
        readme = parent / config.layout.topic_readme
        key = readme.as_posix()
        if key not in cache:
            cache[key] = scrape_rows(read_text(readme))
        if rel in cache[key]:
            return cache[key][rel]
        parent = parent.parent
    return index_rows.get(rel)


def migrate(config: Config, dry_run: bool = False, only: list[str] | None = None) -> list[str]:
    fm = config.frontmatter
    hint = get_locale(config.ui.locale).archive_hint
    index_rows = scrape_rows(read_text(config.root / config.layout.index))
    cache: dict[str, dict[str, tuple[str, list[str]]]] = {}
    changed: list[str] = []
    for rel in iter_note_files(config):
        if (only and rel not in only) or is_source(rel, config.layout):
            continue
        path = config.root / rel
        raw = read_raw(path)
        if raw is None:
            continue  # unreadable: never rewrite what we could not read
        text = raw
        data, body, had = parse_frontmatter(text)
        if not had:
            body = "\n" + text
        if not data.get(fm.updated):
            data[fm.updated] = git_last_date(config.root, rel) or dt.date.today().isoformat()
        if not data.get(fm.status):
            data[fm.status] = config.status.archived if hint in rel.lower() else config.status.active
        if not data.get(fm.key_fact):
            seed = _seed(config, rel, index_rows, cache)
            data[fm.key_fact] = seed[0] if seed and seed[0] else fm.todo_placeholder
            if fm.aliases not in data and seed:
                data[fm.aliases] = seed[1]
        if not data.get(fm.summary):
            data[fm.summary] = shorten(str(data[fm.key_fact]), fm.summary_max)
        for key in fm.list_keys:
            value = data.get(key, [])
            data[key] = value if isinstance(value, list) else ([value] if value else [])
        ordered: Data = {key: value for key, value in data.items() if key not in fm.field_order}
        ordered.update({key: data[key] for key in fm.field_order})
        new = dump_frontmatter(ordered) + body
        if new != text:
            changed.append(rel)
            if not dry_run:
                write_generated(path, new)
    return changed


@dataclass(frozen=True)
class Entry:
    rel: str
    updated: str
    status: str
    key_fact: str
    summary: str
    aliases: str


def entry(config: Config, rel: str) -> Entry:
    fm = config.frontmatter
    data = parse_frontmatter(read_text(config.root / rel))[0]
    aliases = data.get(fm.aliases) or []
    alias_list = aliases if isinstance(aliases, list) else [aliases]
    key_fact = str(data.get(fm.key_fact) or fm.todo_placeholder)
    return Entry(rel, str(data.get(fm.updated) or ""), str(data.get(fm.status) or config.status.active),
                 key_fact, str(data.get(fm.summary) or key_fact), ", ".join(str(alias) for alias in alias_list))


def newest_first(entries: list[Entry]) -> list[Entry]:
    return sorted(sorted(entries, key=lambda item: item.rel), key=lambda item: item.updated, reverse=True)


def render_readme(config: Config, topic: str, text: str, notes: list[str], sensitivity: Sensitivity) -> str:
    locale = get_locale(config.ui.locale)
    prefix = config.layout.topics + "/" + topic + "/"
    readme = prefix + config.layout.topic_readme
    # A protected topic may list its own files. In an open topic every individually
    # sensitive file stays out, so a glance at the README reveals nothing.
    protected = sensitivity.is_sensitive(readme)
    # The README is readable in its own scope only; listing other scopes there would leak them.
    scope = effective_scope(config, readme)
    entries = [entry(config, rel) for rel in notes
               if rel.startswith(prefix) and rel != readme and (protected or not sensitivity.is_sensitive(rel))
               and effective_scope(config, rel) == scope]
    rows = [("`" + item.rel + "`", item.key_fact, item.aliases) for item in newest_first(entries)]
    files_table = table(locale.file_columns, rows)
    lines = drop_section(text.split("\n"), locale.stub_heading)
    if section_bounds(lines, locale.files_heading):
        # Swap only the table; prose inside the block is knowledge and stays.
        replace_table(lines, locale.files_heading, files_table)
    else:
        while lines and not lines[-1].strip():
            lines.pop()
        lines += ["", locale.files_heading, "", *files_table]
    return "\n".join(lines).rstrip("\n") + "\n"


def render_index(config: Config, text: str, notes: list[str], sensitivity: Sensitivity) -> str:
    locale = get_locale(config.ui.locale)
    layout = config.layout
    topics: list[Entry] = []
    for name in topic_dirs(config):
        rel = layout.topics + "/" + name + "/" + layout.topic_readme
        if not sensitivity.is_sensitive(rel):
            topics.append(entry(config, rel))
    topic_rows = []
    for item in newest_first(topics):
        status = "" if item.status == config.status.active else "[" + item.status + "] "
        topic_rows.append(("`" + item.rel.rsplit("/", 1)[0] + "/`", status + item.summary, item.aliases))
    lines = text.split("\n")
    replace_table(lines, locale.index_topics, table(locale.topic_columns, topic_rows))
    for base, heading in ((layout.notes, locale.index_notes), (layout.bookmarks, locale.index_bookmarks)):
        flat = [entry(config, rel) for rel in notes
                if rel.split("/")[0] == base and rel.count("/") == 1 and not sensitivity.is_sensitive(rel)]
        rows = [("`" + item.rel + "`", item.summary, item.aliases) for item in newest_first(flat)]
        replace_table(lines, heading, table(locale.file_columns, rows))
    return "\n".join(lines).rstrip("\n") + "\n"


def generate(config: Config, dry_run: bool = False) -> list[str]:
    changed: list[str] = []
    notes = iter_note_files(config)
    sensitivity = Sensitivity.load(config)

    def put(rel: str, current: str, new: str) -> None:
        if current != new:
            changed.append(rel)
            if not dry_run:
                write_generated(config.root / rel, new)

    for name in topic_dirs(config):
        rel = config.layout.topics + "/" + name + "/" + config.layout.topic_readme
        text = read_raw(config.root / rel)
        if text is not None:  # unreadable or symlinked READMEs stay untouched
            put(rel, text, render_readme(config, name, text, notes, sensitivity))
    index = read_raw(config.root / config.layout.index)
    if index is not None:
        put(config.layout.index, index, render_index(config, index, notes, sensitivity))
    return changed


def report(config: Config, max_age: int | None = None, only_findings: bool = False) -> str:
    fm = config.frontmatter
    days = config.limits.stale_after_days if max_age is None else max_age
    limit = dt.date.today() - dt.timedelta(days=days)
    sensitivity = Sensitivity.load(config)
    missing: list[str] = []
    stale: list[tuple[str, str]] = []
    todo: list[str] = []
    skipped = 0
    for rel in iter_note_files(config):
        if sensitivity.is_sensitive(rel):
            skipped += 1
            continue
        item = entry(config, rel)
        try:
            updated: dt.date | None = dt.date.fromisoformat(item.updated)
        except ValueError:
            updated = None
        if updated is None:
            missing.append(rel)
        elif item.status == config.status.active and updated < limit:
            stale.append((rel, item.updated))
        if item.key_fact == fm.todo_placeholder:
            todo.append(rel)
    if only_findings and not (missing or stale or todo):
        return ""
    out = [say("report_missing", "plain", key=fm.updated, count=len(missing))]
    out += ["- `" + rel + "`" for rel in missing] + [""]
    out.append(say("report_stale", "plain", status=config.status.active, days=days, count=len(stale)))
    out += [say("report_stale_item", "plain", path=rel, key=fm.updated, date=date) for rel, date in stale] + [""]
    out.append(say("report_todo", "plain", todo=fm.todo_placeholder, count=len(todo)))
    out += ["- `" + rel + "`" for rel in todo] + [""]
    out.append(say("report_sensitive", "plain", count=skipped))
    return "\n".join(out)
