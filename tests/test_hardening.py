"""Threat model for an open-source tool: brains cloned from strangers, with symlinks and odd spellings.

These tests check behavior against that model, not against the tool this project was ported from.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import Brain, Synced, document, invoke, revision

from dummkopf import meta
from dummkopf.access import Access
from dummkopf.errors import AccessDenied, DummkopfError
from dummkopf.extras import links
from dummkopf.extras.curator import scan
from dummkopf.search import find
from dummkopf.sync import sync_repository
from dummkopf.write import ingest


@pytest.mark.parametrize("spelling", ["topics/health/bp.md", "topics/Health/bp.md", "topics/HEALTH/BP.md",
                                      "topics/health/BP.md"])
def test_always_sensitive_path_cannot_be_read_in_another_spelling(brain: Brain, spelling: str) -> None:
    brain.configure("[sensitive]\nalways = ['topics/health/']\n")
    brain.note("topics/health/bp.md", body="BLOODPRESSURE")
    with pytest.raises(AccessDenied):
        Access(brain.config).read(spelling)


def test_listed_path_matches_case_insensitively(brain: Brain) -> None:
    brain.configure("[sensitive]\nalways = ['topics/Health/']\n")
    brain.note("topics/health/bp.md", body="BLOODPRESSURE")
    assert find(Access(brain.config), "BLOODPRESSURE")["hits"] == []


def test_read_needs_the_exact_on_disk_spelling(brain: Brain) -> None:
    brain.note("notes/plain.md")
    access = Access(brain.config)
    assert access.read("notes/plain.md").path == "notes/plain.md"
    if (brain.root / "notes/Plain.md").exists():  # case-insensitive file system, e.g. macOS
        with pytest.raises(AccessDenied):
            access.read("notes/Plain.md")


@pytest.fixture
def outside_link(brain: Brain, tmp_path: Path) -> Brain:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("---\nupdated: 2020-01-01\nkey_fact: OUTSIDE-SECRET\n---\n\n"
                                       "# S\n\nnot yet OUTSIDE-SECRET\n", encoding="utf-8")
    (outside / "dir").mkdir()
    (outside / "dir" / "inner.md").write_text("# I\n\nnot yet OUTSIDE-SECRET\n", encoding="utf-8")
    brain.write("INDEX.md", "# I\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    (brain.root / "notes").mkdir()
    (brain.root / "notes" / "link.md").symlink_to(outside / "secret.md")
    (brain.root / "topics").mkdir()
    (brain.root / "topics" / "linked").symlink_to(outside / "dir")
    (brain.root / "bookmarks").symlink_to(outside)
    brain.git_init()
    brain.commit()
    return brain


def test_symlinks_never_reach_curator_index_or_links(outside_link: Brain) -> None:
    config = outside_link.config
    assert "OUTSIDE-SECRET" not in json.dumps(scan(config, open_days=1))
    meta.generate(config)
    assert "OUTSIDE-SECRET" not in outside_link.read("INDEX.md")
    assert "link.md" not in json.dumps(links.build(config, 1))
    assert "OUTSIDE-SECRET" not in json.dumps(links.build(config, 1))


def test_links_output_never_lands_in_note_folders(brain: Brain) -> None:
    brain.git_init()
    brain.note("topics/job/README.md", fields="scope: work\n", body="August 2026")
    brain.commit()
    for out in ("notes/links.md", "topics/job/links.md", "bookmarks/links.md"):
        code, _, error = invoke(brain, "links", "--out", out, "--serious")
        assert code == 2, out
        assert "outside the note folders" in error
    assert not (brain.root / "notes/links.md").exists()


def test_links_output_into_missing_folder_is_a_clean_rejection(brain: Brain) -> None:
    brain.git_init()
    brain.note("topics/a/README.md")
    brain.commit()
    code, output, error = invoke(brain, "links", "--out", "reports/links.md", "--serious")
    assert code == 2
    assert "Traceback" not in output + error
    assert "folder" in error


def test_config_rejects_links_output_inside_note_folders(brain: Brain) -> None:
    from dummkopf.errors import ConfigError

    with pytest.raises(ConfigError, match=r"links\.output"):
        brain.configure("[links]\noutput = 'notes/links.md'\n")


def link_issue(brain: Brain, target: str) -> str:
    data = {"changes": [{"path": "notes/x.md", "expected": None, "content": document(body=f"[a]({target})")}]}
    with pytest.raises(DummkopfError) as caught:
        ingest(Access(brain.config), data, dry_run=True, sync=False)
    return str(caught.value)


def test_hidden_and_missing_link_targets_look_identical(brain: Brain) -> None:
    brain.write("notes/hidden.md", document(body="> SENSITIVE"))
    hidden = link_issue(brain, "hidden.md")
    missing = link_issue(brain, "absent.md")
    assert hidden == missing
    assert "link-unavailable" in hidden


def test_hidden_and_missing_wiki_targets_look_identical(brain: Brain) -> None:
    brain.write("topics/locked/README.md", document(body="> SENSITIVE", scope="private"))
    data = {"changes": [{"path": "notes/x.md", "expected": None, "content": document(body="[[{}]]")}]}
    messages = []
    for name in ("locked", "absent"):
        data["changes"][0]["content"] = document(body="[[" + name + "]]")
        with pytest.raises(DummkopfError) as caught:
            ingest(Access(brain.config), data, dry_run=True, sync=False)
        messages.append(str(caught.value))
    assert messages[0] == messages[1]


def test_check_reports_hidden_and_missing_legacy_links_alike(brain: Brain) -> None:
    brain.write("notes/hidden.md", document(body="> SENSITIVE"))
    brain.write("notes/a.md", document(body="[a](hidden.md)"))
    brain.write("notes/b.md", document(body="[a](absent.md)"))
    from dummkopf.write import check

    issues = {issue["path"]: (issue["code"], issue["message"], issue["severity"])
              for issue in check(Access(brain.config))["issues"]}
    assert issues["notes/a.md"] == issues["notes/b.md"]


def test_saved_and_pushed_write_never_exits_2_when_remote_hides_the_note(brain: Brain) -> None:
    brain.write("notes/a.md", document())

    def remote_adds_marker(config: object, refresh_remote: bool = False) -> None:
        del config, refresh_remote
        brain.write("notes/a.md", brain.read("notes/a.md") + "\n> SENSITIVE\n")

    with patch("dummkopf.write.prepare_repository"), \
            patch("dummkopf.write.sync_locked", side_effect=remote_adds_marker):
        result = ingest(Access(brain.config), {"changes": [
            {"path": "notes/a.md", "expected": revision(brain, "notes/a.md"), "append": "More."}]})
    assert result["saved"] and result["sync"] == "ok"
    assert "notes/a.md" not in result["revisions"]


def test_sync_commits_only_note_paths_even_if_excluded_files_are_staged(synced: Synced) -> None:
    synced.brain.toml = synced.brain.toml.replace("[repo]\n", "[repo]\nsync_exclude = ['dummkopf.toml']\n")
    synced.brain.configure("")
    synced.brain.commit("Configure")
    synced.git("push", "-q")
    synced.brain.write("dummkopf.toml", synced.brain.toml + "# half edited\n")
    synced.git("add", "dummkopf.toml")
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert synced.git("show", "--name-only", "--format=", "HEAD") == "notes/first.md"
    assert synced.git("diff", "--cached", "--name-only") == "dummkopf.toml"
