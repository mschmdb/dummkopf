"""Hooks: `hook agent` for Claude Code and Codex, `hook pre-commit`, and the installed Git hook in use."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from .conftest import Brain, Result, Synced, base_env, full_note, git, md, run

FILLER = ("---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\naliases: []\nperiod: []\n"
          "entities: []\n---\n")


def agent(root: Path, event: Any, cwd: Path | None = None, raw: str | None = None) -> Result:
    stdin = raw if raw is not None else json.dumps(event)
    return run("hook", "agent", "--root", str(root), cwd=cwd or root, stdin=stdin)


def tool_event(tool: str, cwd: Path | str, **tool_input: str) -> dict[str, Any]:
    return {"hook_event_name": "PostToolUse", "tool_name": tool, "cwd": str(cwd), "tool_input": tool_input}


@pytest.fixture
def pending(synced: Synced) -> Synced:
    """A brain with an uncommitted note, so a sync is visible on the remote."""
    synced.brain.write("notes/pending.md", full_note("Pending"))
    return synced


def synced_to_remote(synced: Synced) -> bool:
    return "notes/pending.md" in synced.remote_files()


# --- hook agent: never exit 2 ------------------------------------------------------------------------------------


@pytest.mark.parametrize("raw", ["", "not json", "[]", "5", "null", '"text"', "{}", '{"tool_name": 5}',
                                 '{"tool_name": "Bash", "cwd": 5}', '{"hook_event_name": "SessionEnd", "cwd": []}'])
def test_unusable_events_exit_0_without_output(pending: Synced, raw: str) -> None:
    result = agent(pending.brain.root, None, raw=raw)
    assert (result.code, result.out, result.err) == (0, "", "")
    assert not synced_to_remote(pending)


def test_hook_outside_a_brain_exits_0(tmp_path: Path) -> None:
    result = run("hook", "agent", cwd=tmp_path, stdin=json.dumps(tool_event("Bash", tmp_path)))
    assert (result.code, result.out, result.err) == (0, "", "")


def test_hook_with_a_broken_config_exits_0(brain: Brain) -> None:
    (brain.root / "dummkopf.toml").write_text("[repo\n", encoding="utf-8")
    result = agent(brain.root, tool_event("Bash", brain.root))
    assert (result.code, result.err) == (0, "")


def test_unwatched_tool_does_not_sync(pending: Synced) -> None:
    result = agent(pending.brain.root, tool_event("Read", pending.brain.root))
    assert result.code == 0
    assert not synced_to_remote(pending)


def test_event_from_outside_the_brain_does_not_sync(pending: Synced, tmp_path: Path) -> None:
    result = agent(pending.brain.root, tool_event("Bash", tmp_path / "elsewhere"), cwd=tmp_path)
    assert result.code == 0
    assert not synced_to_remote(pending)


# --- hook agent: syncing -----------------------------------------------------------------------------------------


def test_bash_event_in_the_brain_commits_and_pushes(pending: Synced) -> None:
    result = agent(pending.brain.root, tool_event("Bash", pending.brain.root, command="echo"))
    assert (result.code, result.out, result.err) == (0, "", "")
    assert synced_to_remote(pending)
    assert pending.remote_log()[0] == "Update notes"


def test_event_from_a_nested_folder_of_the_brain_syncs(pending: Synced) -> None:
    nested = pending.brain.root / "notes"
    assert agent(pending.brain.root, tool_event("Bash", nested)).code == 0
    assert synced_to_remote(pending)


@pytest.mark.parametrize("tool", ["Bash", "Write", "Edit", "MultiEdit", "apply_patch", "exec_command"])
def test_every_watched_tool_syncs_when_run_in_the_brain(pending: Synced, tool: str) -> None:
    assert agent(pending.brain.root, tool_event(tool, pending.brain.root)).code == 0
    assert synced_to_remote(pending)


@pytest.mark.parametrize("tool", ["Write", "Edit", "MultiEdit"])
def test_file_tool_on_a_brain_file_syncs_even_from_another_folder(pending: Synced, tool: str, tmp_path: Path) -> None:
    edited = pending.brain.root / "notes" / "pending.md"
    event = tool_event(tool, tmp_path, file_path=str(edited))
    assert agent(pending.brain.root, event, cwd=tmp_path).code == 0
    assert synced_to_remote(pending)


def test_bash_event_with_a_file_path_outside_the_brain_does_not_sync(pending: Synced, tmp_path: Path) -> None:
    event = tool_event("Bash", tmp_path, file_path=str(pending.brain.root / "notes" / "pending.md"))
    assert agent(pending.brain.root, event, cwd=tmp_path).code == 0
    assert not synced_to_remote(pending)


def test_session_end_in_the_brain_syncs(pending: Synced) -> None:
    event = {"hook_event_name": "SessionEnd", "cwd": str(pending.brain.root)}
    assert agent(pending.brain.root, event).code == 0
    assert synced_to_remote(pending)


def test_session_end_outside_the_brain_does_not_sync(pending: Synced, tmp_path: Path) -> None:
    event = {"hook_event_name": "SessionEnd", "cwd": str(tmp_path)}
    assert agent(pending.brain.root, event, cwd=tmp_path).code == 0
    assert not synced_to_remote(pending)


def test_agent_hook_uses_the_working_folder_when_the_event_has_no_cwd(pending: Synced) -> None:
    event = {"hook_event_name": "PostToolUse", "tool_name": "Bash"}
    assert agent(pending.brain.root, event).code == 0
    assert synced_to_remote(pending)


# --- hook agent: failures exit 1, never 2 -----------------------------------------------------------------------


def test_failed_push_exits_1_with_a_message(pending: Synced) -> None:
    hook = pending.remote / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)
    result = agent(pending.brain.root, tool_event("Bash", pending.brain.root))
    assert result.code == 1
    assert result.err == "dummkopf sync failed: Git step failed: push. Local data is kept.\n"


def test_rejected_sync_state_exits_1_not_2(pending: Synced) -> None:
    pending.brain.git("checkout", "-q", "-b", "other")
    result = agent(pending.brain.root, tool_event("Bash", pending.brain.root))
    assert result.code == 1
    assert result.err == "dummkopf sync failed: Sync needs branch main.\n"


# --- hook pre-commit ---------------------------------------------------------------------------------------------


def test_pre_commit_outside_a_brain_exits_0_silently(tmp_path: Path) -> None:
    result = run("hook", "pre-commit", cwd=tmp_path)
    assert (result.code, result.out, result.err) == (0, "", "")


def test_pre_commit_without_an_index_file_does_nothing(brain: Brain) -> None:
    brain.write("notes/secret.md", md("> SENSITIVE"))
    result = brain.run("hook", "pre-commit")
    assert (result.code, result.out) == (0, "")
    assert "secret.md" not in brain.read(".sensitive-paths")


@pytest.fixture
def indexed(brain: Brain) -> Brain:
    brain.git_init()
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    return brain


def test_pre_commit_regenerates_the_sensitive_paths_list(indexed: Brain) -> None:
    indexed.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n")
    result = indexed.run("hook", "pre-commit")
    assert result.code == 0
    assert result.out.startswith(".sensitive-paths updated.\n")
    assert indexed.read(".sensitive-paths").splitlines()[-1] == "notes/secret.md"
    assert indexed.mode(".sensitive-paths") == 0o600


def test_pre_commit_lists_a_whole_folder_when_its_readme_has_the_marker(indexed: Brain) -> None:
    indexed.write("topics/med/README.md", FILLER + "\n# Med\n\n> SENSITIVE\n")
    indexed.write("topics/med/visit.md", FILLER + "\n# Visit\n")
    indexed.run("hook", "pre-commit")
    assert indexed.read(".sensitive-paths").splitlines()[-1] == "topics/med/"


def test_pre_commit_lists_sensitive_always_paths(indexed: Brain) -> None:
    indexed.configure('[sensitive]\nalways = ["topics/health/"]\n')
    indexed.run("hook", "pre-commit")
    assert "topics/health/" in indexed.read(".sensitive-paths").splitlines()


def test_pre_commit_second_run_prints_no_paths_update(indexed: Brain) -> None:
    indexed.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n")
    indexed.run("hook", "pre-commit")
    assert ".sensitive-paths updated." not in indexed.run("hook", "pre-commit").out


def test_pre_commit_rebuilds_the_index_tables(indexed: Brain) -> None:
    indexed.write("notes/visible.md", FILLER + "\n# Visible\n")
    indexed.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n")
    indexed.run("hook", "pre-commit")
    index = indexed.read("INDEX.md")
    assert "| `notes/visible.md` | K. |  |" in index
    assert "secret.md" not in index


def test_pre_commit_reports_findings_on_stdout_and_exits_0(indexed: Brain) -> None:
    indexed.write("notes/todo.md", FILLER.replace("key_fact: K.", "key_fact: TODO") + "\n# Todo\n")
    result = indexed.run("hook", "pre-commit")
    assert result.code == 0
    assert "### No key fact (`TODO`) (1)" in result.out
    assert "- `notes/todo.md`" in result.out


# --- the installed Git hook, through a real commit ------------------------------------------------------------


@pytest.fixture
def hooked(tmp_path: Path) -> Path:
    root = tmp_path / "hooked"
    assert run("init", str(root), "--serious", "--remote", str(tmp_path / "r.git"), cwd=tmp_path).code == 0
    assert run("install", "--serious", cwd=root).code == 0
    return root


def commit(root: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    git(root, "add", "-A")
    return subprocess.run(["git", "commit", "-m", "Save"], cwd=root, capture_output=True, text=True,
                          env=env or base_env(), check=False)


def test_commit_runs_the_hook_and_includes_the_regenerated_paths_list(hooked: Path) -> None:
    (hooked / "notes" / "secret.md").write_text(FILLER + "\n# Secret\n\n> SENSITIVE\n", encoding="utf-8")
    assert commit(hooked).returncode == 0
    assert "notes/secret.md" in git(hooked, "show", "HEAD:.sensitive-paths").splitlines()
    assert git(hooked, "status", "--porcelain") == ""


def test_commit_includes_the_rebuilt_index(hooked: Path) -> None:
    (hooked / "notes" / "visible.md").write_text(FILLER + "\n# Visible\n", encoding="utf-8")
    assert commit(hooked).returncode == 0
    assert "`notes/visible.md`" in git(hooked, "show", "HEAD:INDEX.md")


def test_commit_completes_the_frontmatter_of_a_staged_note(hooked: Path) -> None:
    (hooked / "notes" / "bare.md").write_text("# Bare\n\nno frontmatter\n", encoding="utf-8")
    assert commit(hooked).returncode == 0
    committed = git(hooked, "show", "HEAD:notes/bare.md")
    assert committed.startswith("---\nupdated: ")
    assert "status: active" in committed
    assert committed.endswith("# Bare\n\nno frontmatter")


def test_commit_still_succeeds_when_dummkopf_is_not_on_the_path(hooked: Path) -> None:
    git_folder = str(Path(shutil.which("git") or "/usr/bin/git").parent)
    env = {**base_env(), "PATH": git_folder + ":/bin"}
    (hooked / "notes" / "visible.md").write_text(FILLER + "\n# Visible\n", encoding="utf-8")
    result = commit(hooked, env)
    assert result.returncode == 0
    assert "dummkopf not found on PATH; indexes not updated." in result.stderr
    assert "`notes/visible.md`" not in git(hooked, "show", "HEAD:INDEX.md")
