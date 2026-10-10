from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from conftest import Synced, document, invoke, revision

from dummkopf.access import Access
from dummkopf.errors import DummkopfError, SyncError
from dummkopf.lock import repository_lock
from dummkopf.sync import prepare_repository, sync_repository
from dummkopf.write import atomic_write, ingest


def packet(synced: Synced, path: str = "notes/first.md", body: str = "New content") -> dict[str, Any]:
    target = synced.brain.root / path
    expected = revision(synced.brain, path) if target.exists() else None
    return {"changes": [{"path": path, "content": document(body=body), "expected": expected}]}


def test_sync_commits_and_pushes_change(synced: Synced) -> None:
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert synced.git("status", "--porcelain") == ""
    assert synced.git("rev-parse", "HEAD") == synced.git("rev-parse", "origin/main")
    assert synced.git("log", "-1", "--format=%s") == "Update notes"


def repo_option(synced: Synced, line: str) -> None:
    synced.brain.toml = synced.brain.toml.replace("[repo]\n", "[repo]\n" + line + "\n")
    synced.brain.configure("")


def test_commit_message_comes_from_config(synced: Synced) -> None:
    repo_option(synced, "commit_message = 'Brain dump'")
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert synced.git("log", "-1", "--format=%s") == "Brain dump"


def test_sync_pushes_existing_local_commit(synced: Synced) -> None:
    synced.brain.write("notes/first.md", "updated\n")
    synced.brain.commit("Earlier edit")
    sync_repository(synced.brain.config)
    assert synced.git("rev-parse", "HEAD") == synced.git("rev-parse", "origin/main")
    assert synced.git("log", "-1", "--format=%s") == "Earlier edit"


def test_sync_preserves_other_fetch_head(synced: Synced) -> None:
    synced.git("fetch", "origin")
    fetch_head = synced.brain.root / ".git" / "FETCH_HEAD"
    shared_state = fetch_head.read_text() * 2
    fetch_head.write_text(shared_state)
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert fetch_head.read_text() == shared_state
    assert synced.git("rev-parse", "HEAD") == synced.git("rev-parse", "refs/heads/main", cwd=synced.remote)


def test_sync_rebases_remote_change(synced: Synced) -> None:
    synced.remote_edit("notes/remote.md", "remote edit\n")
    synced.brain.write("notes/first.md", "local edit\n")
    sync_repository(synced.brain.config)
    assert synced.brain.read("notes/remote.md") == "remote edit\n"
    assert synced.brain.read("notes/first.md") == "local edit\n"
    assert synced.git("status", "--porcelain") == ""
    assert synced.git("rev-parse", "HEAD") == synced.git("rev-parse", "refs/heads/main", cwd=synced.remote)


def exclude_tools(synced: Synced) -> None:
    repo_option(synced, "sync_exclude = ['scripts', 'tool']")
    synced.brain.commit("Configure")
    synced.git("push", "-q")


def test_sync_leaves_excluded_paths_uncommitted(synced: Synced) -> None:
    exclude_tools(synced)
    synced.brain.write("scripts/tool.py", "draft\n")
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert synced.git("status", "--porcelain", "--untracked-files=all") == "?? scripts/tool.py"
    assert synced.git("show", "--name-only", "--format=", "HEAD") == "notes/first.md"


def test_sync_with_only_excluded_changes_creates_no_commit(synced: Synced) -> None:
    exclude_tools(synced)
    before = synced.git("rev-parse", "HEAD")
    synced.brain.write("tool", "cli\n")
    sync_repository(synced.brain.config)
    assert synced.git("rev-parse", "HEAD") == before
    assert synced.git("status", "--porcelain") == "?? tool"


def test_sync_rebases_remote_change_with_dirty_excluded_file(synced: Synced) -> None:
    exclude_tools(synced)
    synced.brain.write("scripts/tool.py", "v1\n")
    synced.brain.commit("Add tool")
    synced.git("push", "-q")
    synced.remote_edit("notes/remote.md", "remote edit\n")
    synced.brain.write("scripts/tool.py", "v2 draft\n")
    synced.brain.write("notes/first.md", "local edit\n")
    sync_repository(synced.brain.config)
    assert synced.brain.read("notes/remote.md") == "remote edit\n"
    assert synced.brain.read("scripts/tool.py") == "v2 draft\n"
    assert synced.git("status", "--porcelain") == "M scripts/tool.py"


def test_prepare_ignores_excluded_changes_but_not_note_changes(synced: Synced) -> None:
    exclude_tools(synced)
    synced.brain.write("scripts/tool.py", "draft\n")
    prepare_repository(synced.brain.config)
    synced.brain.write("notes/first.md", "updated\n")
    with pytest.raises(SyncError) as caught:
        prepare_repository(synced.brain.config)
    assert caught.value.key == "git_dirty"


def test_sync_refuses_other_remote(synced: Synced) -> None:
    synced.git("remote", "set-url", "origin", "git@example.org:other/repo.git")
    synced.brain.write("notes/first.md", "updated\n")
    with pytest.raises(SyncError) as caught:
        sync_repository(synced.brain.config)
    assert caught.value.key == "git_remote"
    assert synced.git("status", "--porcelain") != ""


def test_sync_refuses_other_branch(synced: Synced) -> None:
    synced.git("checkout", "-q", "-b", "experiment")
    synced.brain.write("notes/first.md", "updated\n")
    with pytest.raises(SyncError) as caught:
        sync_repository(synced.brain.config)
    assert caught.value.key == "git_branch"
    assert synced.git("status", "--porcelain") != ""


def test_auto_push_false_commits_locally_only(synced: Synced) -> None:
    repo_option(synced, "auto_push = false")
    remote_head = synced.git("rev-parse", "refs/heads/main", cwd=synced.remote)
    synced.brain.write("notes/first.md", "updated\n")
    sync_repository(synced.brain.config)
    assert synced.git("status", "--porcelain") == ""
    assert synced.git("rev-parse", "refs/heads/main", cwd=synced.remote) == remote_head


def test_ingest_commits_and_pushes_one_validated_batch(synced: Synced) -> None:
    data = packet(synced)
    data["changes"].append({"path": "notes/second.md", "content": document(), "expected": None})
    before = int(synced.git("rev-list", "--count", "HEAD"))
    result = ingest(Access(synced.brain.config), data)
    assert result["sync"] == "ok"
    assert int(synced.git("rev-list", "--count", "HEAD")) == before + 1
    assert synced.git("rev-parse", "HEAD") == synced.git("rev-parse", "main", cwd=synced.remote)
    assert synced.git("status", "--porcelain") == ""


def test_refresh_brings_remote_change_without_local_commit(synced: Synced) -> None:
    synced.remote_edit("notes/remote.md", document())
    sync_repository(synced.brain.config, refresh_remote=True)
    assert (synced.brain.root / "notes/remote.md").exists()


def test_remote_refresh_invalidates_a_prepared_revision(synced: Synced) -> None:
    data = packet(synced, body="Stale local edit")
    synced.remote_edit("notes/first.md", document(body="Remote content"))
    with pytest.raises(DummkopfError) as caught:
        ingest(Access(synced.brain.config), data)
    assert caught.value.key == "version_conflict"
    assert "Remote content" in synced.brain.read("notes/first.md")
    assert synced.git("status", "--porcelain") == ""


def test_sync_conflict_aborts_rebase_and_preserves_local_commit(synced: Synced) -> None:
    synced.remote_edit("notes/first.md", document(body="Remote content"))
    synced.brain.write("notes/first.md", document(body="Local content"))
    with pytest.raises(SyncError) as caught:
        sync_repository(synced.brain.config)
    assert caught.value.key == "git_diverged"
    assert "Local content" in synced.brain.read("notes/first.md")
    assert synced.git("status", "--porcelain") == ""
    assert not (synced.brain.root / ".git/rebase-merge").exists()


def test_sync_errors_never_echo_git_output(synced: Synced) -> None:
    synced.remote_edit("notes/first.md", document(body="Remote SECRET content"))
    synced.brain.write("notes/first.md", document(body="Local SECRET content"))
    code, output, error = invoke(synced.brain, "sync")
    assert code == 2
    assert "SECRET" not in output + error
    assert "Local commits are kept" in error


def test_sync_failure_reports_saved_files_and_exit_code_3(synced: Synced) -> None:
    with patch("dummkopf.write.sync_locked", side_effect=SyncError("git_unavailable")):
        result = ingest(Access(synced.brain.config), packet(synced))
        assert result["sync"] == "failed" and result["saved"]
        assert "New content" in synced.brain.read("notes/first.md")
        synced.git("checkout", "--", ".")
        code, output, error = invoke(synced.brain, "write", "notes/first.md", "--expected",
                                     revision(synced.brain, "notes/first.md")[:12], "--serious",
                                     stdin=document(body="Third"))
    assert code == 3
    assert "sync: failed" in output
    assert "Retry with `dummkopf sync`" in error


def test_cli_sync_reports_in_tone(synced: Synced) -> None:
    assert invoke(synced.brain, "sync")[1] == "Brain synced.\n"
    assert invoke(synced.brain, "sync", "--serious")[1] == "Synced.\n"


def test_write_failure_rolls_back_earlier_changes(synced: Synced) -> None:
    first = synced.brain.root / "notes/first.md"
    before = first.read_bytes()
    data = packet(synced)
    data["changes"].append({"path": "notes/second.md", "content": document(), "expected": None})

    def fail_second(path: Path, data: bytes) -> None:
        if path.name == "second.md":
            raise OSError("Full disk")
        atomic_write(path, data)

    with patch("dummkopf.write.atomic_write", side_effect=fail_second), pytest.raises(DummkopfError) as caught:
        ingest(Access(synced.brain.config), data, sync=False)
    assert caught.value.key == "not_saved"
    assert first.read_bytes() == before
    assert not (synced.brain.root / "notes/second.md").exists()


def test_rollback_never_overwrites_a_foreign_change(synced: Synced) -> None:
    data = packet(synced)
    data["changes"].append({"path": "notes/second.md", "content": document(), "expected": None})

    def fail_second(path: Path, content: bytes) -> None:
        if path.name == "second.md":
            (synced.brain.root / "notes/first.md").write_text("Foreign change")
            raise OSError("Full disk")
        atomic_write(path, content)

    with patch("dummkopf.write.atomic_write", side_effect=fail_second), pytest.raises(DummkopfError) as caught:
        ingest(Access(synced.brain.config), data, sync=False)
    assert caught.value.key == "rollback_failed"
    assert synced.brain.read("notes/first.md") == "Foreign change"


WORKER = """
import json, sys
from pathlib import Path
from dummkopf.access import Access
from dummkopf.config import load_config
from dummkopf.write import ingest
packet = json.load(sys.stdin)
print(json.dumps(ingest(Access(load_config(Path(sys.argv[1]))), packet, sync=False)))
"""


def test_parallel_ingests_accept_only_one_version(synced: Synced) -> None:
    packets = [packet(synced, body="First worker"), packet(synced, body="Second worker")]
    workers = [subprocess.Popen([sys.executable, "-c", WORKER, str(synced.brain.root)], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=dict(os.environ))
               for _ in packets]
    for worker, data in zip(workers, packets, strict=True):
        assert worker.stdin is not None
        worker.stdin.write(json.dumps(data))
        worker.stdin.close()
    for worker in workers:
        worker.wait(timeout=30)
        for stream in (worker.stdout, worker.stderr):
            if stream:
                stream.close()
    assert sorted(worker.returncode == 0 for worker in workers) == [False, True]


def test_shared_reader_waits_for_writer_lock(synced: Synced) -> None:
    script = ("import sys\nfrom pathlib import Path\nfrom dummkopf.lock import repository_lock\n"
              "with repository_lock(Path(sys.argv[1]), shared=True, timeout=0.1):\n    pass\n")
    with repository_lock(synced.brain.root):
        result = subprocess.run([sys.executable, "-c", script, str(synced.brain.root)], capture_output=True,
                                text=True, timeout=10, check=False)
    assert result.returncode != 0
    assert "busy" in result.stderr
