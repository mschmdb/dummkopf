"""Git sync: `sync`, the sync step of writes, refusals and exit code 3."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from .conftest import Brain, Maker, Synced, full_note, git, ingest, md, new, run


def block_pushes(synced: Synced) -> Path:
    """A pre-receive hook that rejects every push; fetches still work."""
    hook = synced.remote / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    hook.chmod(hook.stat().st_mode | stat.S_IXUSR)
    return hook


# --- sync -----------------------------------------------------------------------------------------------------


def test_sync_of_a_clean_brain_says_synced_and_exits_0(repo: Brain) -> None:
    result = repo.run("sync")
    assert (result.code, result.out, result.err) == (0, "Synced.\n", "")


def test_sync_of_a_clean_brain_creates_no_commit(synced: Synced) -> None:
    head = synced.brain.git("rev-parse", "HEAD")
    synced.brain.run("sync")
    assert synced.brain.git("rev-parse", "HEAD") == head


def test_cheeky_sync_says_brain_synced(repo: Brain) -> None:
    assert repo.cheeky("sync").out == "Brain synced.\n"


def test_tone_plain_in_the_config_makes_sync_neutral(repo: Brain) -> None:
    repo.configure('[ui]\ntone = "plain"\n')
    repo.commit("config")
    assert run("sync", cwd=repo.root).out == "Synced.\n"


def test_serious_beats_a_cheeky_config(repo: Brain) -> None:
    repo.configure('[ui]\ntone = "cheeky"\n')
    repo.commit("config")
    assert run("sync", "--serious", cwd=repo.root).out == "Synced.\n"


def test_sync_json_reports_status_ok(repo: Brain) -> None:
    result = repo.run("sync", "--json")
    assert result.code == 0
    assert json.loads(result.out) == {"status": "ok"}


def test_sync_commits_a_hand_written_note_and_pushes_it(synced: Synced) -> None:
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    assert synced.brain.run("sync").code == 0
    assert synced.remote_log()[0] == "Update notes"
    assert "notes/by-hand.md" in synced.remote_files()
    assert synced.brain.git("status", "--porcelain") == ""


def test_sync_commits_changes_and_deletions_too(synced: Synced) -> None:
    (synced.brain.root / "notes/first.md").unlink()
    synced.brain.run("sync")
    assert "notes/first.md" not in synced.remote_files()


def test_sync_pulls_remote_changes(synced: Synced) -> None:
    synced.remote_edit("notes/remote.md", full_note("Remote"))
    assert synced.brain.run("sync").code == 0
    assert synced.brain.exists("notes/remote.md")


def test_sync_rebases_local_commits_onto_remote_changes(synced: Synced) -> None:
    synced.remote_edit("notes/remote.md", full_note("Remote"))
    synced.brain.write("notes/local.md", full_note("Local"))
    assert synced.brain.run("sync").code == 0
    assert {"notes/remote.md", "notes/local.md"} <= set(synced.remote_files())
    assert synced.brain.git("log", "--format=%s", "-1") == "Update notes"


def test_sync_pushes_commits_made_by_hand(synced: Synced) -> None:
    synced.brain.write("notes/committed.md", full_note("Committed"))
    synced.brain.commit("My own message")
    synced.brain.run("sync")
    assert synced.remote_log()[0] == "My own message"


def test_sync_uses_the_configured_commit_message(synced: Synced) -> None:
    synced.brain.repo_option('commit_message = "Brain update"')
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    synced.brain.run("sync")
    assert synced.remote_log()[0] == "Brain update"


def test_sync_with_auto_push_false_commits_locally_only(synced: Synced) -> None:
    synced.brain.repo_option("auto_push = false")
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    assert synced.brain.run("sync").code == 0
    assert synced.brain.git("log", "--format=%s", "-1") == "Update notes"
    assert "notes/by-hand.md" not in synced.remote_files()


def test_sync_exclude_keeps_listed_paths_out_of_the_commit(synced: Synced) -> None:
    synced.brain.repo_option('sync_exclude = ["tooling/"]')
    synced.brain.write("tooling/script.sh", "echo hi\n")
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    synced.brain.run("sync")
    assert "notes/by-hand.md" in synced.remote_files()
    assert "tooling/script.sh" not in synced.remote_files()
    assert synced.brain.git("status", "--porcelain") == "?? tooling/"


def test_sync_exclude_keeps_staged_foreign_changes_staged(synced: Synced) -> None:
    synced.brain.repo_option('sync_exclude = ["tooling/"]')
    synced.brain.write("tooling/script.sh", "echo hi\n")
    synced.brain.git("add", "tooling/script.sh")
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    synced.brain.run("sync")
    assert synced.brain.git("status", "--porcelain") == "A  tooling/script.sh"
    assert "tooling/script.sh" not in synced.remote_files()


# --- refusals ---------------------------------------------------------------------------------------------------


def test_sync_on_another_branch_exits_2(repo: Brain) -> None:
    repo.git("checkout", "-q", "-b", "other")
    result = repo.run("sync")
    assert result.code == 2
    assert result.err == "Sync needs branch main.\n"


def test_sync_with_a_different_remote_url_exits_2(repo: Brain) -> None:
    repo.git("remote", "set-url", "origin", "/somewhere/else.git")
    result = repo.run("sync")
    assert result.code == 2
    assert result.err == "Remote origin does not match repo.remote in dummkopf.toml.\n"


def test_sync_without_the_configured_remote_name_exits_2(repo: Brain) -> None:
    repo.git("remote", "rename", "origin", "upstream")
    assert repo.run("sync").code == 2


def test_write_refuses_a_wrong_branch_and_writes_nothing(repo: Brain) -> None:
    repo.git("checkout", "-q", "-b", "other")
    result = repo.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 2
    assert result.err == "Sync needs branch main.\n"
    assert not repo.exists("notes/fresh.md")


def test_write_refuses_a_wrong_remote_and_writes_nothing(repo: Brain) -> None:
    repo.git("remote", "set-url", "origin", "/somewhere/else.git")
    result = repo.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 2
    assert result.err == "Remote origin does not match repo.remote in dummkopf.toml.\n"
    assert not repo.exists("notes/fresh.md")


def test_sync_in_a_folder_that_is_not_the_git_root_exits_2(tmp_path: Path, make: Maker) -> None:
    outer = tmp_path / "outer"
    outer.mkdir()
    git(outer, "init", "-q", "-b", "main")
    inner = make("inner")
    inner.root.rename(outer / "inner")
    result = run("sync", "--serious", cwd=outer / "inner")
    assert result.code == 2
    assert result.err == "The Git root does not match the brain root.\n"


def test_sync_in_a_folder_without_git_exits_2(brain: Brain) -> None:
    result = brain.run("sync")
    assert result.code == 2
    assert result.err.startswith("Git step failed")


def test_sync_during_an_open_rebase_exits_2(repo: Brain) -> None:
    os.makedirs(repo.root / ".git" / "rebase-merge")
    result = repo.run("sync")
    assert result.code == 2
    assert result.err == "A Git operation is in progress. Resolve it first.\n"


def test_sync_with_a_diverged_remote_keeps_local_commits_and_exits_2(synced: Synced) -> None:
    synced.brain.write("notes/first.md", full_note("First", "local change"))
    synced.brain.commit("local")
    synced.remote_edit("notes/first.md", full_note("First", "remote change"))
    result = synced.brain.run("sync")
    assert result.code == 2
    assert result.err == "The remote contradicts local changes. Local commits are kept.\n"
    assert synced.brain.git("log", "--format=%s", "-1") == "local"
    assert synced.brain.git("status", "--porcelain") == ""
    assert "local change" in synced.brain.read("notes/first.md")


def test_write_with_a_diverged_remote_writes_nothing(synced: Synced) -> None:
    synced.brain.write("notes/first.md", full_note("First", "local change"))
    synced.brain.commit("local")
    synced.remote_edit("notes/first.md", full_note("First", "remote change"))
    result = synced.brain.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 2
    assert result.err == "The remote contradicts local changes. Local commits are kept.\n"
    assert not synced.brain.exists("notes/fresh.md")


def test_write_catches_up_with_the_remote_first(synced: Synced) -> None:
    synced.remote_edit("notes/remote.md", full_note("Remote"))
    assert synced.brain.run("write", "notes/fresh.md", "--expected", "new", stdin=md()).code == 0
    assert synced.brain.exists("notes/remote.md")
    assert {"notes/remote.md", "notes/fresh.md"} <= set(synced.remote_files())


def test_cheeky_dirty_tree_message_scolds_but_keeps_the_instruction(repo: Brain) -> None:
    repo.write("notes/by-hand.md", md())
    result = repo.cheeky("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 2
    assert result.err == ("Dummkopf, clean up first. "
                          "The brain has uncommitted note changes. Run `dummkopf sync` first.\n")


# --- exit code 3 -------------------------------------------------------------------------------------------------


def test_failed_push_after_a_write_exits_3_and_keeps_the_save(synced: Synced) -> None:
    block_pushes(synced)
    result = synced.brain.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 3
    assert result.out == "Write status: saved; sync: failed\nChanged: notes/fresh.md\n"
    assert result.err == "Markdown saved, but Git sync failed. Retry with `dummkopf sync`.\n"
    assert synced.brain.exists("notes/fresh.md")
    assert synced.brain.git("log", "--format=%s", "-1") == "Update notes"
    assert synced.remote_log() == ["Initial"]


def test_exit_3_json_reports_saved_true_and_sync_failed(synced: Synced) -> None:
    block_pushes(synced)
    result = synced.brain.run("write", "notes/fresh.md", "--expected", "new", "--json", stdin=md())
    assert result.code == 3
    data = json.loads(result.out)
    assert (data["saved"], data["sync"]) == (True, "failed")
    assert result.err == "Markdown saved, but Git sync failed. Retry with `dummkopf sync`.\n"


def test_exit_3_applies_to_ingest_too(synced: Synced) -> None:
    block_pushes(synced)
    assert ingest(synced.brain, new("notes/one.md"), new("notes/two.md")).code == 3


def test_cheeky_exit_3_message_keeps_the_instruction(synced: Synced) -> None:
    block_pushes(synced)
    result = synced.brain.cheeky("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 3
    assert result.err == ("Half a brain is better than none. "
                          "Markdown saved, but Git sync failed. Retry with `dummkopf sync`.\n")


def test_sync_after_exit_3_pushes_once_pushes_work_again(synced: Synced) -> None:
    hook = block_pushes(synced)
    synced.brain.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    failing = synced.brain.run("sync")
    assert failing.code == 2
    assert failing.err == "Git step failed: push. Local data is kept.\n"
    hook.unlink()
    assert synced.brain.run("sync").code == 0
    assert "notes/fresh.md" in synced.remote_files()


def test_a_blocked_push_does_not_leak_git_output(synced: Synced) -> None:
    block_pushes(synced)
    synced.brain.write("notes/by-hand.md", full_note("By hand"))
    result = synced.brain.run("sync")
    assert result.code == 2
    assert "pre-receive" not in result.err + result.out
    assert result.err == "Git step failed: push. Local data is kept.\n"


def test_failed_sync_after_write_leaves_the_working_tree_clean(synced: Synced) -> None:
    block_pushes(synced)
    synced.brain.run("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert synced.brain.git("status", "--porcelain") == ""
