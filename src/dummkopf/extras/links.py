"""Links extra: which topics share a month, an entity, or a month across scope barriers.

Read-only on notes and rebuildable at any time. Sensitive notes are left out and only counted.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from dummkopf.config import Config
from dummkopf.extras.common import open_notes, read_note, require
from dummkopf.files import topic_of
from dummkopf.frontmatter import parse_frontmatter
from dummkopf.locale import Locale, get_locale

ISO_RE = re.compile(r"\b(\d{4})-(\d{2})(?:-\d{2})?\b")
MONTH_YEAR_RE = re.compile(r"\b(\d{1,2})/(\d{4})\b")
PERIOD_RE = re.compile(r"^\d{4}-\d{2}$")
TOP_TOPICS = 10
MAX_PER_SIDE = 8


class TimeLink(TypedDict):
    month: str
    topic_count: int
    topics: list[str]


class EntityLink(TypedDict):
    entity: str
    topic_count: int
    topics: list[str]


class Collision(TypedDict):
    month: str
    scopes: dict[str, list[str]]


class LinksReport(TypedDict):
    time_links: list[TimeLink]
    entity_links: list[EntityLink]
    collisions: list[Collision]
    sensitive_files: int
    sensitive_topics: int


@dataclass(frozen=True)
class Entity:
    name: str
    aliases: tuple[str, ...]
    pattern: re.Pattern[str]


def month_name_re(locale: Locale) -> re.Pattern[str]:
    names = sorted(locale.months, key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(name) for name in names) + r")\.?\s+(\d{4})\b", re.IGNORECASE)


def extract_months(text: str, locale: Locale) -> list[str]:
    found: list[str] = []
    if locale.day_month_year:
        found += [f"{year}-{int(month):02d}" for _, month, year in locale.day_month_year.findall(text)
                  if 1 <= int(month) <= 12]
    found += [f"{year}-{int(month):02d}" for year, month in ISO_RE.findall(text) if 1 <= int(month) <= 12]
    found += [f"{year}-{locale.months[name.lower()]:02d}" for name, year in month_name_re(locale).findall(text)]
    found += [f"{year}-{int(month):02d}" for month, year in MONTH_YEAR_RE.findall(text) if 1 <= int(month) <= 12]
    return found


def load_entities(path: Path) -> list[Entity]:
    """One entity per line: `Name|alias|alias`. Prefix `i:` matches case-insensitively."""
    if not path.is_file():
        return []
    entities: list[Entity] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        flags = 0
        if line.startswith("i:"):
            flags, line = re.IGNORECASE, line[2:]
        aliases = tuple(alias.strip() for alias in line.split("|") if alias.strip())
        if aliases:
            pattern = re.compile(r"\b(?:" + "|".join(re.escape(alias) for alias in aliases) + r")\b", flags)
            entities.append(Entity(aliases[0], aliases, pattern))
    return entities


def ranked(counter: Counter[str], limit: int) -> list[str]:
    return [name for name, _ in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def topic_scope(config: Config, topic: str) -> str | None:
    if not topic.startswith(config.layout.topics + "/"):
        return None
    readme = config.root / topic / config.layout.topic_readme
    if not readme.is_file():
        return None
    value = parse_frontmatter(readme.read_text(encoding="utf-8", errors="ignore"))[0].get(config.frontmatter.scope)
    return value if isinstance(value, str) else None


def build(config: Config, min_topics: int | None = None) -> LinksReport:
    require(config, "links")
    locale = get_locale(config.ui.locale)
    fm = config.frontmatter
    minimum = config.links.min_topics if min_topics is None else min_topics
    entities = load_entities(config.root / config.links.entities_file)
    by_month: dict[str, Counter[str]] = defaultdict(Counter)
    by_entity: dict[str, Counter[str]] = defaultdict(Counter)
    scan = open_notes(config)
    for rel in scan.files:
        topic = topic_of(rel, config.layout)
        data, _, text = read_note(config, rel)
        months = extract_months(text, locale)
        period = data.get(fm.period)
        if isinstance(period, list):
            months += [value for value in period if PERIOD_RE.match(value)]
        for month in months:
            by_month[month][topic] += 1
        listed = data.get(fm.entities)
        listed = listed if isinstance(listed, list) else []
        for entity in entities:
            count = len(entity.pattern.findall(text))
            if count == 0 and any(alias in listed for alias in entity.aliases):
                count = 1
            if count:
                by_entity[entity.name][topic] += count
    time_links = sorted((TimeLink(month=month, topic_count=len(counter), topics=ranked(counter, TOP_TOPICS))
                         for month, counter in by_month.items() if len(counter) >= minimum),
                        key=lambda item: item["month"], reverse=True)
    entity_links = sorted((EntityLink(entity=name, topic_count=len(counter), topics=ranked(counter, TOP_TOPICS))
                           for name, counter in by_entity.items() if len(counter) >= minimum),
                          key=lambda item: (-item["topic_count"], item["entity"]))
    return LinksReport(time_links=time_links, entity_links=entity_links,
                       collisions=collisions(config, by_month), sensitive_files=scan.sensitive_files,
                       sensitive_topics=scan.sensitive_topics)


def collisions(config: Config, by_month: dict[str, Counter[str]]) -> list[Collision]:
    """One entry per month and scope barrier (e.g. work>private) where both sides are busy."""
    prefix = config.layout.topics + "/"
    result: list[Collision] = []
    for month, counter in by_month.items():
        scopes = {topic: topic_scope(config, topic) for topic in counter}
        for barrier in config.scopes.link_barriers:
            left, _, right = barrier.partition(">")
            sides = {}
            for scope in (left, right):
                topics = sorted((topic for topic, value in scopes.items() if value == scope),
                                key=lambda topic: (-counter[topic], topic))[:MAX_PER_SIDE]
                sides[scope] = [topic.removeprefix(prefix) for topic in topics]
            if all(sides.values()):
                result.append(Collision(month=month, scopes=sides))
    return sorted(result, key=lambda item: item["month"], reverse=True)


def render_markdown(report: LinksReport, config: Config) -> str:
    locale = get_locale(config.ui.locale)
    lines = [locale.links_generated.format(date=dt.date.today().isoformat()), "", locale.links_time, ""]
    lines += [f"- **{item['month']}** ({item['topic_count']} {locale.links_topics}): {', '.join(item['topics'])}"
              for item in report["time_links"]] or [locale.links_none]
    lines += ["", locale.links_entities, ""]
    lines += [f"- **{item['entity']}** ({item['topic_count']} {locale.links_topics}): {', '.join(item['topics'])}"
              for item in report["entity_links"]] or [locale.links_none]
    lines += ["", locale.links_collisions, ""]
    lines += ["- **" + item["month"] + "**: " + " × ".join(scope + ": " + ", ".join(topics)
                                                          for scope, topics in item["scopes"].items())
              for item in report["collisions"]] or [locale.links_none]
    lines += ["", locale.links_excluded.format(files=report["sensitive_files"], topics=report["sensitive_topics"])]
    return "\n".join(lines) + "\n"


def write_links(config: Config, out: str | None = None, min_topics: int | None = None) -> Path:
    path = config.root / (out or config.links.output)
    path.write_text(render_markdown(build(config, min_topics), config), encoding="utf-8")
    return path
