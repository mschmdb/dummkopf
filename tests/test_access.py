from __future__ import annotations

import pytest
from conftest import Brain

from dummkopf.access import Access
from dummkopf.errors import AccessDenied
from dummkopf.search import find


def test_alias_match_returns_original_path_and_physical_line(brain: Brain) -> None:
    brain.note("notes/deploy.md", fields="aliases: [pnpm, build]\n")
    hit = find(Access(brain.config), "build")["hits"][0]
    assert hit["path"] == "notes/deploy.md"
    assert hit["updated"] == "2026-10-04"
    lines = brain.read(hit["path"]).splitlines()
    for line in hit["lines"]:
        assert lines[line["n"] - 1] == line["text"]


def test_scope_inherits_and_file_can_override(brain: Brain) -> None:
    brain.note("topics/home/README.md", fields="scope: private\n")
    brain.note("topics/home/nested/private.md")
    brain.note("topics/home/nested/override.md", fields="scope: work\n")
    brain.note("notes/shared.md")
    paths = [hit["path"] for hit in find(Access(brain.config, scope="work"), "pnpm esbuild")["hits"]]
    assert set(paths) == {"topics/home/nested/override.md", "notes/shared.md"}
    with pytest.raises(AccessDenied):
        Access(brain.config, scope="work").read("topics/home/nested/private.md")


def test_scope_defaults_to_query_default(brain: Brain) -> None:
    brain.configure("[scopes]\nquery_default = 'work'\n")
    brain.note("topics/home/README.md", fields="scope: private\n")
    with pytest.raises(AccessDenied):
        Access(brain.config).read("topics/home/README.md")
    assert Access(brain.config, scope="both").read("topics/home/README.md").scope == "private"


def test_unknown_scope_is_rejected_with_choices(brain: Brain) -> None:
    with pytest.raises(AccessDenied) as caught:
        Access(brain.config, scope="privat")
    assert "both, private, work" in str(caught.value)


def test_mixed_label_for_unscoped_notes(brain: Brain, german: Brain) -> None:
    brain.note("notes/a.md")
    assert Access(brain.config).read("notes/a.md").scope == "mixed"
    german.write("notes/a.md", "---\nstand: 2026-01-01\n---\n\n# A\n")
    assert Access(german.config).read("notes/a.md").scope == "gemischt"


def test_sensitive_list_marker_and_ancestor_marker_block_search_and_read(brain: Brain) -> None:
    brain.write(".sensitive-paths", "notes/listed.md\n")
    brain.note("notes/listed.md", body="SECRET listed")
    brain.note("notes/marked.md", body="> SENSITIVE\nSECRET marked")
    brain.note("topics/locked/README.md", body="> SENSITIVE\nSECRET ancestor")
    brain.note("topics/locked/nested/child.md", body="SECRET child")
    access = Access(brain.config)
    assert find(access, "SECRET")["hits"] == []
    for path in ("notes/listed.md", "notes/marked.md", "topics/locked/nested/child.md"):
        with pytest.raises(AccessDenied):
            access.read(path)


def test_allow_sensitive_is_limited_to_requested_path(brain: Brain) -> None:
    brain.note("topics/locked/README.md", body="> SENSITIVE")
    brain.note("topics/locked/a.md", body="SECRET")
    brain.note("topics/other/README.md", body="> SENSITIVE")
    brain.note("topics/other/a.md", body="SECRET")
    access = Access(brain.config, allow_sensitive=["topics/locked/"])
    assert find(access, "SECRET")["hits"][0]["path"] == "topics/locked/a.md"
    with pytest.raises(AccessDenied):
        access.read("topics/other/a.md")


def test_grant_needs_topic_folder_or_md_file(brain: Brain) -> None:
    with pytest.raises(AccessDenied) as caught:
        Access(brain.config, allow_sensitive=["notes/some-folder"])
    assert caught.value.key == "grant_needs_path"


def test_always_sensitive_topic_is_blocked_without_marker(german: Brain) -> None:
    german.write("topics/vertraulich/a.md", "---\nstand: 2026-01-01\n---\n\n# A\n\nSECRET\n")
    assert find(Access(german.config), "SECRET")["hits"] == []
    granted = Access(german.config, allow_sensitive=["topics/vertraulich"])
    assert granted.read("topics/vertraulich/a.md").sensitive


def test_missing_protection_file_fails_closed(brain: Brain) -> None:
    (brain.root / ".sensitive-paths").unlink()
    with pytest.raises(AccessDenied) as caught:
        Access(brain.config)
    assert caught.value.key == "sensitive_list_missing"


def test_symlinked_protection_file_fails_closed(brain: Brain) -> None:
    (brain.root / ".sensitive-paths").unlink()
    brain.write("elsewhere", "# empty\n")
    (brain.root / ".sensitive-paths").symlink_to(brain.root / "elsewhere")
    with pytest.raises(AccessDenied):
        Access(brain.config)


def test_path_escape_symlinks_and_skill_directories_are_blocked(brain: Brain) -> None:
    target = brain.note("notes/a.md")
    (brain.root / "notes/link.md").symlink_to(target)
    brain.write("topics/skills/tool/SKILL.md", "# Tool")
    brain.note("topics/skills/tool/data.md")
    brain.write("AGENTS.md", "# Agents\n")
    access = Access(brain.config)
    for path in ("../a.md", str(target), "notes/link.md", "AGENTS.md", "topics/skills/tool/data.md",
                 "topics/skills/tool/SKILL.md", "notes/..\\a.md", "notes", "dummkopf.toml"):
        with pytest.raises(AccessDenied):
            access.read(path)


def test_symlinked_folder_is_blocked(brain: Brain, tmp_path) -> None:  # type: ignore[no-untyped-def]
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "x.md").write_text("# X\n", encoding="utf-8")
    (brain.root / "topics").mkdir()
    (brain.root / "topics" / "linked").symlink_to(outside)
    with pytest.raises(AccessDenied):
        Access(brain.config).read("topics/linked/x.md")


def test_renamed_roots_are_respected(brain: Brain) -> None:
    config = brain.configure("[layout]\nnotes = 'inbox'\n")
    brain.note("inbox/a.md")
    brain.note("notes/b.md")
    access = Access(config)
    assert access.read("inbox/a.md").path == "inbox/a.md"
    with pytest.raises(AccessDenied):
        access.read("notes/b.md")


def test_marker_changes_are_checked_on_repeated_reads(brain: Brain) -> None:
    brain.note("topics/build/README.md")
    brain.note("topics/build/nested/a.md")
    access = Access(brain.config)
    access.read("topics/build/nested/a.md")
    brain.note("topics/build/README.md", body="> SENSITIVE")
    with pytest.raises(AccessDenied):
        access.read("topics/build/nested/a.md")


def test_nested_scope_and_invalid_scope_fail_closed(brain: Brain) -> None:
    brain.note("topics/home/README.md", fields="scope: private\n")
    brain.note("topics/home/nested/README.md", fields="scope: work\n")
    brain.note("topics/home/nested/a.md")
    brain.note("notes/invalid.md", fields="scope: typo\n")
    assert Access(brain.config, scope="work").read("topics/home/nested/a.md").scope == "work"
    with pytest.raises(AccessDenied):
        Access(brain.config).read("notes/invalid.md")


def test_topic_filter_limits_reads(brain: Brain) -> None:
    brain.note("topics/build/a.md")
    brain.note("notes/a.md")
    access = Access(brain.config, topic="build")
    assert access.read("topics/build/a.md").path == "topics/build/a.md"
    with pytest.raises(AccessDenied):
        access.read("notes/a.md")
    assert access.paths() == ["topics/build/a.md"]
    with pytest.raises(AccessDenied):
        Access(brain.config, topic="../x")


def test_note_fields_follow_the_mapping(german: Brain) -> None:
    german.write("notes/a.md", "---\nstand: 2026-01-01\nstatus: aktiv\nkernfakt: Fakt\n"
                 "aliase: [eins, zwei]\n---\n\n# Titel\n\nText\n")
    note = Access(german.config).read("notes/a.md")
    assert (note.title, note.updated, note.status, note.key_fact) == ("Titel", "2026-01-01", "aktiv", "Fakt")
    assert note.aliases == ("eins", "zwei")
    assert len(note.revision) == 64
