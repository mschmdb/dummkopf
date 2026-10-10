"""Hooks: the Git pre-commit backstop and the agent hook for Claude Code and Codex.

Hooks never block. The pre-commit hook always exits 0; the agent hook exits 1 on a
failed sync, which both agents treat as a non-blocking error.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from dummkopf.config import Config
from dummkopf.errors import DummkopfError
from dummkopf.files import iter_note_files
from dummkopf.messages import text as say
from dummkopf.meta import generate, migrate, report
from dummkopf.sensitive import Sensitivity
from dummkopf.sync import sync_repository

# Claude Code: Bash, Write, Edit, MultiEdit. Codex: apply_patch, exec_command.
WATCHED_TOOLS = frozenset({"Bash", "Write", "Edit", "MultiEdit", "apply_patch", "exec_command"})
FILE_TOOLS = frozenset({"Write", "Edit", "MultiEdit"})


def is_brain_path(path: Path, root: Path) -> bool:
    resolved = path.resolve()
    return resolved == root or root in resolved.parents


def agent_event(event: object, config: Config) -> int:
    if not isinstance(event, dict):
        return 0
    tool = event.get("tool_name")
    session_end = event.get("hook_event_name") == "SessionEnd"
    if (not isinstance(tool, str) or tool not in WATCHED_TOOLS) and not session_end:
        return 0
    cwd = event.get("cwd", str(Path.cwd()))
    if not isinstance(cwd, str):
        return 0
    inputs = event.get("tool_input")
    file = inputs.get("file_path") if isinstance(inputs, dict) else None
    edited = tool in FILE_TOOLS and isinstance(file, str) and is_brain_path(Path(file), config.root)
    if not is_brain_path(Path(cwd), config.root) and not edited:
        return 0
    try:
        sync_repository(config)
    except (OSError, DummkopfError) as error:
        sys.stderr.write(say("hook_sync_failed", "plain", reason=str(error)) + "\n")
        return 1
    return 0


def git_lines(config: Config, *args: str) -> list[str]:
    done = subprocess.run(["git", *args], cwd=config.root, capture_output=True, text=True,
                          timeout=config.limits.git_timeout_s, check=False)
    return done.stdout.splitlines() if done.returncode == 0 else []


def stage(config: Config, paths: list[str]) -> None:
    if paths:
        git_lines(config, "add", "--", *paths)


def pre_commit(config: Config) -> int:
    """Regenerate the sensitive-paths list, complete frontmatter of staged notes, rebuild indexes."""
    if not (config.root / config.layout.index).is_file():
        return 0
    try:
        paths_file = config.root / config.sensitive.paths_file
        fresh = Sensitivity.generate(config)
        current = paths_file.read_text(encoding="utf-8") if paths_file.is_file() else None
        if fresh != current:
            paths_file.write_text(fresh, encoding="utf-8")
            paths_file.chmod(0o600)
            stage(config, [config.sensitive.paths_file])
            sys.stdout.write(say("out_paths_file_updated", "plain", file=config.sensitive.paths_file) + "\n")
        notes = set(iter_note_files(config))
        staged = [rel for rel in git_lines(config, "diff", "--cached", "--name-only", "--diff-filter=ACMR")
                  if rel in notes and not (config.root / rel).read_text(encoding="utf-8").startswith("---")]
        if staged:
            stage(config, migrate(config, only=staged))
        stage(config, generate(config))
        findings = report(config, only_findings=True)
        if findings:
            sys.stdout.write(findings + "\n")
    except (OSError, UnicodeError, ValueError, DummkopfError, subprocess.SubprocessError) as error:
        sys.stderr.write(say("hook_index_failed", "plain", reason=str(error)) + "\n")
    return 0
