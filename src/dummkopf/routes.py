"""Routes: a named query ("meal plan") opens exactly the matching dated-plan files.

A route releases only the files it selects, never the whole folder, so a sensitive
plan folder stays closed for every other question.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, NotRequired, TypedDict

from dummkopf.config import Config
from dummkopf.errors import AccessDenied
from dummkopf.locale import Locale, get_locale
from dummkopf.text import words

if TYPE_CHECKING:
    from dummkopf.access import Access, Note

Period = tuple[dt.date, dt.date]
Normalize = Callable[[str], list[str]]


ROUTE_KEYS = {"aliases", "sources", "scope", "kind", "allow_sensitive"}


class Route(TypedDict):
    aliases: list[str]
    sources: str
    scope: str
    kind: str
    allow_sensitive: NotRequired[bool]


@dataclass(frozen=True)
class Selection:
    notes: list[Note]
    period: Period | None


def week(terms: list[str], today: dt.date, locale: Locale) -> Period | None:
    text = " ".join(terms)
    monday = today - dt.timedelta(days=today.weekday())
    if locale.next_week.search(text):
        monday += dt.timedelta(days=7)
    elif not locale.this_week.search(text):
        return None
    return monday, monday + dt.timedelta(days=6)


def file_period(path: str, locale: Locale) -> Period | None:
    """`plan-2026-10-02-to-09.md` or `plan-2026-10-02-to-2026-10-09.md` -> both dates."""
    pattern = (r"-(\d{4}-\d{2}-\d{2})-" + re.escape(locale.period_connector)
               + r"-(\d{4}-\d{2}-\d{2}|\d{2})\.md$")
    match = re.search(pattern, path)
    if not match:
        return None
    try:
        start = dt.date.fromisoformat(match[1])
        if len(match[2]) == 10:
            end = dt.date.fromisoformat(match[2])
        else:
            day = int(match[2])
            if day >= start.day:
                end = start.replace(day=day)
            else:
                next_month = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
                end = next_month.replace(day=day)
        return (start, end) if end >= start else None
    except ValueError:
        return None


MIN_ALIAS_WORD = 3


def specific(alias: str, locale: Locale) -> bool:
    """An alias releases sensitive plans, so it must name something: not only filler words."""
    return any(len(token) >= MIN_ALIAS_WORD and token not in locale.stopwords for token in words(alias))


def route_problem(route: object, config: Config) -> str | None:
    """What is wrong with one route entry, or None. Routes fail closed, so the message must be precise."""
    if not isinstance(route, dict):
        return "must be an object"
    unknown = sorted(set(route) - ROUTE_KEYS)
    if unknown:
        return f"unknown key '{unknown[0]}'"
    if type(route.get("allow_sensitive", False)) is not bool:
        return "allow_sensitive must be true or false"
    aliases, source = route.get("aliases"), route.get("sources")
    if not isinstance(aliases, list) or not aliases or any(not isinstance(alias, str) for alias in aliases):
        return "aliases must be a non-empty list of strings"
    locale = get_locale(config.ui.locale)
    for alias in aliases:
        if not specific(alias, locale):
            return f"alias '{alias}' needs a real word (3+ letters, not a filler word)"
    if not isinstance(source, str):
        return "sources must be a string"
    parts = PurePosixPath(source).parts
    if (PurePosixPath(source).is_absolute() or ".." in parts or "\\" in source or len(parts) < 3
            or parts[0] not in config.layout.roots or any(char in "/".join(parts[:-1]) for char in "*?[")
            or not source.endswith(".md") or "**" in source):
        return "sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name"
    if route.get("scope") not in config.scopes.values:
        return "scope must be one of " + ", ".join(config.scopes.values)
    if route.get("kind") != "dated-plan":
        return "kind must be dated-plan"
    return None


def routes(config: Config) -> list[Route]:
    name = config.context.routes_file
    path = config.root / name
    if not path.exists() and not path.is_symlink():
        return []
    if path.is_symlink():
        raise AccessDenied("routes_invalid", file=name, problem="must not be a symlink")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise AccessDenied("routes_invalid", file=name, problem="not readable as JSON") from error
    result = data.get("routes") if isinstance(data, dict) else None
    if not isinstance(result, list):
        raise AccessDenied("routes_invalid", file=name, problem="needs a top-level \"routes\" list")
    for index, route in enumerate(result, 1):
        problem = route_problem(route, config)
        if problem:
            raise AccessDenied("routes_invalid", file=name, problem=f"route {index}: {problem}")
    return result


def opener(access: Access, route: Route, rel: str) -> Access:
    """Sensitive plans open only for a route the owner marked with `allow_sensitive: true`."""
    return access.with_grants([rel]) if route.get("allow_sensitive", False) else access


def readable(access: Access, rel: str) -> bool:
    try:
        access.read(rel)
    except AccessDenied:
        return False
    return True


def select(access: Access, query: str, normalize: Normalize, today: dt.date) -> Selection | None:
    config = access.config
    locale = get_locale(config.ui.locale)
    terms = normalize(query)

    def requested(alias: str) -> bool:
        tokens = normalize(alias)
        if not tokens:
            return False
        # Exclusions apply within one sentence, not to the user's other instructions.
        for clause in re.split(r"[.!?;\n]", query):
            clause_terms = normalize(clause)
            for index in range(len(clause_terms) - len(tokens) + 1):
                if clause_terms[index:index + len(tokens)] != tokens:
                    continue
                excluded = set(clause_terms).intersection(locale.negations)
                prefix = set(clause_terms[max(0, index - 3):index])
                if not excluded and not prefix.intersection(locale.without):
                    return True
        return False

    matched = [route for route in routes(config) if any(requested(alias) for alias in route["aliases"])]
    if not matched:
        return None
    period = week(terms, today, locale)
    selected: dict[str, Access] = {}
    topic_prefix = config.layout.topics + "/" + access.topic + "/" if access.topic else ""
    for route in matched:
        if access.scope not in (config.scopes.all, route["scope"]):
            continue
        candidates: list[tuple[Period, str]] = []
        for path in access.root.glob(route["sources"]):
            rel = path.relative_to(access.root).as_posix()
            if not rel.startswith(topic_prefix):
                continue
            dates = file_period(rel, locale)
            # Only plans this call may read compete for "latest", so a hidden newer plan reveals nothing.
            if dates and readable(opener(access, route, rel), rel):
                candidates.append((dates, rel))
        if period:
            chosen = [rel for dates, rel in candidates if dates[0] <= period[1] and dates[1] >= period[0]]
        else:
            current = [item for item in candidates if item[0][0] <= today <= item[0][1]]
            past = [item for item in candidates if item[0][0] <= today]
            chosen = [max(current or past)[1]] if current or past else []
        # Release only the chosen files, never the whole topic folder.
        selected.update({rel: opener(access, route, rel) for rel in chosen})
    notes: list[Note] = []
    for rel in sorted(selected):
        try:
            notes.append(selected[rel].read(rel))
        except AccessDenied:
            continue
    return Selection(notes, period)


def row_date(line: str, period: Period, locale: Locale) -> dt.date | None:
    if not line.lstrip().startswith("|"):
        return None
    match = locale.row_date.search(line.split("|")[1])
    if not match:
        return None
    year = match.group("year")
    years = [int(year)] if year else list(range(period[0].year, period[1].year + 1))
    for candidate in years:
        try:
            date = dt.date(candidate, int(match.group("month")), int(match.group("day")))
        except ValueError:
            continue
        if period[0] <= date <= period[1]:
            return date
    return None


def plan_lines(note: Note, requested: Period, config: Config) -> tuple[list[int], list[dt.date]]:
    """Line numbers of the H1, matching table rows and their header; plus the dates covered."""
    locale = get_locale(config.ui.locale)
    source_period = file_period(note.path, locale)
    if not source_period:
        return [], []
    kept: list[int] = []
    covered: list[dt.date] = []
    header: list[int] = []
    header_emitted = False
    for number, line in enumerate(note.text.splitlines(), 1):
        if line.startswith("# "):
            kept.append(number)
        if not line.lstrip().startswith("|"):
            header_emitted, header = False, []
            continue
        date = row_date(line, source_period, locale)
        if date:
            if requested[0] <= date <= requested[1]:
                if not header_emitted:
                    kept.extend(header)
                    header_emitted = True
                kept.append(number)
                covered.append(date)
        elif not locale.row_date.search(line.split("|")[1]):
            header.append(number)
    return kept, covered
