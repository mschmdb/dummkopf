"""Keyword search and the `context` entry point. Results carry exact physical line numbers."""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from collections.abc import Sequence
from pathlib import PurePosixPath
from typing import TypedDict

from dummkopf.access import Access, Note
from dummkopf.errors import AccessDenied, Rejected
from dummkopf.locale import get_locale
from dummkopf.routes import plan_lines, select


class SourceLine(TypedDict):
    n: int
    text: str


class Hit(TypedDict):
    path: str
    title: str
    updated: str
    status: str
    scope: str
    key_fact: str
    lines: list[SourceLine]
    revision: str


class DateRange(TypedDict):
    start: str
    end: str


class ContextFields(TypedDict, total=False):
    period: DateRange
    missing_dates: list[str]
    ignored: list[str]
    missing: list[str]


class Packet(ContextFields):
    hits: list[Hit]
    match: str
    more: bool
    truncated: bool


def words(value: str) -> list[str]:
    """Case- and accent-folded word tokens: `Straße Café` -> `strasse cafe`."""
    folded = "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                     if not unicodedata.combining(char))
    return re.findall(r"[^\W_]+", folded)


def source_hit(note: Note, start: int, end: int) -> Hit:
    lines = [SourceLine(n=index, text=line) for index, line in enumerate(note.text.splitlines(), 1)
             if start <= index <= end]
    return Hit(path=note.path, title=note.title[:160], updated=note.updated[:40], status=note.status[:40],
               scope=note.scope, key_fact=note.key_fact[:260], lines=lines, revision=note.revision)


def heading_range(text: str, section: str) -> tuple[int, int]:
    terms = words(section)
    if not terms:
        raise Rejected("section_needs_heading")
    headings: list[tuple[int, int, list[str]]] = []
    fence: tuple[str, int] | None = None
    lines = text.splitlines()
    for number, line in enumerate(lines, 1):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker[1]
            if fence is None:
                fence = (token[0], len(token))
            elif token[0] == fence[0] and len(token) >= fence[1]:
                fence = None
            continue
        if fence:
            continue
        match = re.match(r"^(#{1,6})\s+(.+)", line)
        if match:
            headings.append((number, len(match[1]), words(match[2])))
    selected = [heading for heading in headings if heading[2][:len(terms)] == terms]
    if len(selected) != 1:
        raise Rejected("section_ambiguous")
    start, level, _ = selected[0]
    end = next((number - 1 for number, depth, _ in headings if number > start and depth <= level), len(lines))
    return start, end


def body_start(note: Note) -> int:
    lines = note.text.splitlines()
    first = note.text[:len(note.text) - len(note.body)].count("\n") + 1
    while first <= len(lines) and not lines[first - 1].strip():
        first += 1
    return first if first <= len(lines) else 1


def search_excerpt(note: Note, terms: Sequence[str]) -> Hit:
    first = note.text[:len(note.text) - len(note.body)].count("\n") + 1
    body_lines = note.body.splitlines()
    if not body_lines:
        return source_hit(note, first, first)
    coverage = [len(set(words(line)).intersection(terms)) for line in body_lines]
    anchor = max(range(len(body_lines)), key=lambda index:
                 (coverage[index], not body_lines[index].lstrip().startswith(("#", "```", "|"))))
    if not coverage[anchor]:
        anchor = next((index for index, line in enumerate(body_lines)
                       if line.strip() and not line.startswith("#")), 0)
    return source_hit(note, first + max(0, anchor - 2), first + min(len(body_lines) - 1, anchor + 2))


def find(access: Access, query: str, limit: int = 3, natural: bool = False) -> Packet:
    config = access.config
    weights = config.search.weights
    stopwords = get_locale(config.ui.locale).stopwords
    terms = list(dict.fromkeys(words(query)))
    ignored: list[str] = []
    if natural:
        ignored = [term for term in terms if term in stopwords]
        terms = [term for term in terms if term not in stopwords]
    if not terms:
        raise Rejected("search_needs_term")
    ranked: list[tuple[int, int, Note]] = []
    found: set[str] = set()
    for path in access.paths():
        try:
            note = access.read(path)
        except AccessDenied:
            continue
        fields = ((note.title, weights.title), (" ".join(note.aliases), weights.aliases),
                  (note.key_fact, weights.key_fact), (note.path, weights.path), (note.body, weights.body))
        tokens = [(set(words(text)), weight) for text, weight in fields]
        matched = {term for term in terms if any(term in field for field, _ in tokens)}
        if not matched:
            continue
        found.update(matched)
        score = sum(weight for field, weight in tokens for term in terms if term in field)
        parts = PurePosixPath(note.path).parts
        # A query naming a topic is best answered by that topic's README.
        if (parts[0] == config.layout.topics and parts[-1] == config.layout.topic_readme
                and set(words(parts[1])) <= set(terms)):
            score += weights.topic_readme_bonus
        ranked.append((len(matched), score, note))
    ranked.sort(key=lambda item: (-item[1], -item[0], item[2].path) if natural
                else (-item[0], -item[1], item[2].path))
    complete = [item for item in ranked if item[0] == len(terms)]
    selected = ranked if natural else complete or ranked
    hits: list[Hit] = []
    for _, _, note in selected[:limit]:
        # Check again before output: markers and scope can change in parallel.
        try:
            hits.append(search_excerpt(access.read(note.path), terms))
        except AccessDenied:
            continue
    all_selected = bool(selected) and all(item[0] == len(terms) for item in selected[:limit])
    packet = Packet(hits=hits, match="all" if all_selected else ("partial" if ranked else "none"),
                    more=len(selected) > limit, truncated=False)
    if ignored:
        packet["ignored"] = ignored
    missing = [term for term in terms if term not in found]
    if missing:
        packet["missing"] = missing
    return packet


def context_packet(access: Access, query: str, today: dt.date | None = None,
                   limit: int | None = None) -> Packet:
    if not words(query):
        raise Rejected("query_needs_word")
    selection = select(access, query, words, today or dt.date.today())
    if selection is None:
        try:
            return find(access, query, limit=limit or access.config.limits.find_limit, natural=True)
        except Rejected:
            return Packet(hits=[], match="none", more=False, truncated=False)
    packet = Packet(hits=[], match="routed", more=False, truncated=False)
    covered: set[dt.date] = set()
    for note in selection.notes:
        hit = source_hit(note, 1, len(note.text.splitlines()))
        if selection.period:
            kept, dates = plan_lines(note, selection.period, access.config)
            hit["lines"] = [line for line in hit["lines"] if line["n"] in kept]
            # The whole-note key fact can describe days outside the requested period.
            hit["key_fact"] = ""
            covered.update(dates)
        packet["hits"].append(hit)
    if selection.period:
        start, end = selection.period
        packet["period"] = {"start": start.isoformat(), "end": end.isoformat()}
        days = ((start + dt.timedelta(days=offset)) for offset in range((end - start).days + 1))
        packet["missing_dates"] = [day.isoformat() for day in days if day not in covered]
    return packet
