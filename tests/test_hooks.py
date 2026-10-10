from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from conftest import Brain, Synced, document, invoke, revision

from dummkopf.access import Access
from dummkopf.config import Config
from dummkopf.hook import agent_event, is_brain_path, pre_commit
from dummkopf.write import ingest


@pytest.mark.parametrize("event", [{"tool_name": "Bash"}, {"tool_name": "exec_command"},
                                   {"tool_name": "apply_patch"}, {"hook_event_name": "SessionEnd"}])
def test_shell_tools_and_session_end_trigger_sync(brain: Brain, event: dict[str, Any]) -> None:
    with patch("dummkopf.hook.sync_repository") as sync:
        assert agent_event({**event, "cwd": str(brain.root)}, brain.config) == 0
        sync.assert_called_once()


@pytest.mark.parametrize("event", [{"tool_name": "Read", "cwd": "ROOT"}, {"tool_name": "Bash", "cwd": "PARENT"}])
def test_unknown_tool_and_other_project_do_not_trigger_sync(brain: Brain, event: dict[str, Any]) -> None:
    event = {**event, "cwd": str(brain.root if event["cwd"] == "ROOT" else brain.root.parent)}
    with patch("dummkopf.hook.sync_repository") as sync:
        assert agent_event(event, brain.config) == 0
        sync.assert_not_called()


def test_native_file_edit_from_another_cwd_matches_brain_path(brain: Brain) -> None:
    event = {"tool_name": "Edit", "cwd": str(brain.root.parent),
             "tool_input": {"file_path": str(brain.root / "notes/a.md")}}
    with patch("dummkopf.hook.sync_repository") as sync:
        assert agent_event(event, brain.config) == 0
        sync.assert_called_once()


@pytest.mark.parametrize("event", [None, [], {"tool_name": "Bash", "cwd": 42},
                                   {"tool_name": [], "cwd": "ROOT"},
                                   {"tool_name": "Edit", "tool_input": None, "cwd": "PARENT"}])
def test_malformed_payload_does_not_trigger_sync(brain: Brain, event: Any) -> None:
    if isinstance(event, dict) and event.get("cwd") in ("ROOT", "PARENT"):
        event = {**event, "cwd": str(brain.root if event["cwd"] == "ROOT" else brain.root.parent)}
    with patch("dummkopf.hook.sync_repository") as sync:
        assert agent_event(event, brain.config) == 0
        sync.assert_not_called()


def test_failed_sync_is_non_blocking(synced: Synced, capsys: pytest.CaptureFixture[str]) -> None:
    synced.git("remote", "set-url", "origin", "git@example.org:other/repo.git")
    assert agent_event({"tool_name": "Bash", "cwd": str(synced.brain.root)}, synced.brain.config) == 1
    assert "dummkopf sync failed" in capsys.readouterr().err


def test_hook_command_never_returns_2(tmp_path: Path) -> None:
    from dummkopf.cli import main

    with patch("sys.stdin") as stdin:
        stdin.read.return_value = json.dumps({"tool_name": "Bash", "cwd": str(tmp_path)})
        assert main(["--root", str(tmp_path), "hook", "agent"]) == 0
        assert main(["--root", str(tmp_path), "hook", "pre-commit"]) == 0


def test_only_brain_paths_match(brain: Brain) -> None:
    other = brain.root.parent / "other"
    other.mkdir()
    assert is_brain_path(brain.root, brain.root)
    assert is_brain_path(brain.root / "notes", brain.root)
    assert not is_brain_path(other, brain.root)


def test_pre_commit_regenerates_paths_file_and_indexes(synced: Synced) -> None:
    brain = synced.brain
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    brain.write("notes/hidden.md", document(body="> SENSITIVE"))
    brain.write("notes/raw.md", "# Raw\n")
    synced.git("add", "-A")
    assert pre_commit(brain.config) == 0
    assert "notes/hidden.md" in brain.read(".sensitive-paths")
    assert brain.read("notes/raw.md").startswith("---\n")
    index = brain.read("INDEX.md")
    assert "notes/raw.md" in index and "notes/hidden.md" not in index
    staged = synced.git("diff", "--cached", "--name-only").splitlines()
    assert {".sensitive-paths", "INDEX.md", "notes/raw.md"} <= set(staged)


def test_pre_commit_skips_repos_without_index(brain: Brain) -> None:
    brain.git_init()
    brain.write("notes/raw.md", "# Raw\n")
    assert pre_commit(brain.config) == 0
    assert brain.read("notes/raw.md") == "# Raw\n"


def path_with_dummkopf() -> dict[str, str]:
    return {**os.environ, "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")}


def test_installed_pre_commit_updates_index_after_ingest(synced: Synced, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", path_with_dummkopf()["PATH"])
    brain = synced.brain
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    assert invoke(brain, "install", "--serious")[0] == 0
    brain.commit("Install hooks")
    synced.git("push", "-q")
    first = {"path": "notes/new.md", "content": document(), "expected": None}
    data = {"changes": [first, {"path": "topics/new/README.md", "content": document(scope="work"),
                                "expected": None}]}
    result = ingest(Access(brain.config), data)
    assert result["sync"] == "ok"
    assert "notes/new.md" in brain.read("INDEX.md")
    assert result["revisions"]["topics/new/README.md"] == revision(brain, "topics/new/README.md")
    assert ingest(Access(brain.config), data)["changed"] == []
    assert synced.git("status", "--porcelain") == ""


def test_config_type_is_used(brain: Brain) -> None:
    assert isinstance(brain.config, Config)
