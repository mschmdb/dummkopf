"""Scope: inheritance from the topic README, file override, filtering and the mixed label."""

from __future__ import annotations

import json

import pytest

from .conftest import Brain, note

DENIED = "Path unavailable or access excluded.\n"


def paths(brain: Brain, *args: str, command: str = "find") -> list[str]:
    limit = ("--limit", "10") if command == "find" else ()
    result = brain.run(command, "widget", "--json", *limit, *args)
    assert result.code == 0, result.err
    return [hit["path"] for hit in json.loads(result.out)["hits"]]


def scope_of(brain: Brain, path: str, *args: str) -> str:
    header = brain.run("read", path, *args).out.splitlines()[0]
    return header.rsplit("scope=", 1)[1]


@pytest.fixture
def scoped(brain: Brain) -> Brain:
    brain.write("topics/job/README.md", "---\nscope: work\n---\n\n# Job\n")
    brain.write("topics/job/a.md", note("Alpha", "widget"))
    brain.write("topics/job/b.md", note("Beta", "widget", fields="scope: private\n"))
    brain.write("topics/home/README.md", "---\nscope: private\n---\n\n# Home\n")
    brain.write("topics/home/c.md", note("Gamma", "widget"))
    brain.write("topics/loose/d.md", note("Delta", "widget"))
    brain.write("notes/flat.md", note("Flat", "widget"))
    return brain


def test_file_inherits_the_scope_of_its_topic_readme(scoped: Brain) -> None:
    assert scope_of(scoped, "topics/job/a.md") == "work"
    assert scope_of(scoped, "topics/home/c.md") == "private"


def test_file_scope_overrides_the_topic_scope(scoped: Brain) -> None:
    assert scope_of(scoped, "topics/job/b.md") == "private"


def test_notes_without_any_scope_are_labelled_mixed(scoped: Brain) -> None:
    assert scope_of(scoped, "notes/flat.md") == "mixed"
    assert scope_of(scoped, "topics/loose/d.md") == "mixed"


def test_mixed_label_comes_from_the_config(scoped: Brain) -> None:
    scoped.configure('[scopes]\nmixed_label = "unfiled"\n')
    assert scope_of(scoped, "notes/flat.md") == "unfiled"
    assert json.loads(scoped.run("read", "notes/flat.md", "--json").out)["hits"][0]["scope"] == "unfiled"


def test_readme_scope_applies_to_nested_folders(scoped: Brain) -> None:
    scoped.write("topics/job/deep/er/e.md", note("Epsilon", "widget"))
    assert scope_of(scoped, "topics/job/deep/er/e.md") == "work"


def test_nearest_readme_scope_wins_over_a_far_one(scoped: Brain) -> None:
    scoped.write("topics/job/inner/README.md", "---\nscope: private\n---\n\n# Inner\n")
    scoped.write("topics/job/inner/f.md", note("Phi", "widget"))
    assert scope_of(scoped, "topics/job/inner/f.md") == "private"


def test_default_scope_both_shows_every_scope(scoped: Brain) -> None:
    assert paths(scoped) == ["notes/flat.md", "topics/home/c.md", "topics/job/a.md", "topics/job/b.md",
                             "topics/loose/d.md"]


def test_scope_work_hides_private_notes_and_keeps_mixed_ones(scoped: Brain) -> None:
    assert paths(scoped, "--scope", "work") == ["notes/flat.md", "topics/job/a.md", "topics/loose/d.md"]


def test_scope_private_hides_work_notes_and_keeps_mixed_ones(scoped: Brain) -> None:
    assert paths(scoped, "--scope", "private") == ["notes/flat.md", "topics/home/c.md", "topics/job/b.md",
                                                   "topics/loose/d.md"]


def test_explicit_scope_both_equals_the_default(scoped: Brain) -> None:
    assert paths(scoped, "--scope", "both") == paths(scoped)


def test_context_filters_by_scope_too(scoped: Brain) -> None:
    assert "topics/home/c.md" not in paths(scoped, "--scope", "work", command="context")
    assert "topics/job/a.md" not in paths(scoped, "--scope", "private", command="context")


def test_read_outside_the_scope_is_denied_like_a_missing_file(scoped: Brain) -> None:
    denied = scoped.run("read", "topics/home/c.md", "--scope", "work")
    missing = scoped.run("read", "topics/home/absent.md", "--scope", "work")
    assert (denied.code, denied.err) == (2, DENIED)
    assert denied == missing


def test_read_inside_the_scope_works(scoped: Brain) -> None:
    assert scoped.run("read", "topics/job/a.md", "--scope", "work").code == 0


def test_query_default_scope_applies_when_no_option_is_given(scoped: Brain) -> None:
    scoped.configure('[scopes]\nquery_default = "work"\n')
    assert paths(scoped) == ["notes/flat.md", "topics/job/a.md", "topics/loose/d.md"]


def test_scope_option_beats_the_configured_default(scoped: Brain) -> None:
    scoped.configure('[scopes]\nquery_default = "work"\n')
    assert "topics/home/c.md" in paths(scoped, "--scope", "both")


def test_invalid_scope_exits_2_and_lists_the_choices(scoped: Brain) -> None:
    result = scoped.run("find", "widget", "--scope", "nowhere")
    assert result.code == 2
    assert result.err == "Invalid scope. Use one of: both, private, work.\n"


@pytest.mark.parametrize("command", [("read", "notes/flat.md"), ("context", "widget"), ("check",),
                                     ("meta", "report"), ("links",), ("curator",)])
def test_every_scoped_command_rejects_an_invalid_scope(scoped: Brain, command: tuple[str, ...]) -> None:
    result = scoped.run(*command, "--scope", "nowhere")
    assert result.code == 2
    assert "Use one of: both, private, work." in result.err or "invalid" in result.err.lower()


def test_scope_choices_follow_the_configured_scopes(scoped: Brain) -> None:
    scoped.configure('[scopes]\nvalues = ["home", "office"]\nall = "any"\nquery_default = "any"\nlink_barriers = []\n')
    result = scoped.run("find", "widget", "--scope", "both")
    assert result.code == 2
    assert result.err == "Invalid scope. Use one of: any, home, office.\n"


def test_note_with_a_scope_outside_the_configured_values_is_denied(scoped: Brain) -> None:
    scoped.write("notes/odd.md", note("Odd", "widget", fields="scope: weird\n"))
    assert scoped.run("read", "notes/odd.md").err == DENIED
    assert "notes/odd.md" not in paths(scoped)


def test_custom_scopes_filter_like_the_defaults(scoped: Brain) -> None:
    scoped.configure('[scopes]\nvalues = ["home", "office"]\nall = "any"\nquery_default = "any"\nlink_barriers = []\n')
    scoped.write("topics/hq/README.md", "---\nscope: office\n---\n\n# Hq\n")
    scoped.write("topics/hq/g.md", note("Gee", "widget"))
    scoped.write("topics/den/README.md", "---\nscope: home\n---\n\n# Den\n")
    scoped.write("topics/den/h.md", note("Aitch", "widget"))
    found = paths(scoped, "--scope", "office")
    assert "topics/hq/g.md" in found
    assert "topics/den/h.md" not in found


def test_topic_option_and_scope_option_combine(scoped: Brain) -> None:
    assert paths(scoped, "--topic", "job", "--scope", "work") == ["topics/job/a.md"]
    assert paths(scoped, "--topic", "job", "--scope", "private") == ["topics/job/b.md"]


def test_changing_a_readme_scope_on_disk_moves_the_notes_below_it(scoped: Brain) -> None:
    scoped.write("topics/job/README.md", "---\nscope: private\n---\n\n# Job\n")
    assert scope_of(scoped, "topics/job/a.md") == "private"
