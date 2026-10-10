"""Routes: `context` opens dated plan files by alias and period, and only the matching rows."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest

from .conftest import Brain

DAY = dt.timedelta(days=1)
TODAY = dt.date.today()
MONDAY = TODAY - dt.timedelta(days=TODAY.weekday())
NEXT_MONDAY = MONDAY + 7 * DAY
ROUTE: dict[str, Any] = {"aliases": ["meal plan"], "sources": "topics/meals/plan-*.md", "scope": "private",
                         "kind": "dated-plan"}


def write_routes(brain: Brain, *routes: dict[str, Any], name: str = "routes.json") -> None:
    brain.write(name, json.dumps({"routes": list(routes)}))


def plan(brain: Brain, start: dt.date, end: dt.date, rows: dict[dt.date, str], connector: str = "to") -> str:
    path = f"topics/meals/plan-{start.isoformat()}-{connector}-{end.isoformat()}.md"
    table = [f"| {day.isoformat()} | {meal} |" for day, meal in rows.items()]
    lines = ["# Plan", "", "| Day | Meal |", "|---|---|", *table]
    brain.write(path, "\n".join(lines) + "\n")
    return path


def context(brain: Brain, query: str, *args: str) -> dict[str, Any]:
    result = brain.run("context", query, "--json", *args)
    assert result.code == 0, result.err
    return json.loads(result.out)  # type: ignore[no-any-return]


@pytest.fixture
def meals(brain: Brain) -> Brain:
    brain.write("topics/meals/README.md", "---\nscope: private\n---\n\n# Meals\n")
    write_routes(brain, ROUTE)
    return brain


# --- routed answers ---------------------------------------------------------------------------------------------


def test_next_week_opens_the_overlapping_plan_and_only_its_matching_rows(meals: Brain) -> None:
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "THISWEEKROW"})
    chosen = plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta", NEXT_MONDAY + 2 * DAY: "soup"})
    plan(meals, NEXT_MONDAY + 7 * DAY, NEXT_MONDAY + 13 * DAY, {NEXT_MONDAY + 7 * DAY: "LATERROW"})
    packet = context(meals, "meal plan next week")
    assert packet["match"] == "routed"
    assert [hit["path"] for hit in packet["hits"]] == [chosen]
    texts = [line["text"] for line in packet["hits"][0]["lines"]]
    assert texts == ["# Plan", "| Day | Meal |", "|---|---|",
                     f"| {NEXT_MONDAY.isoformat()} | pasta |", f"| {(NEXT_MONDAY + 2 * DAY).isoformat()} | soup |"]


def test_routed_lines_keep_their_physical_line_numbers(meals: Brain) -> None:
    path = plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    file_lines = meals.read(path).splitlines()
    for line in context(meals, "meal plan next week")["hits"][0]["lines"]:
        assert file_lines[line["n"] - 1] == line["text"]


def test_routed_json_has_period_and_missing_dates(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta", NEXT_MONDAY + 2 * DAY: "soup"})
    packet = context(meals, "meal plan next week")
    assert packet["period"] == {"start": NEXT_MONDAY.isoformat(), "end": (NEXT_MONDAY + 6 * DAY).isoformat()}
    expected = [(NEXT_MONDAY + offset * DAY).isoformat() for offset in (1, 3, 4, 5, 6)]
    assert packet["missing_dates"] == expected
    assert list(packet) == ["hits", "match", "more", "truncated", "period", "missing_dates"]


def test_routed_text_names_the_period_and_the_dates_without_rows(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {day: "x" for day in [NEXT_MONDAY + i * DAY for i in range(6)]})
    out = meals.run("context", "meal plan next week").out
    sunday = (NEXT_MONDAY + 6 * DAY).isoformat()
    assert out.splitlines()[0] == f"Requested period: {NEXT_MONDAY.isoformat()} to {sunday}"
    assert out.rstrip().endswith(f"No dated plan rows for: {sunday}")


def test_a_fully_covered_period_has_no_missing_dates(meals: Brain) -> None:
    days = [NEXT_MONDAY + i * DAY for i in range(7)]
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {day: "x" for day in days})
    packet = context(meals, "meal plan next week")
    assert packet["missing_dates"] == []
    assert "No dated plan rows" not in meals.run("context", "meal plan next week").out


def test_this_week_uses_monday_to_sunday_of_the_current_week(meals: Brain) -> None:
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "THISWEEKROW"})
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "NEXTWEEKROW"})
    packet = context(meals, "meal plan this week")
    assert packet["period"] == {"start": MONDAY.isoformat(), "end": (MONDAY + 6 * DAY).isoformat()}
    rendered = json.dumps(packet)
    assert "THISWEEKROW" in rendered
    assert "NEXTWEEKROW" not in rendered


def test_a_plan_spanning_two_weeks_serves_both(meals: Brain) -> None:
    path = plan(meals, MONDAY, NEXT_MONDAY + 6 * DAY, {MONDAY: "first", NEXT_MONDAY: "second"})
    assert [hit["path"] for hit in context(meals, "meal plan next week")["hits"]] == [path]
    assert [hit["path"] for hit in context(meals, "meal plan this week")["hits"]] == [path]


def test_short_file_names_with_only_the_end_day_work(meals: Brain) -> None:
    start, end = NEXT_MONDAY, NEXT_MONDAY + 6 * DAY
    path = f"topics/meals/plan-{start.isoformat()}-to-{end.day:02d}.md"
    meals.write(path, f"# Plan\n\n| Day | Meal |\n|---|---|\n| {start.isoformat()} | pasta |\n")
    assert [hit["path"] for hit in context(meals, "meal plan next week")["hits"]] == [path]


def test_no_overlapping_plan_gives_no_hits_but_stays_routed(meals: Brain) -> None:
    plan(meals, MONDAY - 14 * DAY, MONDAY - 8 * DAY, {MONDAY - 14 * DAY: "OLDROW"})
    packet = context(meals, "meal plan next week")
    assert packet["hits"] == []
    assert packet["match"] == "routed"
    assert len(packet["missing_dates"]) == 7


def test_without_a_period_the_plan_covering_today_is_chosen(meals: Brain) -> None:
    current = plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "current"})
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "future"})
    packet = context(meals, "meal plan")
    assert [hit["path"] for hit in packet["hits"]] == [current]
    assert "period" not in packet


def test_without_a_period_the_latest_past_plan_is_the_fallback(meals: Brain) -> None:
    plan(meals, MONDAY - 28 * DAY, MONDAY - 22 * DAY, {MONDAY - 28 * DAY: "oldest"})
    latest = plan(meals, MONDAY - 14 * DAY, MONDAY - 8 * DAY, {MONDAY - 14 * DAY: "latest"})
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "future"})
    assert [hit["path"] for hit in context(meals, "meal plan")["hits"]] == [latest]


def test_the_alias_matches_whole_words_only(meals: Brain) -> None:
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "ROUTEDROW"})
    assert context(meals, "meal planner")["match"] != "routed"
    assert context(meals, "meal plan")["match"] == "routed"
    assert context(meals, "What is the meal plan?")["match"] == "routed"


def test_a_negated_request_does_not_open_the_route(meals: Brain) -> None:
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "ROUTEDROW"})
    assert context(meals, "show me no meal plan")["match"] != "routed"
    assert context(meals, "meal plan without sugar")["match"] == "routed"


def test_a_negation_in_another_sentence_does_not_cancel_the_request(meals: Brain) -> None:
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "ROUTEDROW"})
    assert context(meals, "Meal plan please. Do not read other notes.")["match"] == "routed"


def test_route_scope_must_match_the_requested_scope(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    assert context(meals, "meal plan next week", "--scope", "work")["hits"] == []
    assert len(context(meals, "meal plan next week", "--scope", "private")["hits"]) == 1
    assert len(context(meals, "meal plan next week", "--scope", "both")["hits"]) == 1


def test_topic_option_restricts_the_route_to_that_topic(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    assert context(meals, "meal plan next week", "--topic", "elsewhere")["hits"] == []
    assert len(context(meals, "meal plan next week", "--topic", "meals")["hits"]) == 1


def test_a_route_opens_only_files_matching_its_pattern(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    meals.write("topics/meals/notes.md", "# Notes\n\nOTHERFILEWORD\n")
    meals.write("topics/meals/plan-notes.md", "# Plan notes\n\nOTHERFILEWORD\n")
    assert "OTHERFILEWORD" not in json.dumps(context(meals, "meal plan next week"))


def test_routes_file_name_comes_from_the_config(meals: Brain) -> None:
    (meals.root / "routes.json").unlink()
    meals.configure('[context]\nroutes_file = "my-routes.json"\n')
    write_routes(meals, ROUTE, name="my-routes.json")
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    assert context(meals, "meal plan next week")["match"] == "routed"


def test_without_a_routes_file_context_is_a_normal_search(meals: Brain) -> None:
    (meals.root / "routes.json").unlink()
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    assert context(meals, "meal plan next week")["match"] != "routed"


def test_find_never_uses_routes(meals: Brain) -> None:
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "pasta"})
    packet = json.loads(meals.run("find", "meal plan next week", "--json").out)
    assert packet["match"] != "routed"
    assert "period" not in packet


def test_a_symlinked_plan_file_is_not_opened(meals: Brain) -> None:
    meals.write("outside.md", "# Plan\n\n| Day | Meal |\n|---|---|\n"
                f"| {NEXT_MONDAY.isoformat()} | EXTERNALROW |\n")
    link = meals.root / f"topics/meals/plan-{NEXT_MONDAY.isoformat()}-to-{(NEXT_MONDAY + 6 * DAY).isoformat()}.md"
    link.symlink_to(meals.root / "outside.md")
    assert context(meals, "meal plan next week")["hits"] == []


def test_german_locale_reads_german_weeks_and_row_dates(brain: Brain) -> None:
    brain.configure('[ui]\nlocale = "de"\n')
    brain.write("topics/essen/README.md", "---\nscope: private\n---\n\n# Essen\n")
    write_routes(brain, {**ROUTE, "aliases": ["essensplan"], "sources": "topics/essen/plan-*.md"})
    end = NEXT_MONDAY + 6 * DAY
    path = f"topics/essen/plan-{NEXT_MONDAY.isoformat()}-bis-{end.isoformat()}.md"
    brain.write(path, f"# Plan\n\n| Tag | Essen |\n|---|---|\n| Mo, {NEXT_MONDAY:%d.%m.} | Nudeln |\n")
    packet = context(brain, "Essensplan nächste Woche")
    assert packet["match"] == "routed"
    assert [hit["path"] for hit in packet["hits"]] == [path]
    assert any("Nudeln" in line["text"] for line in packet["hits"][0]["lines"])
    assert len(packet["missing_dates"]) == 6


# --- sensitive plans -------------------------------------------------------------------------------------------


@pytest.fixture
def sensitive_meals(meals: Brain) -> Brain:
    meals.write(".sensitive-paths", "topics/meals/\n")
    plan(meals, NEXT_MONDAY, NEXT_MONDAY + 6 * DAY, {NEXT_MONDAY: "secretpasta"})
    meals.write("topics/meals/other.md", "# Other\n\nSECRETOTHER\n")
    return meals


def test_a_sensitive_plan_stays_closed_without_allow_sensitive_in_the_route(sensitive_meals: Brain) -> None:
    packet = context(sensitive_meals, "meal plan next week")
    assert packet["hits"] == []
    assert "secretpasta" not in json.dumps(packet)


def test_allow_sensitive_in_the_route_opens_the_matching_plan(sensitive_meals: Brain) -> None:
    write_routes(sensitive_meals, {**ROUTE, "allow_sensitive": True})
    packet = context(sensitive_meals, "meal plan next week")
    assert "secretpasta" in json.dumps(packet)
    assert packet["match"] == "routed"


def test_an_opened_sensitive_route_does_not_open_other_files_of_the_folder(sensitive_meals: Brain) -> None:
    write_routes(sensitive_meals, {**ROUTE, "allow_sensitive": True})
    assert "SECRETOTHER" not in json.dumps(context(sensitive_meals, "meal plan next week"))
    assert sensitive_meals.run("read", "topics/meals/other.md").code == 2


def test_an_opened_sensitive_route_does_not_open_the_plan_for_other_commands(sensitive_meals: Brain) -> None:
    write_routes(sensitive_meals, {**ROUTE, "allow_sensitive": True})
    assert json.loads(sensitive_meals.run("find", "secretpasta", "--json").out)["hits"] == []
    assert sensitive_meals.run("read", f"topics/meals/plan-{NEXT_MONDAY.isoformat()}-to-"
                               f"{(NEXT_MONDAY + 6 * DAY).isoformat()}.md").code == 2
    assert context(sensitive_meals, "Anything new in the notes?")["hits"] == []


def test_a_general_question_does_not_open_a_sensitive_route(sensitive_meals: Brain) -> None:
    write_routes(sensitive_meals, {**ROUTE, "allow_sensitive": True})
    assert "secretpasta" not in json.dumps(context(sensitive_meals, "What is new this week?"))


def test_a_hidden_newer_plan_does_not_change_the_answer(meals: Brain) -> None:
    visible = plan(meals, MONDAY - 14 * DAY, MONDAY - 8 * DAY, {MONDAY - 14 * DAY: "visible"})
    before = context(meals, "meal plan")
    meals.write(".sensitive-paths", f"topics/meals/plan-{MONDAY.isoformat()}-to-{(MONDAY + 6 * DAY).isoformat()}.md\n")
    plan(meals, MONDAY, MONDAY + 6 * DAY, {MONDAY: "hiddennewer"})
    after = context(meals, "meal plan")
    assert after == before
    assert after["hits"][0]["path"] == visible


# --- invalid routes fail closed ----------------------------------------------------------------------------------


def routes_error(brain: Brain, raw: str | None = None, *routes: dict[str, Any]) -> str:
    if raw is not None:
        brain.write("routes.json", raw)
    else:
        write_routes(brain, *routes)
    result = brain.run("context", "anything at all")
    assert result.code == 2
    assert result.out == ""
    return result.err


SUFFIX = ". All routes stay closed until this is fixed.\n"


@pytest.mark.parametrize(("route", "problem"), [
    ({**ROUTE, "bogus": 1}, "route 1: unknown key 'bogus'"),
    ({**ROUTE, "scope": "nowhere"}, "route 1: scope must be one of private, work"),
    ({**ROUTE, "kind": "other"}, "route 1: kind must be dated-plan"),
    ({**ROUTE, "aliases": []}, "route 1: aliases must be a non-empty list of strings"),
    ({**ROUTE, "aliases": [5]}, "route 1: aliases must be a non-empty list of strings"),
    ({**ROUTE, "aliases": ["it"]}, "route 1: alias 'it' needs a real word (3+ letters, not a filler word)"),
    ({**ROUTE, "aliases": ["the"]}, "route 1: alias 'the' needs a real word (3+ letters, not a filler word)"),
    ({**ROUTE, "sources": 5}, "route 1: sources must be a string"),
    ({**ROUTE, "sources": "../x/plan-*.md"},
     "route 1: sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name"),
    ({**ROUTE, "sources": "topics/*/plan-*.md"},
     "route 1: sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name"),
    ({**ROUTE, "sources": "sources/meals/plan-*.md"},
     "route 1: sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name"),
    ({**ROUTE, "allow_sensitive": "yes"}, "route 1: allow_sensitive must be true or false"),
    ("text", "route 1: must be an object"),
])
def test_invalid_route_names_the_route_and_the_problem(meals: Brain, route: Any, problem: str) -> None:
    meals.write("routes.json", json.dumps({"routes": [route]}))
    result = meals.run("context", "anything at all")
    assert result.code == 2
    assert result.err == f"routes.json: {problem}{SUFFIX}"


def test_the_second_broken_route_is_numbered_2(meals: Brain) -> None:
    assert routes_error(meals, None, ROUTE, {**ROUTE, "kind": "other"}) == (
        f"routes.json: route 2: kind must be dated-plan{SUFFIX}")


@pytest.mark.parametrize(("raw", "problem"), [
    ("{not json", "not readable as JSON"),
    ('{"routes": "x"}', 'needs a top-level "routes" list'),
    ("[]", 'needs a top-level "routes" list'),
    ("{}", 'needs a top-level "routes" list'),
])
def test_unreadable_routes_file_fails_closed(meals: Brain, raw: str, problem: str) -> None:
    assert routes_error(meals, raw) == f"routes.json: {problem}{SUFFIX}"


def test_symlinked_routes_file_fails_closed(meals: Brain) -> None:
    (meals.root / "routes.json").unlink()
    meals.write("real-routes.json", json.dumps({"routes": [ROUTE]}))
    (meals.root / "routes.json").symlink_to(meals.root / "real-routes.json")
    assert routes_error(meals, None).startswith("routes.json: must not be a symlink")


def test_broken_routes_do_not_affect_find_or_read(meals: Brain) -> None:
    meals.write("routes.json", "{not json")
    meals.write("notes/n.md", "# N\n\nneedle\n")
    assert meals.run("find", "needle").code == 0
    assert meals.run("read", "notes/n.md").code == 0


def test_an_empty_routes_list_is_valid(meals: Brain) -> None:
    write_routes(meals)
    assert meals.run("context", "anything at all").code == 0
