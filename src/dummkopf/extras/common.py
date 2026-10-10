"""Shared helpers for the extras: readable notes, ages and sensitivity counts."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterator
from dataclasses import dataclass

from dummkopf.config import Config
from dummkopf.errors import Rejected
from dummkopf.files import git_last_date, iter_note_files
from dummkopf.frontmatter import Data, parse_frontmatter
from dummkopf.locale import get_locale
from dummkopf.sensitive import Sensitivity


def require(config: Config, name: str) -> None:
    if not getattr(config.extras, name):
        raise Rejected("extra_disabled", name=name)


@dataclass(frozen=True)
class Scan:
    files: list[str]
    sensitive_files: int
    sensitive_topics: int


def open_notes(config: Config) -> Scan:
    """Non-sensitive notes, plus counts of what was left out."""
    sensitivity = Sensitivity.load(config)
    visible: list[str] = []
    hidden = 0
    for rel in iter_note_files(config):
        if sensitivity.is_sensitive(rel):
            hidden += 1
        else:
            visible.append(rel)
    return Scan(visible, hidden, sum(1 for topic in topic_folders(config)
                                     if sensitivity.is_sensitive(topic + "/" + config.layout.topic_readme)))


def topic_folders(config: Config) -> Iterator[str]:
    base = config.root / config.layout.topics
    if base.is_dir():
        for path in sorted(base.iterdir()):
            if path.is_dir():
                yield config.layout.topics + "/" + path.name


def read_note(config: Config, rel: str) -> tuple[Data, str, str]:
    text = (config.root / rel).read_text(encoding="utf-8", errors="ignore")
    data, body, _ = parse_frontmatter(text)
    return data, body, text


def parse_date(value: str, config: Config) -> dt.date | None:
    for pattern in get_locale(config.ui.locale).date_formats:
        try:
            return dt.datetime.strptime(value.strip(), pattern).date()
        except ValueError:
            continue
    return None


def age(config: Config, rel: str, data: Data) -> tuple[dt.date, str] | None:
    """Frontmatter date if valid, else the Git date.

    A bulk commit (such as a frontmatter migration) would otherwise make every
    file look fresh.
    """
    updated = data.get(config.frontmatter.updated)
    if isinstance(updated, str) and updated:
        parsed = parse_date(updated, config)
        if parsed is not None:
            return parsed, updated
    commit = git_last_date(config.root, rel)
    parsed = parse_date(commit, config) if commit else None
    return (parsed, commit) if parsed else None
