"""`ingest` packets: shapes, replace and append, metadata, all-or-nothing validation and path rules."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from .conftest import Brain, Synced, ingest, md, new, package, rev, topic

SAVED = "Write status: saved; sync: ok\n"
# "Proven content." occurs in the frontmatter too, so the swap names the heading above it.
FIRST_BODY_SWAP = {"old": "# First\n\nProven content.", "new": "# First\n\nFixed."}


# --- packet shapes ---------------------------------------------------------------------------------------------


def test_ingest_content_creates_several_files_in_one_commit(synced: Synced) -> None:
    result = ingest(synced.brain, new("notes/one.md"), new("notes/two.md"))
    assert result.code == 0
    assert result.out == SAVED + "Changed: notes/one.md\nChanged: notes/two.md\n"
    assert synced.remote_log()[:2] == ["Update notes", "Initial"]
    assert synced.brain.exists("notes/one.md")
    assert synced.brain.exists("notes/two.md")


def test_ingest_reads_the_package_from_a_file(repo: Brain, tmp_path: Path) -> None:
    source = tmp_path / "package.json"
    source.write_text(package(new("notes/one.md")), encoding="utf-8")
    assert repo.run("ingest", "--input", str(source)).code == 0
    assert repo.exists("notes/one.md")


def test_ingest_json_output_lists_changed_and_revisions(repo: Brain) -> None:
    data = json.loads(ingest(repo, new("notes/one.md"), args=("--json",)).out)
    assert list(data) == ["changed", "unchanged", "revisions", "issues", "saved", "sync"]
    assert list(data["revisions"]) == ["notes/one.md"]
    assert data["saved"] is True


def test_ingest_replace_swaps_one_exact_text(repo: Brain) -> None:
    current = rev(repo, "notes/first.md")
    entry = {"path": "notes/first.md", "expected": current, "replace": [FIRST_BODY_SWAP]}
    result = ingest(repo, entry)
    assert result.code == 0
    assert "\nFixed.\n" in repo.read("notes/first.md")


def test_ingest_replace_can_apply_several_pairs(repo: Brain) -> None:
    repo.run("write", "notes/pairs.md", "--expected", "new", stdin=md("alpha and beta"))
    entry = {"path": "notes/pairs.md", "expected": rev(repo, "notes/pairs.md"),
             "replace": [{"old": "alpha", "new": "one"}, {"old": "beta", "new": "two"}]}
    assert ingest(repo, entry).code == 0
    assert "one and two" in repo.read("notes/pairs.md")


def test_ingest_replace_can_delete_text_with_an_empty_new(repo: Brain) -> None:
    repo.run("write", "notes/pairs.md", "--expected", "new", stdin=md("keep drop"))
    entry = {"path": "notes/pairs.md", "expected": rev(repo, "notes/pairs.md"),
             "replace": [{"old": " drop", "new": ""}]}
    assert ingest(repo, entry).code == 0
    assert "keep\n" in repo.read("notes/pairs.md")


def test_ingest_replace_repeated_with_the_same_revision_is_unchanged(repo: Brain) -> None:
    entry = {"path": "notes/first.md", "expected": rev(repo, "notes/first.md"),
             "replace": [FIRST_BODY_SWAP]}
    ingest(repo, entry)
    again = ingest(repo, entry)
    assert again.code == 0
    assert again.out == SAVED + "Unchanged: notes/first.md\n"


@pytest.mark.parametrize("old", ["no such text", "e"])
def test_ingest_replace_with_a_missing_or_ambiguous_old_text_exits_2(repo: Brain, old: str) -> None:
    entry = {"path": "notes/first.md", "expected": rev(repo, "notes/first.md"), "replace": [{"old": old, "new": "x"}]}
    result = ingest(repo, entry)
    assert result.code == 2
    assert result.err == "The old text is missing or ambiguous. Read the original passage again.\n"


@pytest.mark.parametrize("pairs", [[], "text", [{"old": "", "new": "x"}], [{"old": "a"}], [{"old": "a", "new": 1}],
                                   [{"old": "a", "new": "b", "extra": "c"}]])
def test_ingest_replace_with_malformed_pairs_exits_2(repo: Brain, pairs: Any) -> None:
    entry = {"path": "notes/first.md", "expected": rev(repo, "notes/first.md"), "replace": pairs}
    assert ingest(repo, entry).code == 2


def test_ingest_replace_on_a_missing_file_exits_2(repo: Brain) -> None:
    entry = {"path": "notes/absent.md", "expected": "0123456789ab", "replace": [{"old": "a", "new": "b"}]}
    assert ingest(repo, entry).code == 2


def test_ingest_append_adds_text(repo: Brain) -> None:
    entry = {"path": "notes/first.md", "expected": rev(repo, "notes/first.md"), "append": "## New\n- Fact"}
    assert ingest(repo, entry).code == 0
    assert repo.read("notes/first.md").endswith("\n\n## New\n- Fact\n")


def test_ingest_metadata_overrides_frontmatter_fields(repo: Brain) -> None:
    entry = new("notes/meta.md", "# M\n\nbody\n", metadata={"key_fact": "From metadata", "aliases": ["a", "b"]})
    assert ingest(repo, entry).code == 0
    text = repo.read("notes/meta.md")
    assert "key_fact: From metadata\n" in text
    assert "aliases: [a, b]\n" in text
    assert "summary: From metadata\n" in text


@pytest.mark.parametrize("metadata", [{"key_fact": 5}, {"bad key": "v"}, {"key_fact": "line\nbreak"},
                                      {"aliases": [1]}, {"key_fact": None}])
def test_ingest_invalid_metadata_exits_2(repo: Brain, metadata: dict[str, Any]) -> None:
    result = ingest(repo, new("notes/meta.md", "# M\n\nbody\n", metadata=metadata))
    assert result.code == 2
    assert result.err == "Metadata needs valid keys and string or string-list values.\n"


def test_ingest_dry_run_validates_and_saves_nothing(repo: Brain) -> None:
    result = ingest(repo, new("notes/one.md"), args=("--dry-run",))
    assert result.out == "Write status: preview; sync: not-run\nChanged: notes/one.md\n"
    assert not repo.exists("notes/one.md")


def test_ingest_repeating_a_new_file_package_is_a_conflict_when_content_differs(repo: Brain) -> None:
    ingest(repo, new("notes/one.md"))
    assert ingest(repo, new("notes/one.md", md("different"))).code == 2


def test_ingest_repeating_the_identical_new_file_package_is_unchanged(repo: Brain) -> None:
    ingest(repo, new("notes/one.md"))
    again = ingest(repo, new("notes/one.md"))
    assert again.code == 0
    assert again.out == SAVED + "Unchanged: notes/one.md\n"


# --- all or nothing --------------------------------------------------------------------------------------------


def test_one_invalid_entry_rejects_the_whole_package(synced: Synced) -> None:
    head = synced.brain.git("rev-parse", "HEAD")
    result = ingest(synced.brain, new("notes/good.md"), new("notes/bad.md", "no heading"))
    assert result.code == 2
    assert not synced.brain.exists("notes/good.md")
    assert not synced.brain.exists("notes/bad.md")
    assert synced.brain.git("rev-parse", "HEAD") == head
    assert synced.remote_log() == ["Initial"]


def test_a_stale_entry_rejects_the_whole_package(repo: Brain) -> None:
    stale = {"path": "notes/first.md", "expected": "0123456789ab", "append": "x"}
    result = ingest(repo, new("notes/good.md"), stale)
    assert result.code == 2
    assert not repo.exists("notes/good.md")


def test_errors_name_every_broken_file_and_the_rule_codes(repo: Brain) -> None:
    result = ingest(repo, new("notes/a.md", "no heading"), new("notes/b.md", "no heading either"))
    assert result.err.startswith("The write package breaks the rules: body, key_fact, summary.\n")
    for name in ("notes/a.md", "notes/b.md"):
        assert f"- {name}: Content and an H1 heading are missing." in result.err


@pytest.mark.parametrize(("raw", "message"), [
    ("[]", "A write package must contain only `changes`."),
    ('{"changes": [], "extra": 1}', "A write package must contain only `changes`."),
    ('{"other": []}', "A write package must contain only `changes`."),
    ('{"changes": []}', "changes needs 1 to 50 file entries."),
    ('{"changes": "x"}', "changes needs 1 to 50 file entries."),
])
def test_packet_shape_errors(repo: Brain, raw: str, message: str) -> None:
    result = repo.run("ingest", "--input", "-", stdin=raw)
    assert result.code == 2
    assert result.err == message + "\n"


def test_more_entries_than_max_changes_exits_2(repo: Brain) -> None:
    repo.configure("[limits]\nmax_changes = 1\n")
    repo.commit("config")
    result = ingest(repo, new("notes/one.md"), new("notes/two.md"))
    assert result.code == 2
    assert result.err == "changes needs 1 to 1 file entries.\n"


ENTRY_ERROR = ("Each entry needs path, expected and exactly one of content, replace or append; "
               "metadata is optional.\n")


@pytest.mark.parametrize("entry", [
    {"path": "notes/a.md", "content": "# T\n"},
    {"expected": None, "content": "# T\n"},
    {"path": "notes/a.md", "expected": None},
    {"path": "notes/a.md", "expected": None, "content": "# T\n", "append": "x"},
    {"path": "notes/a.md", "expected": None, "content": "# T\n", "other": 1},
    {"path": 5, "expected": None, "content": "# T\n"},
    {"path": "notes/a.md", "expected": None, "content": 5},
    {"path": "notes/a.md", "expected": None, "content": "# T\n", "metadata": []},
    "notes/a.md",
])
def test_entry_shape_errors(repo: Brain, entry: Any) -> None:
    result = ingest(repo, entry)
    assert result.code == 2
    assert result.err == ENTRY_ERROR


def test_a_path_may_appear_once_per_package(repo: Brain) -> None:
    result = ingest(repo, new("notes/a.md"), new("notes/a.md"))
    assert result.code == 2
    assert result.err == "A target path may appear only once per package.\n"


@pytest.mark.parametrize("expected", ["abc", "ZZZZZZZZZZZZ", 12, "0123456789a"])
def test_expected_must_be_null_or_a_revision(repo: Brain, expected: Any) -> None:
    entry = {"path": "notes/a.md", "expected": expected, "content": md()}
    result = ingest(repo, entry)
    assert result.code == 2
    assert result.err.startswith("expected must be null for new files or a revision")


def test_broken_json_reports_message_line_and_column(repo: Brain) -> None:
    result = repo.run("ingest", "--input", "-", stdin='{"changes": [\n  {"path": }]}')
    assert result.code == 2
    assert result.err.startswith("The JSON write package is not readable: Expecting value (line 2, column 12). ")
    assert "quoted heredoc" in result.err


def test_empty_input_is_broken_json(repo: Brain) -> None:
    result = repo.run("ingest", "--input", "-", stdin="")
    assert result.code == 2
    assert "(line 1, column 1)" in result.err


def test_input_larger_than_max_input_chars_exits_2(repo: Brain) -> None:
    repo.configure("[limits]\nmax_input_chars = 50\n")
    repo.commit("config")
    result = ingest(repo, new("notes/a.md", md("x" * 200)))
    assert result.code == 2
    assert result.err == "The write package is too large.\n"


# --- paths ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["notes/Bad_Name.md", "notes/UPPER.md", "notes/my_note.md", "notes/x.txt",
                                  "notes/two--dashes.md", "notes/-lead.md", "notes/has space.md"])
def test_non_kebab_case_paths_are_rejected(repo: Brain, path: str) -> None:
    result = ingest(repo, new(path))
    assert result.code == 2
    assert result.err == "Target paths need kebab-case names and .md files.\n"


@pytest.mark.parametrize("path", ["notes/a.md", "notes/my-note-2.md", "notes/2026-10-05.md", "bookmarks/ai-tools.md"])
def test_kebab_case_paths_are_accepted(repo: Brain, path: str) -> None:
    assert ingest(repo, new(path)).code == 0


@pytest.mark.parametrize(("path", "message"), [
    ("notes/sub/deep.md", "Notes and bookmarks need a flat target path, e.g. notes/<name>.md."),
    ("bookmarks/sub/deep.md", "Notes and bookmarks need a flat target path, e.g. bookmarks/<name>.md."),
    ("topics/solo.md", "Topic files need a topic folder, e.g. topics/<topic>/<file>.md."),
])
def test_path_depth_rules(repo: Brain, path: str, message: str) -> None:
    result = ingest(repo, new(path))
    assert result.code == 2
    assert result.err == message + "\n"


@pytest.mark.parametrize("path", ["../escape.md", "/tmp/escape.md", "other/x.md", "sources/x.md", "x.md",
                                  "notes\\x.md", "dummkopf.toml"])
def test_paths_outside_the_note_folders_are_denied(repo: Brain, path: str) -> None:
    result = ingest(repo, new(path))
    assert result.code == 2
    assert result.err == "Path unavailable or access excluded.\n"


def test_readme_may_use_its_uppercase_name(repo: Brain) -> None:
    assert ingest(repo, *topic("fresh")).code == 0


def test_folder_names_in_topics_must_be_kebab_case_too(repo: Brain) -> None:
    result = ingest(repo, *topic("Bad_Topic"))
    assert result.code == 2
    assert result.err == "Target paths need kebab-case names and .md files.\n"


def test_originals_under_a_sources_folder_stay_unchanged(repo: Brain) -> None:
    ingest(repo, *topic("work"), new("topics/work/sources/orig.md", "# Orig\n\nverbatim\n", metadata={"key_fact": "k"}))
    entry = {"path": "topics/work/sources/orig.md", "expected": rev(repo, "topics/work/sources/orig.md"),
             "append": "edited"}
    result = ingest(repo, entry)
    assert result.code == 2
    assert result.err == "Originals under sources/ stay unchanged.\n"
