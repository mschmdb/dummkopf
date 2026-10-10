"""Read commands: find, context and read. Output format, JSON keys, budgets and line ranges."""

from __future__ import annotations

import json
import re

import pytest

from .conftest import Brain, note, rev_of

HEADER = re.compile(r"^(?P<path>\S+) \| rev=(?P<rev>[0-9a-f]{12}) \| updated=(?P<updated>\S+) \| "
                    r"status=(?P<status>\S+) \| scope=(?P<scope>\S+)$")
HIT_KEYS = {"path", "title", "updated", "status", "scope", "key_fact", "lines", "revision"}
PACKET_KEYS = {"hits", "match", "more", "truncated"}
DOC = ("---\nupdated: 2026-10-04\nstatus: active\nkey_fact: Fact here.\n---\n\n# Docker\n\npnpm esbuild fails\n\n"
       "## Open questions\n\nOne\n\n## Other\n\nTwo\n")


@pytest.fixture
def docker(brain: Brain) -> Brain:
    brain.write("notes/docker.md", DOC)
    return brain


def lines_of(output: str) -> list[tuple[int, str]]:
    return [(int(match[1]), match[2]) for line in output.splitlines() if (match := re.match(r"^(\d+): ?(.*)$", line))]


# --- header and text format -------------------------------------------------------------------------------------


def test_read_prints_a_header_with_path_rev_updated_status_and_scope(docker: Brain) -> None:
    result = docker.run("read", "notes/docker.md")
    assert result.code == 0
    match = HEADER.match(result.out.splitlines()[0])
    assert match is not None
    assert match["path"] == "notes/docker.md"
    assert (match["updated"], match["status"], match["scope"]) == ("2026-10-04", "active", "mixed")


def test_read_prints_the_key_fact_after_the_header(docker: Brain) -> None:
    assert docker.run("read", "notes/docker.md").out.splitlines()[1] == "Key fact: Fact here."


def test_read_omits_the_key_fact_line_without_a_key_fact(brain: Brain) -> None:
    brain.write("notes/plain.md", note("Plain"))
    assert "Key fact:" not in brain.run("read", "notes/plain.md").out


def test_header_shows_question_marks_for_missing_updated_and_status(brain: Brain) -> None:
    brain.write("notes/bare.md", "# Bare\n\ntext\n")
    header = brain.run("read", "notes/bare.md").out.splitlines()[0]
    assert " | updated=? | status=? | scope=mixed" in header


def test_read_output_starts_after_the_frontmatter_with_physical_line_numbers(docker: Brain) -> None:
    numbered = lines_of(docker.run("read", "notes/docker.md").out)
    assert numbered[0] == (7, "# Docker")
    assert numbered[-1] == (17, "Two")
    file_lines = DOC.splitlines()
    assert all(file_lines[number - 1] == text for number, text in numbered)


def test_read_without_frontmatter_starts_at_line_1(brain: Brain) -> None:
    brain.write("notes/bare.md", "# Bare\n\ntext\n")
    assert lines_of(brain.run("read", "notes/bare.md").out)[0] == (1, "# Bare")


def test_rev_in_the_header_is_the_start_of_the_json_revision(docker: Brain) -> None:
    text = docker.run("read", "notes/docker.md").out
    revision = json.loads(docker.run("read", "notes/docker.md", "--json").out)["hits"][0]["revision"]
    assert re.fullmatch(r"[0-9a-f]{64}", revision)
    assert revision.startswith(rev_of(text, "notes/docker.md"))


def test_revision_changes_when_the_file_changes(docker: Brain) -> None:
    before = rev_of(docker.run("read", "notes/docker.md").out, "notes/docker.md")
    docker.write("notes/docker.md", DOC + "\nMore\n")
    assert rev_of(docker.run("read", "notes/docker.md").out, "notes/docker.md") != before


def test_revision_is_sha256_of_the_file_bytes(docker: Brain) -> None:
    import hashlib

    expected = hashlib.sha256((docker.root / "notes/docker.md").read_bytes()).hexdigest()
    assert json.loads(docker.run("read", "notes/docker.md", "--json").out)["hits"][0]["revision"] == expected


# --- JSON ---------------------------------------------------------------------------------------------------------


def test_read_json_has_the_packet_and_hit_keys(docker: Brain) -> None:
    packet = json.loads(docker.run("read", "notes/docker.md", "--json").out)
    assert set(packet) == PACKET_KEYS
    assert (packet["match"], packet["more"], packet["truncated"]) == ("direct", False, False)
    hit = packet["hits"][0]
    assert set(hit) == HIT_KEYS
    assert (hit["path"], hit["title"], hit["updated"], hit["status"], hit["scope"], hit["key_fact"]) == (
        "notes/docker.md", "Docker", "2026-10-04", "active", "mixed", "Fact here.")


def test_read_json_lines_carry_n_and_text(docker: Brain) -> None:
    lines = json.loads(docker.run("read", "notes/docker.md", "--json").out)["hits"][0]["lines"]
    assert lines[0] == {"n": 7, "text": "# Docker"}
    assert all(set(line) == {"n", "text"} for line in lines)


def test_json_output_is_compact_on_one_line(docker: Brain) -> None:
    out = docker.run("read", "notes/docker.md", "--json").out
    assert out.count("\n") == 1
    assert ", " not in out.split('"lines"')[0]


def test_title_falls_back_to_the_file_name_without_heading(brain: Brain) -> None:
    brain.write("notes/headless.md", "no heading\n")
    assert json.loads(brain.run("read", "notes/headless.md", "--json").out)["hits"][0]["title"] == "headless"


def test_find_json_without_hits_has_the_missing_terms(docker: Brain) -> None:
    packet = json.loads(docker.run("find", "zzz", "--json").out)
    assert packet == {"hits": [], "match": "none", "more": False, "truncated": False, "missing": ["zzz"]}


def test_find_json_partial_match_lists_missing_terms(docker: Brain) -> None:
    packet = json.loads(docker.run("find", "docker pnpm zzz", "--json").out)
    assert packet["match"] == "partial"
    assert packet["missing"] == ["zzz"]
    assert "ignored" not in packet


def test_context_json_lists_ignored_filler_words(docker: Brain) -> None:
    packet = json.loads(docker.run("context", "What is the docker thing?", "--json").out)
    assert packet["ignored"] == ["what", "is", "the"]
    assert packet["missing"] == ["thing"]
    assert packet["match"] == "partial"


# --- find ----------------------------------------------------------------------------------------------------------


def test_find_matches_title_alias_key_fact_path_and_body(brain: Brain) -> None:
    brain.write("notes/by-title.md", note("Zebra"))
    brain.write("notes/other.md", note("Other", fields="aliases: [giraffe]\n"))
    brain.write("notes/third.md", note("Third", fields="key_fact: Contains okapi trivia.\n"))
    brain.write("notes/lion-facts.md", note("Fourth"))
    brain.write("notes/fifth.md", note("Fifth", "A mention of tapir in the body."))
    for term, path in [("zebra", "notes/by-title.md"), ("giraffe", "notes/other.md"),
                       ("okapi", "notes/third.md"), ("lion", "notes/lion-facts.md"),
                       ("tapir", "notes/fifth.md")]:
        assert path in brain.run("find", term).out, term


def test_find_is_case_insensitive(docker: Brain) -> None:
    assert "notes/docker.md" in docker.run("find", "DOCKER").out


def test_find_header_lists_each_hit_and_a_blank_line_separates_hits(brain: Brain) -> None:
    brain.write("notes/one.md", note("One", "widget"))
    brain.write("notes/two.md", note("Two", "widget"))
    lines = brain.run("find", "widget").out.splitlines()
    assert [line.split(" ")[0] for line in lines if HEADER.match(line)] == ["notes/one.md", "notes/two.md"]
    assert "" in lines


def test_find_ranks_notes_with_all_keywords_first(brain: Brain) -> None:
    brain.write("notes/a-one.md", note("One", "alpha"))
    brain.write("notes/b-both.md", note("Both", "alpha beta"))
    hits = json.loads(brain.run("find", "alpha beta", "--json").out)["hits"]
    assert [hit["path"] for hit in hits] == ["notes/b-both.md"]
    assert json.loads(brain.run("find", "alpha beta", "--json").out)["match"] == "all"


def test_find_limit_caps_hits_and_sets_more(brain: Brain) -> None:
    for index in range(5):
        brain.write(f"notes/n{index}.md", note(f"N{index}", "widget"))
    packet = json.loads(brain.run("find", "widget", "--json", "--limit", "2").out)
    assert len(packet["hits"]) == 2
    assert packet["more"] is True


def test_find_default_limit_is_3(brain: Brain) -> None:
    for index in range(5):
        brain.write(f"notes/n{index}.md", note(f"N{index}", "widget"))
    assert len(json.loads(brain.run("find", "widget", "--json").out)["hits"]) == 3


def test_find_limit_from_config_applies(brain: Brain) -> None:
    brain.configure("[limits]\nfind_limit = 1\n")
    for index in range(3):
        brain.write(f"notes/n{index}.md", note(f"N{index}", "widget"))
    assert len(json.loads(brain.run("find", "widget", "--json").out)["hits"]) == 1


def test_find_text_announces_more_hits(brain: Brain) -> None:
    for index in range(5):
        brain.write(f"notes/n{index}.md", note(f"N{index}", "widget"))
    assert "More hits available; narrow the search or raise --limit." in brain.run("find", "widget").out


def test_find_text_announces_partial_match_and_missing_terms(docker: Brain) -> None:
    out = docker.run("find", "docker pnpm zzz").out
    assert out.splitlines()[:2] == ["Partial match: not all keywords match.", "Not found: zzz"]


def test_find_excerpt_lines_exist_in_the_file(docker: Brain) -> None:
    file_lines = DOC.splitlines()
    for number, text in lines_of(docker.run("find", "esbuild").out):
        assert file_lines[number - 1] == text


@pytest.mark.parametrize("value", ["0", "11", "-1"])
def test_find_limit_outside_1_to_10_exits_2(docker: Brain, value: str) -> None:
    result = docker.run("find", "docker", "--limit", value)
    assert result.code == 2
    assert result.err == "--limit must be between 1 and 10.\n"


def test_find_with_an_empty_query_exits_2(docker: Brain) -> None:
    result = docker.run("find", "")
    assert result.code == 2
    assert result.err == "The search needs at least one keyword.\n"


def test_find_with_only_punctuation_exits_2(docker: Brain) -> None:
    assert docker.run("find", "?!").code == 2


def test_find_without_results_exits_0(docker: Brain) -> None:
    result = docker.run("find", "zzz")
    assert result.code == 0
    assert result.out == "Nothing found in released sources.\nNot found: zzz\n"


def test_find_topic_limits_the_search_to_one_topic_folder(brain: Brain) -> None:
    brain.write("topics/a/README.md", "---\nscope: work\n---\n\n# A\n\nwidget\n")
    brain.write("topics/b/README.md", "---\nscope: work\n---\n\n# B\n\nwidget\n")
    paths = [hit["path"] for hit in json.loads(brain.run("find", "widget", "--topic", "a", "--json").out)["hits"]]
    assert paths == ["topics/a/README.md"]


def test_find_topic_rejects_a_bad_topic_name(docker: Brain) -> None:
    result = docker.run("find", "docker", "--topic", "a b")
    assert result.code == 2
    assert result.err == "Invalid topic name. Use letters, digits and hyphens.\n"


def test_topic_option_denies_reads_outside_the_topic(docker: Brain) -> None:
    assert docker.run("read", "notes/docker.md", "--topic", "elsewhere").code == 2


# --- context -------------------------------------------------------------------------------------------------------


def test_context_names_the_ignored_filler_words(docker: Brain) -> None:
    out = docker.run("context", "What is the docker thing?").out
    assert "Ignored: what, is, the" in out
    assert "Not found: thing" in out


def test_context_with_only_filler_words_finds_nothing_and_exits_0(docker: Brain) -> None:
    result = docker.run("context", "the")
    assert result.code == 0
    assert result.out == "Nothing found in released sources.\n"


def test_context_with_an_empty_query_exits_2(docker: Brain) -> None:
    result = docker.run("context", "")
    assert result.code == 2
    assert result.err == "The query needs at least one word.\n"


def test_find_keeps_filler_words_as_search_terms(docker: Brain) -> None:
    assert "Ignored:" not in docker.run("find", "what is docker").out


# --- budgets -------------------------------------------------------------------------------------------------------


@pytest.fixture
def long_note(brain: Brain) -> Brain:
    body = "\n".join(f"Line {index} " + "x" * 60 for index in range(200))
    brain.write("notes/long.md", note("Long", body))
    return brain


@pytest.mark.parametrize("budget", [500, 777, 2000])
def test_read_text_stays_within_max_chars(long_note: Brain, budget: int) -> None:
    out = long_note.run("read", "notes/long.md", "--max-chars", str(budget)).out
    assert len(out) <= budget
    assert "Output truncated; read specific lines or raise --max-chars." in out


@pytest.mark.parametrize("budget", [500, 777, 2000])
def test_read_json_stays_within_max_chars_and_stays_valid(long_note: Brain, budget: int) -> None:
    out = long_note.run("read", "notes/long.md", "--json", "--max-chars", str(budget)).out
    assert len(out) <= budget
    assert json.loads(out)["truncated"] is True


def test_truncated_read_keeps_the_first_lines(long_note: Brain) -> None:
    numbered = lines_of(long_note.run("read", "notes/long.md", "--max-chars", "800").out)
    assert numbered[0][1] == "# Long"
    assert [number for number, _ in numbered] == list(range(numbered[0][0], numbered[0][0] + len(numbered)))


def test_read_within_the_budget_is_not_truncated(docker: Brain) -> None:
    assert json.loads(docker.run("read", "notes/docker.md", "--json").out)["truncated"] is False


def test_find_output_stays_within_max_chars(brain: Brain) -> None:
    for index in range(6):
        brain.write(f"notes/n{index}.md", note(f"N{index}", "widget " + "y" * 200))
    result = brain.run("find", "widget", "--limit", "6", "--json", "--max-chars", "500")
    assert len(result.out) <= 500
    packet = json.loads(result.out)
    assert packet["truncated"] is True
    assert len(packet["hits"]) < 6
    assert packet["more"] is True


def test_max_chars_comes_from_the_config_when_not_given(long_note: Brain) -> None:
    long_note.configure("[limits]\nmax_chars = 600\n")
    assert len(long_note.run("read", "notes/long.md").out) <= 600


@pytest.mark.parametrize("value", ["499", "20001", "0"])
def test_max_chars_outside_500_to_20000_exits_2(docker: Brain, value: str) -> None:
    result = docker.run("find", "docker", "--max-chars", value)
    assert result.code == 2
    assert result.err == "--max-chars must be between 500 and 20000.\n"


def test_max_chars_is_checked_for_read_too(docker: Brain) -> None:
    assert docker.run("read", "notes/docker.md", "--max-chars", "10").code == 2


def test_non_numeric_max_chars_exits_2(docker: Brain) -> None:
    result = docker.run("find", "docker", "--max-chars", "abc")
    assert result.code == 2
    assert "invalid int value" in result.err


# --- read: sections and ranges ---------------------------------------------------------------------------------


def test_section_returns_the_heading_through_the_line_before_the_next_equal_or_higher_heading(docker: Brain) -> None:
    assert lines_of(docker.run("read", "notes/docker.md", "--section", "Open questions").out) == [
        (11, "## Open questions"), (12, ""), (13, "One"), (14, "")]


def test_section_matches_the_start_of_the_heading_ignoring_case(docker: Brain) -> None:
    out = docker.run("read", "notes/docker.md", "--section", "open").out
    assert lines_of(out)[0] == (11, "## Open questions")


def test_section_includes_nested_headings(brain: Brain) -> None:
    brain.write("notes/nest.md", "# Top\n\n## Parent\n\ntext\n\n### Child\n\ndeep\n\n## Sibling\n\nlast\n")
    out = brain.run("read", "notes/nest.md", "--section", "parent").out
    assert [text for _, text in lines_of(out)] == ["## Parent", "", "text", "", "### Child", "", "deep", ""]


def test_last_section_runs_to_the_end_of_the_file(docker: Brain) -> None:
    assert lines_of(docker.run("read", "notes/docker.md", "--section", "Other").out)[-1] == (17, "Two")


def test_section_json_has_the_section_lines(docker: Brain) -> None:
    lines = json.loads(docker.run("read", "notes/docker.md", "--section", "Other", "--json").out)["hits"][0]["lines"]
    assert [line["n"] for line in lines] == [15, 16, 17]


def test_section_ignores_headings_inside_code_fences(brain: Brain) -> None:
    brain.write("notes/fence.md", "# Top\n\n```\n## Fake\n```\n\n## Real\n\nbody\n")
    assert brain.run("read", "notes/fence.md", "--section", "fake").code == 2


def test_missing_section_exits_2(docker: Brain) -> None:
    result = docker.run("read", "notes/docker.md", "--section", "Nope")
    assert result.code == 2
    assert result.err == "The section is missing or ambiguous. Give a more precise heading.\n"


def test_ambiguous_section_exits_2(brain: Brain) -> None:
    brain.write("notes/dup.md", "# Top\n\n## Same\n\na\n\n## Same\n\nb\n")
    assert brain.run("read", "notes/dup.md", "--section", "same").code == 2


def test_section_without_words_exits_2(docker: Brain) -> None:
    result = docker.run("read", "notes/docker.md", "--section", "!!")
    assert result.code == 2
    assert result.err == "A section needs a heading.\n"


def test_section_with_a_line_range_exits_2(docker: Brain) -> None:
    result = docker.run("read", "notes/docker.md", "--section", "Other", "--start", "3")
    assert result.code == 2
    assert result.err == "Do not combine --section with a line range.\n"


def test_start_and_end_select_an_inclusive_range(docker: Brain) -> None:
    assert lines_of(docker.run("read", "notes/docker.md", "--start", "9", "--end", "11").out) == [
        (9, "pnpm esbuild fails"), (10, ""), (11, "## Open questions")]


def test_start_1_shows_the_frontmatter(docker: Brain) -> None:
    assert [text for _, text in lines_of(docker.run("read", "notes/docker.md", "--start", "1", "--end", "5").out)] == [
        "---", "updated: 2026-10-04", "status: active", "key_fact: Fact here.", "---"]


def test_end_before_the_first_body_line_starts_at_line_1(docker: Brain) -> None:
    assert lines_of(docker.run("read", "notes/docker.md", "--end", "2").out) == [(1, "---"), (2, "updated: 2026-10-04")]


def test_end_at_or_after_the_first_body_line_still_skips_the_frontmatter(docker: Brain) -> None:
    assert lines_of(docker.run("read", "notes/docker.md", "--end", "8").out) == [(7, "# Docker"), (8, "")]


def test_start_alone_reads_to_the_end(docker: Brain) -> None:
    numbered = lines_of(docker.run("read", "notes/docker.md", "--start", "15").out)
    assert numbered[0][0] == 15
    assert numbered[-1] == (17, "Two")


def test_start_beyond_the_file_returns_no_lines(docker: Brain) -> None:
    result = docker.run("read", "notes/docker.md", "--start", "99")
    assert result.code == 0
    assert lines_of(result.out) == []


@pytest.mark.parametrize("args", [("--start", "0"), ("--start", "-3"), ("--start", "5", "--end", "3"),
                                  ("--end", "0")])
def test_invalid_line_range_exits_2(docker: Brain, args: tuple[str, ...]) -> None:
    result = docker.run("read", "notes/docker.md", *args)
    assert result.code == 2
    assert result.err == "Invalid line range.\n"


def test_read_without_a_path_exits_2_with_usage(docker: Brain) -> None:
    result = docker.run("read")
    assert result.code == 2
    assert "usage: dummkopf read" in result.err


def test_read_accepts_only_md_files_inside_note_folders(docker: Brain) -> None:
    docker.write("dummkopf-notes.txt", "x")
    docker.write("other/file.md", "# x\n")
    for path in ("dummkopf-notes.txt", "other/file.md", "dummkopf.toml", "notes", "notes/"):
        assert docker.run("read", path).code == 2, path


def test_unknown_command_exits_2(docker: Brain) -> None:
    assert docker.run("bogus").code == 2


def test_help_exits_0_and_lists_the_commands(docker: Brain) -> None:
    result = docker.run("--help")
    assert result.code == 0
    for command in ("context", "find", "read", "ingest", "write", "check", "sync", "init", "install", "hook",
                    "meta", "links", "curator"):
        assert command in result.out


def test_help_mentions_root_and_serious(docker: Brain) -> None:
    out = docker.run("--help").out
    assert "--root" in out
    assert "--serious" in out
