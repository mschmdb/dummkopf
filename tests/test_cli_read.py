from __future__ import annotations

import argparse
import json

import pytest
from conftest import Brain, document, invoke, revision

from dummkopf.access import Access
from dummkopf.cli import parser
from dummkopf.render import bounded
from dummkopf.search import context_packet, find


def test_all_terms_rank_ahead_of_partial_match_and_path_is_tiebreaker(brain: Brain) -> None:
    brain.note("notes/partial.md", body="pnpm only")
    brain.note("notes/z.md")
    brain.note("notes/a.md")
    result = find(Access(brain.config), "pnpm esbuild")
    assert [hit["path"] for hit in result["hits"]] == ["notes/a.md", "notes/z.md"]
    assert result["match"] == "all"


def test_partial_results_are_explicit(brain: Brain) -> None:
    brain.note("notes/partial.md", body="pnpm only")
    assert find(Access(brain.config), "pnpm esbuild")["match"] == "partial"


def test_unicode_search_handles_accents_and_case(brain: Brain) -> None:
    brain.note("notes/uml.md", title="Überblick", body="Straße und Café")
    assert len(find(Access(brain.config), "STRASSE cafe")["hits"]) == 1


def test_configured_weights_change_ranking(brain: Brain) -> None:
    brain.note("notes/a.md", title="Other", body="pnpm")
    brain.note("notes/b.md", title="Other", body="nothing", fields="aliases: [pnpm]\n")
    assert find(Access(brain.config), "pnpm")["hits"][0]["path"] == "notes/b.md"
    config = brain.configure("[search.weights]\naliases = 0\nbody = 50\n")
    assert find(Access(config), "pnpm")["hits"][0]["path"] == "notes/a.md"


def test_cli_blocks_sensitive_read_without_leaking(brain: Brain) -> None:
    brain.write(".sensitive-paths", "notes/listed.md\n")
    brain.note("notes/listed.md", body="SECRET listed")
    code, output, error = invoke(brain, "read", "notes/listed.md")
    assert code == 2
    assert "SECRET" not in output + error
    assert "notes/listed.md" not in output + error


def test_denied_message_follows_tone(brain: Brain) -> None:
    brain.write(".sensitive-paths", "notes/listed.md\n")
    brain.note("notes/listed.md")
    assert invoke(brain, "read", "notes/listed.md")[2].startswith("Dummkopf!")
    assert not invoke(brain, "read", "notes/listed.md", "--serious")[2].startswith("Dummkopf")
    brain.configure("[ui]\ntone = 'plain'\n")
    assert invoke(brain, "read", "notes/listed.md")[2].startswith("Path unavailable")


@pytest.mark.parametrize("args", [("find", "!!!"), ("read", "notes/a.md", "--start", "0"),
                                  ("read", "notes/a.md", "--start", "4", "--end", "2"),
                                  ("find", "pnpm", "--limit", "11"), ("find", "pnpm", "--max-chars", "100")])
def test_empty_query_and_invalid_ranges_fail(brain: Brain, args: tuple[str, ...]) -> None:
    brain.note("notes/a.md")
    assert invoke(brain, *args)[0] == 2


def test_read_range_json_budget_and_no_mutations(brain: Brain) -> None:
    target = brain.note("notes/a.md", body=("pnpm esbuild " * 300) + "\nlast")
    original = target.read_bytes()
    code, output, error = invoke(brain, "read", "notes/a.md", "--start", "8", "--end", "9",
                                 "--json", "--max-chars", "700")
    assert (code, error) == (0, "")
    assert len(output) <= 700
    result = json.loads(output)
    assert result["truncated"]
    assert result["hits"][0]["lines"][0]["n"] == 8
    assert target.read_bytes() == original


def test_find_budget_keeps_valid_json_and_reports_more_results(brain: Brain) -> None:
    for index in range(5):
        brain.note(f"notes/{index}.md", body="pnpm esbuild\n" + ("x" * 2000))
    code, output, error = invoke(brain, "find", "pnpm esbuild", "--json", "--max-chars", "800")
    assert (code, error) == (0, "")
    assert len(output) <= 800
    result = json.loads(output)
    assert result["more"] and result["truncated"] and result["hits"]


def test_topic_filter_and_no_results(brain: Brain) -> None:
    brain.note("topics/build/a.md")
    brain.note("notes/a.md")
    code, output, error = invoke(brain, "find", "pnpm esbuild", "--topic", "build", "--json")
    assert (code, error) == (0, "")
    assert [hit["path"] for hit in json.loads(output)["hits"]] == ["topics/build/a.md"]
    assert find(Access(brain.config), "absent")["hits"] == []


def test_no_results_text_follows_tone(brain: Brain) -> None:
    brain.note("notes/a.md")
    assert "Even a Dummkopf knows" in invoke(brain, "find", "absent")[1]
    assert "Dummkopf" not in invoke(brain, "find", "absent", "--serious")[1]


def test_read_larger_budget_can_return_a_full_long_line(brain: Brain) -> None:
    brain.note("notes/a.md", body="x" * 1200)
    code, output, error = invoke(brain, "read", "notes/a.md", "--start", "8", "--json", "--max-chars", "2000")
    assert (code, error) == (0, "")
    packet = json.loads(output)
    assert not packet["truncated"]
    assert packet["hits"][0]["lines"][0]["text"] == "x" * 1200


def test_excerpt_prefers_explanation_over_matching_heading(brain: Brain) -> None:
    brain.note("notes/a.md", title="pnpm esbuild", body="Intro\n\npnpm esbuild needs approved builds.")
    hit = find(Access(brain.config), "pnpm esbuild")["hits"][0]
    assert any("needs approved builds" in line["text"] for line in hit["lines"])


def test_read_section_supports_date_suffix_and_nested_headings(brain: Brain) -> None:
    brain.note("notes/a.md", body="Intro\n## Review, 2026-10-04\nTarget\n### Details\nNested\n## End\nOTHER")
    code, output, error = invoke(brain, "read", "notes/a.md", "--section", "Review", "--json")
    assert (code, error) == (0, "")
    hit = json.loads(output)["hits"][0]
    assert hit["revision"]
    text = "\n".join(line["text"] for line in hit["lines"])
    assert "Target" in text and "Nested" in text and "OTHER" not in text
    original = brain.read("notes/a.md").splitlines()
    for line in hit["lines"]:
        assert line["text"] == original[line["n"] - 1]


def test_read_section_does_not_match_code_and_rejects_ambiguity(brain: Brain) -> None:
    brain.note("notes/a.md", body="```md\n## Review\nfake\n```\n## Review, today\nActual")
    code, output, error = invoke(brain, "read", "notes/a.md", "--section", "Review", "--json")
    assert (code, error) == (0, "")
    assert "fake" not in output
    brain.note("notes/a.md", body="## Review, today\nA\n## Review, yesterday\nB")
    assert invoke(brain, "read", "notes/a.md", "--section", "Review")[0] == 2


@pytest.mark.parametrize("args", [("read", "notes/a.md", "--section", "Missing"),
                                  ("read", "notes/a.md", "--section", "Docker", "--start", "2")])
def test_read_section_rejects_missing_or_conflicting_range(brain: Brain, args: tuple[str, ...]) -> None:
    brain.note("notes/a.md")
    assert invoke(brain, *args)[0] == 2


def test_text_output_shows_short_revision_in_header(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    rev = revision(brain, "notes/a.md")[:12]
    for args in (("find", "pnpm"), ("read", "notes/a.md"), ("context", "pnpm esbuild")):
        code, output, _ = invoke(brain, *args)
        assert code == 0
        assert "notes/a.md | rev=" + rev + " |" in output


def test_context_reports_ignored_and_missing_terms(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    packet = context_packet(Access(brain.config), "What is there about pnpm quantum?")
    assert packet["ignored"] == ["what", "is", "there", "about"]
    assert packet["missing"] == ["quantum"]
    output = bounded(packet, 6000, False, "plain")
    assert "Ignored: what, is, there, about" in output
    assert "Not found: quantum" in output


def test_german_locale_uses_german_stopwords(german: Brain) -> None:
    german.write("notes/a.md", "---\nstand: 2026-01-01\n---\n\n# A\n\npnpm esbuild\n")
    packet = context_packet(Access(german.config), "Was steht zu pnpm quantum?")
    assert packet["ignored"] == ["was", "steht", "zu"]


def test_find_without_gaps_prints_no_hint_lines(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    output = bounded(find(Access(brain.config), "pnpm"), 6000, False, "plain")
    assert "Ignored" not in output and "Not found" not in output


def test_topic_readme_ranks_first_when_query_names_the_topic(brain: Brain) -> None:
    brain.write("bookmarks/agentic-engineering.md", document(
        title="Bookmarks: agentic-engineering", body="agentic engineering links agentic engineering"))
    brain.write("topics/agentic-engineering/README.md",
                document(title="Agentic Engineering").replace("---\n\n", "scope: work\n---\n\n", 1))
    brain.write("topics/agentic-engineering/detail.md", document(title="Agentic Engineering Detail"))
    access = Access(brain.config)
    for packet in (find(access, "agentic engineering"),
                   context_packet(access, "What is there about agentic engineering?")):
        assert packet["hits"][0]["path"] == "topics/agentic-engineering/README.md"


@pytest.mark.parametrize("command", ["context", "find"])
@pytest.mark.parametrize("as_json", [False, True])
def test_single_long_missing_term_keeps_source_and_respects_budget(
        brain: Brain, command: str, as_json: bool) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    flags = ("--json",) if as_json else ()
    code, output, error = invoke(brain, command, "pnpm " + "x" * 800, "--max-chars", "500", *flags)
    assert (code, error) == (0, "")
    assert len(output) <= 500
    assert "notes/a.md" in output and "pnpm esbuild" in output
    if as_json:
        packet = json.loads(output)
        assert packet["truncated"]
        assert packet["missing"][0].endswith("…")
    else:
        assert "Not found: xxx" in output
        assert "Output truncated" in output


@pytest.mark.parametrize("command", ["context", "find"])
@pytest.mark.parametrize("as_json", [False, True])
def test_single_long_missing_term_without_hits_respects_budget(
        brain: Brain, command: str, as_json: bool) -> None:
    flags = ("--json",) if as_json else ()
    code, output, error = invoke(brain, command, "x" * 800, "--max-chars", "500", "--serious", *flags)
    assert (code, error) == (0, "")
    assert len(output) <= 500
    if as_json:
        packet = json.loads(output)
        assert packet["hits"] == []
        assert packet["truncated"]
        assert packet["missing"][0].endswith("…")
    else:
        assert "Nothing found" in output
        assert "Not found: xxx" in output


@pytest.mark.parametrize("as_json", [False, True])
def test_long_first_term_and_hint_lists_preserve_packet_and_source(brain: Brain, as_json: bool) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    query = "What is there about pnpm " + "x" * 800 + " " + " ".join(f"missing{i}" for i in range(150))
    packet = context_packet(Access(brain.config), query)
    before = json.dumps(packet)
    output = bounded(packet, 500, as_json, "plain")
    assert len(output) <= 500
    assert "notes/a.md" in output and "pnpm esbuild" in output
    assert json.dumps(packet) == before


def test_long_search_hints_stay_within_budget_and_keep_hits(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="pnpm esbuild"))
    query = "pnpm " + " ".join(f"missing{index:03d}" for index in range(150))
    access = Access(brain.config)
    output = bounded(context_packet(access, query), 500, False, "plain")
    assert len(output) <= 500
    assert "notes/a.md" in output
    assert "Not found: missing000" in output
    packet = json.loads(bounded(context_packet(access, query), 500, True, "plain"))
    assert packet["hits"][0]["path"] == "notes/a.md"
    assert packet["truncated"]


def test_read_end_without_start_also_skips_frontmatter(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="One\nTwo"))
    packet = json.loads(invoke(brain, "read", "notes/a.md", "--end", "12", "--json")[1])
    assert [line["n"] for line in packet["hits"][0]["lines"]] == [11, 12]


def test_read_end_inside_frontmatter_returns_those_lines(brain: Brain) -> None:
    brain.write("notes/a.md", document())
    packet = json.loads(invoke(brain, "read", "notes/a.md", "--end", "3", "--json")[1])
    assert [line["n"] for line in packet["hits"][0]["lines"]] == [1, 2, 3]


def test_read_skips_frontmatter_by_default(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="Content"))
    hit = json.loads(invoke(brain, "read", "notes/a.md", "--json")[1])["hits"][0]
    assert hit["lines"][0]["n"] == 11
    assert "key_fact:" not in "".join(line["text"] for line in hit["lines"])
    assert hit["key_fact"] == "Proven content."


def test_read_start_one_still_returns_frontmatter(brain: Brain) -> None:
    brain.write("notes/a.md", document())
    packet = json.loads(invoke(brain, "read", "notes/a.md", "--start", "1", "--json")[1])
    assert packet["hits"][0]["lines"][0] == {"n": 1, "text": "---"}


def test_root_option_and_missing_config(brain: Brain, tmp_path) -> None:  # type: ignore[no-untyped-def]
    from dummkopf.cli import main

    brain.write("notes/a.md", document(body="pnpm"))
    assert main(["--root", str(brain.root), "find", "pnpm", "--json"]) == 0
    assert main(["find", "pnpm", "--root", str(brain.root), "--json"]) == 0
    empty = tmp_path / "empty"
    empty.mkdir()
    assert main(["--root", str(empty), "find", "pnpm"]) == 2


def subcommands() -> dict[str, argparse.ArgumentParser]:
    action = next(a for a in parser()._actions if isinstance(a, argparse._SubParsersAction))
    return dict(action.choices)


def test_read_help_explains_end_before_body_and_shows_example() -> None:
    help_text = subcommands()["read"].format_help()
    assert "If --end lies before the first body line" in help_text
    assert "dummkopf read notes/topic.md --end 3" in help_text


def test_every_option_has_help_and_every_command_an_example() -> None:
    for name, command in subcommands().items():
        assert "Example" in (command.epilog or ""), name
        for action in command._actions:
            if action.dest != "help" and not isinstance(action, argparse._SubParsersAction):
                assert action.help, name + " " + action.dest
