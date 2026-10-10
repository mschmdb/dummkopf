"""One Git sync path for the CLI and every agent hook. Never echoes raw Git output."""

from __future__ import annotations

import subprocess
from pathlib import Path

from dummkopf.config import Config
from dummkopf.errors import SyncError
from dummkopf.lock import repository_lock

OPEN_OPERATIONS = ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD")


def git(config: Config, *args: str, allowed: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(["git", *args], cwd=config.root, capture_output=True, text=True,
                                timeout=config.limits.git_timeout_s, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SyncError("git_unavailable") from error
    if result.returncode not in allowed:
        raise SyncError("git_failed", step=args[0])
    return result


def note_pathspec(config: Config) -> tuple[str, ...]:
    """Everything except sync_exclude; humans commit tooling and agent setup themselves."""
    return ("--", ".", *(":(exclude)" + path for path in config.repo.sync_exclude))


def remote_ref(config: Config) -> str:
    return "refs/remotes/" + config.repo.remote_name + "/" + config.repo.branch


def verify(config: Config) -> None:
    repo = config.repo
    if Path(git(config, "rev-parse", "--show-toplevel").stdout.strip()).resolve() != config.root:
        raise SyncError("git_root")
    if git(config, "symbolic-ref", "--short", "HEAD").stdout.strip() != repo.branch:
        raise SyncError("git_branch", branch=repo.branch)
    if git(config, "remote", "get-url", repo.remote_name).stdout.strip() != repo.remote:
        raise SyncError("git_remote", name=repo.remote_name)
    for state in OPEN_OPERATIONS:
        location = git(config, "rev-parse", "--git-path", state).stdout.strip()
        if (config.root / location).exists():
            raise SyncError("git_open_operation")
    if git(config, "diff", "--name-only", "--diff-filter=U").stdout.strip():
        raise SyncError("git_conflicts")


def refresh(config: Config) -> None:
    repo = config.repo
    # --no-write-fetch-head: parallel fetches would otherwise race on FETCH_HEAD.
    git(config, "fetch", "--no-write-fetch-head", repo.remote_name,
        "refs/heads/" + repo.branch + ":" + remote_ref(config))
    behind = int(git(config, "rev-list", "--count", "HEAD.." + remote_ref(config)).stdout.strip())
    if behind:
        try:
            git(config, "rebase", "--autostash", remote_ref(config))
        except SyncError:
            git(config, "rebase", "--abort")
            raise SyncError("git_diverged") from None


def prepare_repository(config: Config) -> None:
    """Before a write: clean tree, then catch up with the remote, so markers and scopes are current."""
    verify(config)
    if git(config, "status", "--porcelain", "--untracked-files=all", *note_pathspec(config)).stdout:
        raise SyncError("git_dirty")
    if config.repo.auto_push:
        refresh(config)


def sync_locked(config: Config, refresh_remote: bool = False) -> None:
    verify(config)
    spec = note_pathspec(config)
    if git(config, "status", "--porcelain", "--untracked-files=all", *spec).stdout:
        git(config, "add", "-A", *spec)
        if git(config, "diff", "--cached", "--quiet", allowed=(0, 1)).returncode == 1:
            git(config, "commit", "-m", config.repo.commit_message)
    if not config.repo.auto_push:
        return
    ahead = int(git(config, "rev-list", "--count", remote_ref(config) + "..HEAD").stdout.strip())
    if ahead or refresh_remote:
        refresh(config)
        if int(git(config, "rev-list", "--count", remote_ref(config) + "..HEAD").stdout.strip()):
            git(config, "push", config.repo.remote_name, config.repo.branch)


def sync_repository(config: Config, refresh_remote: bool = False) -> None:
    with repository_lock(config.root, timeout=config.limits.lock_timeout_s):
        sync_locked(config, refresh_remote)
