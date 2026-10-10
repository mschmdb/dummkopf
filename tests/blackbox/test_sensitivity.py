"""Sensitivity: markers, lists, grants, oracles, path spelling, symlinks and a missing paths file."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from .conftest import Brain, note

DENIED = "Path unavailable or access excluded.\n"
SECRET_BODY = "secretword here"


def found_paths(brain: Brain, command: str, query: str, *extra: str) -> list[str]:
    packet = json.loads(brain.run(command, query, "--json", *extra).out)
    return [hit["path"] for hit in packet["hits"]]


def hidden_everywhere(brain: Brain, path: str, word: str = "secretword") -> None:
    """Assert that read, find, context and check all keep a path out."""
    assert brain.run("read", path).err == DENIED
    for command in ("find", "context"):
        assert path not in found_paths(brain, command, word)
    assert brain.run("check", path).code == 2


@pytest.fixture
def open_brain(brain: Brain) -> Brain:
    brain.write("notes/open.md", note("Open", "visible words"))
    return brain


# --- what makes a note sensitive ------------------------------------------------------------------------------


def test_marker_line_in_the_file_hides_it(open_brain: Brain) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    hidden_everywhere(open_brain, "notes/marked.md")


@pytest.mark.parametrize("marker", ["    > SENSITIVE", "\t> SENSITIVE", ">SENSITIVE", "> sensitive", ">   SENSITIVE",
                                    " > SENSITIVE", "> SENSITIVE trailing words"])
def test_marker_variants_hide_the_file(open_brain: Brain, marker: str) -> None:
    open_brain.write("notes/variant.md", note("Variant", marker + "\n\n" + SECRET_BODY))
    hidden_everywhere(open_brain, "notes/variant.md")


def test_marker_after_a_byte_order_mark_hides_the_file(open_brain: Brain) -> None:
    open_brain.write("notes/bom.md", "﻿> SENSITIVE\n" + note("Bom", SECRET_BODY))
    hidden_everywhere(open_brain, "notes/bom.md")


def test_marker_on_a_crlf_line_hides_the_file(open_brain: Brain) -> None:
    text = "---\r\nupdated: 2026-10-04\r\n---\r\n\r\n# Crlf\r\n\r\n> SENSITIVE\r\n" + SECRET_BODY + "\r\n"
    (open_brain.root / "notes").mkdir(exist_ok=True)
    (open_brain.root / "notes/crlf.md").write_bytes(text.encode())
    hidden_everywhere(open_brain, "notes/crlf.md")


def test_marker_on_a_cr_only_line_hides_the_file(open_brain: Brain) -> None:
    (open_brain.root / "notes/cr.md").write_bytes(("# Cr\r> SENSITIVE\r" + SECRET_BODY + "\r").encode())
    hidden_everywhere(open_brain, "notes/cr.md")


def test_marker_inside_a_sentence_does_not_hide_the_file(open_brain: Brain) -> None:
    open_brain.write("notes/prose.md", note("Prose", "The words > SENSITIVE appear mid-line, secretword"))
    assert "notes/prose.md" in open_brain.run("find", "secretword").out


def test_marker_in_the_topic_readme_hides_the_whole_topic(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    open_brain.write("topics/med/deep/more.md", note("More", SECRET_BODY))
    for path in ("topics/med/README.md", "topics/med/visit.md", "topics/med/deep/more.md"):
        hidden_everywhere(open_brain, path)


def test_marker_in_an_ancestor_readme_two_levels_up_hides_the_file(open_brain: Brain) -> None:
    open_brain.write("topics/a/README.md", "---\nscope: private\n---\n\n# A\n\n> SENSITIVE\n")
    open_brain.write("topics/a/b/c/deep.md", note("Deep", SECRET_BODY))
    hidden_everywhere(open_brain, "topics/a/b/c/deep.md")


def test_unmarked_sibling_topic_stays_visible(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/open/README.md", "---\nscope: private\n---\n\n# Open\n")
    open_brain.write("topics/open/x.md", note("X", "visible words"))
    assert "topics/open/x.md" in open_brain.run("find", "visible").out


def test_path_listed_in_the_paths_file_hides_the_file(open_brain: Brain) -> None:
    open_brain.write("notes/listed.md", note("Listed", SECRET_BODY))
    open_brain.write(".sensitive-paths", "# comment\n\nnotes/listed.md\n")
    hidden_everywhere(open_brain, "notes/listed.md")


def test_folder_listed_in_the_paths_file_hides_everything_below(open_brain: Brain) -> None:
    open_brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n")
    open_brain.write("topics/lst/item.md", note("Item", SECRET_BODY))
    open_brain.write(".sensitive-paths", "topics/lst/\n")
    hidden_everywhere(open_brain, "topics/lst/item.md")
    hidden_everywhere(open_brain, "topics/lst/README.md")


def test_paths_file_entries_match_regardless_of_case(open_brain: Brain) -> None:
    open_brain.write("notes/listed.md", note("Listed", SECRET_BODY))
    open_brain.write(".sensitive-paths", "Notes/Listed.md\n")
    hidden_everywhere(open_brain, "notes/listed.md")


def test_sensitive_always_prefix_hides_files_without_a_marker(open_brain: Brain) -> None:
    open_brain.configure('[sensitive]\nalways = ["topics/health/"]\n')
    open_brain.write("topics/health/README.md", "---\nscope: private\n---\n\n# Health\n")
    open_brain.write("topics/health/x.md", note("X", SECRET_BODY))
    hidden_everywhere(open_brain, "topics/health/x.md")


def test_sensitive_always_accepts_a_single_file(open_brain: Brain) -> None:
    open_brain.configure('[sensitive]\nalways = ["notes/always.md"]\n')
    open_brain.write("notes/always.md", note("Always", SECRET_BODY))
    hidden_everywhere(open_brain, "notes/always.md")


def test_custom_marker_replaces_the_default(open_brain: Brain) -> None:
    open_brain.configure('[sensitive]\nmarker = "> HUSH"\n')
    open_brain.write("notes/hush.md", note("Hush", "> HUSH\n\n" + SECRET_BODY))
    open_brain.write("notes/default.md", note("Default", "> SENSITIVE\n\n" + SECRET_BODY))
    hidden_everywhere(open_brain, "notes/hush.md")
    assert open_brain.run("read", "notes/default.md").code == 0


def test_hidden_notes_do_not_change_the_hits_of_visible_ones(open_brain: Brain) -> None:
    before = open_brain.run("find", "visible", "--json").out
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\nvisible words too"))
    assert open_brain.run("find", "visible", "--json").out == before


# --- oracles ----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("hidden", ["notes/marked.md", "topics/med/visit.md", "topics/lst/item.md"])
def test_hidden_and_missing_paths_answer_byte_identically_for_read(open_brain: Brain, hidden: str) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    open_brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n")
    open_brain.write("topics/lst/item.md", note("Item", SECRET_BODY))
    open_brain.write(".sensitive-paths", "topics/lst/\n")
    missing = open_brain.run("read", "notes/does-not-exist.md")
    result = open_brain.run("read", hidden)
    assert (result.code, result.out, result.err) == (missing.code, missing.out, missing.err)
    assert result.code == 2


def test_hidden_and_missing_paths_answer_identically_in_both_tones(open_brain: Brain) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    assert open_brain.cheeky("read", "notes/marked.md") == open_brain.cheeky("read", "notes/absent.md")


def test_hidden_and_missing_paths_answer_identically_for_check(open_brain: Brain) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    assert open_brain.run("check", "notes/marked.md") == open_brain.run("check", "notes/absent.md")


def test_hidden_file_in_a_missing_topic_looks_like_a_missing_file(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    assert open_brain.run("read", "topics/med/visit.md") == open_brain.run("read", "topics/none/visit.md")


# --- grants -----------------------------------------------------------------------------------------------------


def test_allow_sensitive_releases_the_named_file(open_brain: Brain) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    result = open_brain.run("read", "notes/marked.md", "--allow-sensitive", "notes/marked.md")
    assert result.code == 0
    assert SECRET_BODY in result.out


def test_allow_sensitive_grants_only_the_named_path(open_brain: Brain) -> None:
    open_brain.write("notes/one.md", note("One", "> SENSITIVE\n\n" + SECRET_BODY))
    open_brain.write("notes/two.md", note("Two", "> SENSITIVE\n\n" + SECRET_BODY))
    result = open_brain.run("read", "notes/two.md", "--allow-sensitive", "notes/one.md")
    assert result.code == 2
    assert result.err == DENIED


def test_allow_sensitive_topic_releases_the_topic_and_nothing_else(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    open_brain.write("topics/other/README.md", "---\nscope: private\n---\n\n# Other\n\n> SENSITIVE\n")
    open_brain.write("topics/other/x.md", note("X", SECRET_BODY))
    assert open_brain.run("read", "topics/med/visit.md", "--allow-sensitive", "topics/med").code == 0
    assert open_brain.run("read", "topics/other/x.md", "--allow-sensitive", "topics/med").code == 2


def test_allow_sensitive_topic_covers_a_listed_folder(open_brain: Brain) -> None:
    open_brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n")
    open_brain.write("topics/lst/item.md", note("Item", SECRET_BODY))
    open_brain.write(".sensitive-paths", "topics/lst/\n")
    assert open_brain.run("read", "topics/lst/item.md", "--allow-sensitive", "topics/lst").code == 0


def test_allow_sensitive_topic_lets_find_search_the_granted_topic(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    assert "topics/med/visit.md" not in open_brain.run("find", "secretword").out
    assert "topics/med/visit.md" in open_brain.run("find", "secretword", "--allow-sensitive", "topics/med").out


def test_allow_sensitive_can_repeat(open_brain: Brain) -> None:
    open_brain.write("notes/one.md", note("One", "> SENSITIVE\n\n" + SECRET_BODY))
    open_brain.write("notes/two.md", note("Two", "> SENSITIVE\n\n" + SECRET_BODY))
    out = open_brain.run("find", "secretword", "--allow-sensitive", "notes/one.md",
                         "--allow-sensitive", "notes/two.md").out
    assert "notes/one.md" in out
    assert "notes/two.md" in out


def test_allow_sensitive_for_a_different_file_does_not_release_a_variant(open_brain: Brain) -> None:
    open_brain.write("notes/indent.md", note("Indent", "    > SENSITIVE\n\n" + SECRET_BODY))
    assert open_brain.run("read", "notes/indent.md", "--allow-sensitive", "notes/open.md").code == 2


def test_allow_sensitive_marker_header_still_shows_the_scope(open_brain: Brain) -> None:
    open_brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    open_brain.write("topics/med/visit.md", note("Visit", SECRET_BODY))
    out = open_brain.run("read", "topics/med/visit.md", "--allow-sensitive", "topics/med").out
    assert out.splitlines()[0].endswith("scope=private")


def test_allow_sensitive_needs_a_topic_folder_or_an_md_file(open_brain: Brain) -> None:
    result = open_brain.run("read", "notes/open.md", "--allow-sensitive", "notes/folder")
    assert result.code == 2
    assert result.err == "--allow-sensitive needs a topic folder or a concrete .md file.\n"


@pytest.mark.parametrize("grant", ["notes", "topics", "../x.md", "/etc/x.md", "other/x.md"])
def test_allow_sensitive_rejects_paths_outside_the_note_folders(open_brain: Brain, grant: str) -> None:
    result = open_brain.run("read", "notes/open.md", "--allow-sensitive", grant)
    assert result.code == 2
    assert result.err == DENIED


# --- path spelling and escapes ----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["Notes/open.md", "notes/Open.md", "NOTES/OPEN.MD"])
def test_wrong_case_spelling_is_denied(open_brain: Brain, path: str) -> None:
    result = open_brain.run("read", path)
    assert result.code == 2
    assert result.err == DENIED


def test_wrong_case_spelling_of_a_hidden_topic_is_denied(open_brain: Brain) -> None:
    open_brain.write("topics/health/README.md", "---\nscope: private\n---\n\n# Health\n\n> SENSITIVE\n")
    open_brain.write("topics/health/x.md", note("X", SECRET_BODY))
    assert open_brain.run("read", "Topics/Health/x.md").err == DENIED


@pytest.mark.parametrize("path", ["../open.md", "notes/../notes/open.md", "/etc/passwd", "notes\\open.md",
                                  "dummkopf.toml", ".sensitive-paths", "notes"])
def test_paths_outside_the_note_folders_are_denied(open_brain: Brain, path: str) -> None:
    result = open_brain.run("read", path)
    assert result.code == 2
    assert result.err == DENIED


def test_files_in_folders_with_a_skill_file_are_denied(open_brain: Brain) -> None:
    open_brain.write("topics/skills/SKILL.md", "# Skill\n")
    open_brain.write("topics/skills/README.md", "---\nscope: private\n---\n\n# Skills\n")
    open_brain.write("topics/skills/other.md", note("Other", "visible skillword"))
    assert open_brain.run("read", "topics/skills/other.md").err == DENIED
    assert found_paths(open_brain, "find", "skillword") == []


# --- symlinks ------------------------------------------------------------------------------------------------------


def test_symlinked_note_is_not_readable_or_listed(open_brain: Brain) -> None:
    (open_brain.root / "notes/link.md").symlink_to(open_brain.root / "notes/open.md")
    assert open_brain.run("read", "notes/link.md").err == DENIED
    paths = [hit["path"] for hit in json.loads(open_brain.run("find", "visible", "--json").out)["hits"]]
    assert paths == ["notes/open.md"]


def test_symlink_to_a_file_outside_the_brain_is_denied(open_brain: Brain, tmp_path: Path) -> None:
    outside = tmp_path / "outside.md"
    outside.write_text("# Outside\n\noutsideword\n", encoding="utf-8")
    (open_brain.root / "notes/escape.md").symlink_to(outside)
    assert open_brain.run("read", "notes/escape.md").err == DENIED
    assert found_paths(open_brain, "find", "outsideword") == []


def test_symlinked_folder_is_not_followed(open_brain: Brain) -> None:
    open_brain.write("topics/real/README.md", "---\nscope: private\n---\n\n# Real\n")
    open_brain.write("topics/real/item.md", note("Item", "linkedword"))
    (open_brain.root / "topics/alias").symlink_to(open_brain.root / "topics/real")
    assert open_brain.run("read", "topics/alias/item.md").err == DENIED
    paths = [hit["path"] for hit in json.loads(open_brain.run("find", "linkedword", "--json").out)["hits"]]
    assert paths == ["topics/real/item.md"]


def test_symlinked_topic_readme_denies_the_notes_below_it(open_brain: Brain) -> None:
    open_brain.write("elsewhere/README.md", "---\nscope: private\n---\n\n# Elsewhere\n")
    open_brain.write("topics/t/item.md", note("Item", "readmeword"))
    (open_brain.root / "topics/t/README.md").symlink_to(open_brain.root / "elsewhere/README.md")
    assert open_brain.run("read", "topics/t/item.md").err == DENIED


def test_symlinked_note_folder_is_ignored(open_brain: Brain, tmp_path: Path) -> None:
    outside = tmp_path / "outside-notes"
    outside.mkdir()
    (outside / "x.md").write_text("# X\n\nfolderword\n", encoding="utf-8")
    os.rename(open_brain.root / "notes", open_brain.root / "notes-real")
    (open_brain.root / "notes").symlink_to(outside)
    assert open_brain.run("read", "notes/x.md").err == DENIED
    assert found_paths(open_brain, "find", "folderword") == []


# --- the paths file --------------------------------------------------------------------------------------------


@pytest.mark.parametrize("args", [("read", "notes/open.md"), ("find", "visible"), ("context", "visible words"),
                                  ("check",)])
def test_missing_paths_file_fails_closed(open_brain: Brain, args: tuple[str, ...]) -> None:
    (open_brain.root / ".sensitive-paths").unlink()
    result = open_brain.run(*args)
    assert result.code == 2
    assert result.out == ""
    assert ".sensitive-paths" in result.err
    assert "`dummkopf meta index`" in result.err


def test_symlinked_paths_file_counts_as_missing(open_brain: Brain) -> None:
    (open_brain.root / "real-paths").write_text("# generated\n", encoding="utf-8")
    (open_brain.root / ".sensitive-paths").unlink()
    (open_brain.root / ".sensitive-paths").symlink_to(open_brain.root / "real-paths")
    assert open_brain.run("read", "notes/open.md").code == 2


def test_renamed_paths_file_is_honored(open_brain: Brain) -> None:
    open_brain.configure('[sensitive]\npaths_file = ".hidden-list"\n')
    open_brain.write(".hidden-list", "notes/listed.md\n")
    open_brain.write("notes/listed.md", note("Listed", SECRET_BODY))
    (open_brain.root / ".sensitive-paths").unlink()
    assert open_brain.run("read", "notes/listed.md").err == DENIED
    assert open_brain.run("read", "notes/open.md").code == 0


def test_meta_index_restores_a_missing_paths_file(open_brain: Brain) -> None:
    open_brain.write("notes/marked.md", note("Marked", "> SENSITIVE\n\n" + SECRET_BODY))
    (open_brain.root / ".sensitive-paths").unlink()
    assert open_brain.run("meta", "index").code == 0
    assert "notes/marked.md" in open_brain.read(".sensitive-paths").splitlines()
    assert open_brain.run("read", "notes/open.md").code == 0
