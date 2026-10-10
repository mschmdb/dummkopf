from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest
from conftest import Brain, invoke, make_brain

from dummkopf.access import Access
from dummkopf.errors import AccessDenied
from dummkopf.render import bounded
from dummkopf.search import Packet, context_packet

TODAY = dt.date(2026, 10, 4)


class Routed:
    """A German brain with one private, sensitive dated-plan route (as an existing hub uses it)."""

    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        brain.write(".sensitive-paths", "topics/locked/\n")
        brain.write("topics/locked/README.md", "---\nscope: privat\n---\n> SENSIBEL\n")
        self.routes([{"aliases": ["testplan"], "sources": "topics/locked/plan-*.md",
                      "scope": "privat", "kind": "dated-plan"}])

    def routes(self, routes: list[dict[str, object]], name: str = "routen.json") -> None:
        self.brain.write(name, json.dumps({"routes": routes}))

    def request(self, query: str, scope: str = "privat", date: dt.date = TODAY) -> Packet:
        return context_packet(Access(self.brain.config, scope=scope), query, today=date)

    def plan(self, period: str, body: str, connector: str = "bis") -> None:
        start, end = period.rsplit("-", 1)
        self.brain.write("topics/locked/plan-" + start + "-" + connector + "-" + end + ".md",
                         "# Testplan\n\n" + body)

    def out(self, packet: Packet) -> str:
        return bounded(packet, 6000, True, "plain")


@pytest.fixture
def hub(german: Brain) -> Routed:
    return Routed(german)


def test_explicit_request_routes_to_overlapping_period_and_only_matching_rows(hub: Routed) -> None:
    hub.plan("2026-09-25-30", "| Tag | Aufgabe |\n|---|---|\n| Mo, 28.09. | OLD |")
    hub.plan("2026-10-02-09", "| Tag | Aufgabe |\n|---|---|\n| So, 04.10. | BEFORE |\n"
             "| Mo, 05.10. | TARGET |\n| Fr, 09.10. | LAST |")
    hub.plan("2026-10-12-18", "| Mo, 12.10. | FUTURE |")
    result = hub.request("Was ist der Testplan für nächste Woche?")
    assert result["match"] == "routed"
    assert [hit["path"] for hit in result["hits"]] == ["topics/locked/plan-2026-10-02-bis-09.md"]
    assert result["period"] == {"start": "2026-10-05", "end": "2026-10-11"}
    assert result["missing_dates"] == ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10", "2026-10-11"]
    output = hub.out(result)
    assert "TARGET" in output
    for absent in ("BEFORE", "FUTURE", "OLD"):
        assert absent not in output


def test_general_request_does_not_grant_access_or_reveal_private_paths(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "SECRET")
    result = hub.request("Was gibt es Neues?")
    assert result["hits"] == []
    assert "locked" not in hub.out(result)


def test_substring_does_not_authorize_a_route(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "SECRET")
    assert hub.request("Was ist der Testplaner?")["hits"] == []


def test_work_scope_never_reads_private_route(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "SECRET")
    result = hub.request("Was ist der Testplan?", scope="work")
    assert result["hits"] == []
    assert "locked" not in hub.out(result)


def test_explicit_negation_does_not_open_a_route(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "SECRET")
    assert hub.request("Zeige keinen Testplan")["hits"] == []


def test_negation_in_another_sentence_does_not_hide_requested_plan(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "| Mo, 05.10. | TARGET |")
    result = hub.request("Testplan nächste Woche. Keine anderen Notizen lesen.")
    assert result["match"] == "routed"
    assert len(result["hits"]) == 1


def test_excluded_ingredient_does_not_negate_the_topic(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "| Mo, 05.10. | TARGET |")
    assert hub.request("Testplan nächste Woche ohne Zucker")["match"] == "routed"


def test_unrelated_sensitive_file_is_not_authorized(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "TARGET")
    hub.brain.write("topics/locked/other.md", "# Testplan\nSECRET unrelated")
    result = hub.request("Zeig den Testplan")
    assert len(result["hits"]) == 1
    assert "unrelated" not in hub.out(result)


def test_no_matching_period_does_not_fall_back_to_old_plan(hub: Routed) -> None:
    hub.plan("2026-09-25-30", "OLD")
    result = hub.request("Testplan nächste Woche")
    assert result["hits"] == []
    assert result["match"] == "routed"


def test_month_boundary_is_handled(hub: Routed) -> None:
    hub.plan("2026-12-29-04", "| Fr, 01.01. | NEW YEAR |")
    result = hub.request("Testplan nächste Woche", date=dt.date(2026, 12, 27))
    assert result["period"]["end"] == "2027-01-03"
    assert result["missing_dates"][-1] == "2027-01-03"
    assert "NEW YEAR" in hub.out(result)


def test_metadata_match_beats_unrelated_literal_question(hub: Routed) -> None:
    hub.brain.write("notes/source.md", "---\naliase: [widget, restart]\n---\n# Widget\nRestart the widget.")
    hub.brain.write("notes/chat.md", "# Chat\nWarum muss ich den Widget restart machen?")
    result = hub.request("Warum muss ich den Widget restart machen?", scope="both")
    assert result["hits"][0]["path"] == "notes/source.md"


def test_physical_line_numbers_remain_exact(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "| Tag | Aufgabe |\n|---|---|\n| Mo, 05.10. | TARGET |")
    hit = hub.request("Testplan nächste Woche")["hits"][0]
    lines = hub.brain.read(hit["path"]).splitlines()
    for line in hit["lines"]:
        assert line["text"] == lines[line["n"] - 1]


def test_missing_configuration_keeps_normal_protection(hub: Routed) -> None:
    (hub.brain.root / "routen.json").unlink()
    hub.plan("2026-10-02-09", "SECRET")
    assert hub.request("Testplan nächste Woche")["hits"] == []


@pytest.mark.parametrize("source", ["../outside/*.md", "topics/*/*.md", "/tmp/plan-*.md",
                                    "sources/plan-*.md", "topics/a/**/x.md"])
def test_invalid_configuration_fails_closed(hub: Routed, source: str) -> None:
    hub.routes([{"aliases": ["testplan"], "sources": source, "scope": "privat", "kind": "dated-plan"}])
    with pytest.raises(AccessDenied):
        hub.request("Testplan")


@pytest.mark.parametrize("route", [{"aliases": ["x"], "sources": "topics/a/p-*.md", "scope": "private",
                                    "kind": "dated-plan"},
                                   {"aliases": [], "sources": "topics/a/p-*.md", "scope": "privat",
                                    "kind": "dated-plan"},
                                   {"aliases": ["x"], "sources": "topics/a/p-*.md", "scope": "privat",
                                    "kind": "other"}])
def test_invalid_route_fields_fail_closed(hub: Routed, route: dict[str, object]) -> None:
    hub.routes([route])
    with pytest.raises(AccessDenied):
        hub.request("x")


def test_route_symlink_cannot_open_an_external_file(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "SECRET")
    path = hub.brain.root / "topics/locked/plan-2026-10-02-bis-09.md"
    path.unlink()
    hub.brain.write("outside.md", "EXTERNAL SECRET")
    path.symlink_to(hub.brain.root / "outside.md")
    assert hub.request("Testplan")["hits"] == []


def test_current_week_starts_on_monday(hub: Routed) -> None:
    hub.plan("2026-10-02-09", "| So, 04.10. | CURRENT |\n| Mo, 05.10. | NEXT |")
    result = hub.request("Testplan diese Woche")
    assert result["period"] == {"start": "2026-09-28", "end": "2026-10-04"}
    assert "CURRENT" in hub.out(result)
    assert "NEXT" not in hub.out(result)


def test_period_context_omits_whole_document_summary(hub: Routed) -> None:
    hub.brain.write("topics/locked/plan-2026-10-02-bis-09.md",
                    "---\nkernfakt: OLD SATURDAY\n---\n# Testplan\n| Mo, 05.10. | TARGET |")
    assert "OLD SATURDAY" not in hub.out(hub.request("Testplan nächste Woche"))


def test_question_with_only_stopwords_returns_empty(hub: Routed) -> None:
    assert hub.request("Was ist das?")["hits"] == []


def test_command_accepts_an_original_question_and_bounds_output(hub: Routed) -> None:
    today = dt.date.today()
    monday = today + dt.timedelta(days=7 - today.weekday())
    sunday = monday + dt.timedelta(days=6)
    hub.brain.write(f"topics/locked/plan-{monday.isoformat()}-bis-{sunday.isoformat()}.md",
                    f"# Testplan\n\n| Mo, {monday:%d.%m.} | " + "x" * 4000 + " |")
    code, output, _ = invoke(hub.brain, "context", "Testplan nächste Woche", "--scope", "privat",
                             "--json", "--max-chars", "500")
    assert code == 0
    assert len(output) <= 500
    assert json.loads(output)["truncated"]


def test_marker_added_outside_protection_list_remains_private(hub: Routed) -> None:
    hub.brain.write("notes/new.md", "> SENSIBEL\n# Widget\nRestart secret")
    assert hub.request("Widget restart")["hits"] == []


def test_english_locale_routes(tmp_path: Path) -> None:
    brain = make_brain(tmp_path / "en", 'schema_version = 1\n[repo]\nremote = "x"\n')
    hub = Routed.__new__(Routed)
    hub.brain = brain
    brain.write("topics/meals/README.md", "---\nscope: private\n---\n# Meals\n")
    hub.routes([{"aliases": ["meal plan"], "sources": "topics/meals/plan-*.md",
                 "scope": "private", "kind": "dated-plan"}], name="routes.json")
    brain.write("topics/meals/plan-2026-10-02-to-09.md",
                "# Meal plan\n\n| Day | Dish |\n|---|---|\n| Sun 10-04 | NOW |\n| Mon 10-05 | NEXT |\n"
                "| Tue 2026-10-06 | LATER |")
    nxt = hub.request("What is the meal plan for next week?", scope="private")
    assert nxt["match"] == "routed"
    assert "NEXT" in hub.out(nxt) and "LATER" in hub.out(nxt) and "NOW" not in hub.out(nxt)
    this = hub.request("meal plan this week", scope="private")
    assert "NOW" in hub.out(this) and "NEXT" not in hub.out(this)
    assert hub.request("Do not show the meal plan", scope="private")["match"] != "routed"
    assert hub.request("meal plan next week without onions", scope="private")["match"] == "routed"
