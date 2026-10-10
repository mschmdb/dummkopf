"""Wire a brain into Git, Claude Code and Codex. No absolute paths end up in any file."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from dummkopf.config import Config
from dummkopf.errors import Rejected

MANAGED = "# managed-by: dummkopf"
# `uv tool install` and `pipx` put executables in ~/.local/bin. Hooks often run with a narrower PATH than
# a terminal (the Claude desktop app, for one), so every hook adds that folder in front. $HOME keeps the
# committed files free of machine-specific paths.
USER_BIN = 'PATH="$HOME/.local/bin:$PATH"'
PRE_COMMIT = f"""#!/bin/sh
{MANAGED}
# Regenerates the sensitive-paths list and the indexes. Never blocks a commit.
{USER_BIN}
export PATH
if command -v dummkopf >/dev/null 2>&1; then
  dummkopf hook pre-commit || true
else
  echo "dummkopf not found on PATH; indexes not updated." >&2
fi
exit 0
"""
CLAUDE_COMMAND = USER_BIN + ' dummkopf --root "$CLAUDE_PROJECT_DIR" hook agent'
CODEX_COMMAND = USER_BIN + ' dummkopf --root "$(git rev-parse --show-toplevel)" hook agent'
CLAUDE_MATCHER = "Write|Edit|MultiEdit|Bash"
CODEX_MATCHER = "Bash|apply_patch|Edit|Write"


def hooks_dir(config: Config) -> Path:
    try:
        done = subprocess.run(["git", "rev-parse", "--git-path", "hooks"], cwd=config.root, capture_output=True,
                              text=True, timeout=config.limits.git_timeout_s, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise Rejected("not_a_git_repo", path=str(config.root)) from error
    if done.returncode != 0 or not done.stdout.strip():
        raise Rejected("not_a_git_repo", path=str(config.root))
    return config.root / done.stdout.strip()


def install_git_hook(config: Config) -> Path:
    hook = hooks_dir(config) / "pre-commit"
    if hook.exists() and MANAGED not in hook.read_text(encoding="utf-8", errors="ignore"):
        raise Rejected("hook_exists", path=str(hook.relative_to(config.root)))
    hook.parent.mkdir(parents=True, exist_ok=True)
    hook.write_text(PRE_COMMIT, encoding="utf-8")
    hook.chmod(0o755)
    return hook


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Rejected("settings_unreadable", path=path.name) from error
    if not isinstance(data, dict):
        raise Rejected("settings_unreadable", path=path.name)
    return data


def is_ours(command: object) -> bool:
    """Any dummkopf agent hook, including the format of older releases."""
    return isinstance(command, str) and "dummkopf" in command and "hook agent" in command


def add_hook(settings: dict[str, Any], event: str, command: dict[str, Any], matcher: str | None) -> None:
    """Add our hook once. Older dummkopf hook commands are replaced, never duplicated."""
    hooks = settings.setdefault("hooks", {})
    entries = hooks.setdefault(event, [])
    emptied: list[dict[str, Any]] = []
    for existing in entries:
        if isinstance(existing, dict) and isinstance(existing.get("hooks"), list) and existing["hooks"]:
            existing["hooks"] = [hook for hook in existing["hooks"]
                                 if hook.get("command") == command["command"] or not is_ours(hook.get("command"))]
            if not existing["hooks"]:
                emptied.append(existing)
    entries[:] = [existing for existing in entries if not any(existing is gone for gone in emptied)]
    for existing in entries:
        if any(hook.get("command") == command["command"] for hook in existing.get("hooks", [])):
            return
    entry: dict[str, Any] = {"matcher": matcher} if matcher else {}
    entry["hooks"] = [command]
    entries.append(entry)


def remove_hooks(settings: dict[str, Any], patterns: tuple[str, ...]) -> int:
    """Drop hook commands containing any pattern, and entries left empty. Returns the number removed."""
    removed = 0
    hooks = settings.get("hooks")
    if not patterns or not isinstance(hooks, dict):
        return 0
    for event, entries in list(hooks.items()):
        if not isinstance(entries, list):
            continue
        kept_entries = []
        for entry in entries:
            commands = entry.get("hooks", []) if isinstance(entry, dict) else []
            kept = [hook for hook in commands
                    if not any(pattern in str(hook.get("command", "")) for pattern in patterns)]
            removed += len(commands) - len(kept)
            if kept or not commands:
                kept_entries.append({**entry, "hooks": kept} if commands else entry)
        hooks[event] = kept_entries
        if not kept_entries:
            del hooks[event]
    return removed


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def install_claude(config: Config, replace: tuple[str, ...] = ()) -> tuple[Path, int]:
    path = config.root / ".claude" / "settings.json"
    settings = load_json(path)
    removed = remove_hooks(settings, replace)
    settings.setdefault("$schema", "https://json.schemastore.org/claude-code-settings.json")
    command = {"type": "command", "command": CLAUDE_COMMAND}
    add_hook(settings, "PostToolUse", command, CLAUDE_MATCHER)
    add_hook(settings, "SessionEnd", command, None)
    write_json(path, settings)
    return path, removed


def install_codex(config: Config, replace: tuple[str, ...] = ()) -> tuple[Path, int]:
    path = config.root / ".codex" / "hooks.json"
    settings = load_json(path)
    removed = remove_hooks(settings, replace)
    command = {"type": "command", "command": CODEX_COMMAND, "timeout": config.limits.git_timeout_s,
               "statusMessage": "Syncing notes"}
    add_hook(settings, "PostToolUse", command, CODEX_MATCHER)
    write_json(path, settings)
    return path, removed


def install(config: Config, replace: tuple[str, ...] = ()) -> tuple[list[str], int]:
    """Return the relative paths written and the number of old hook commands removed.

    `replace` lists substrings of old hook commands to remove first, so a brain never runs two
    sync paths side by side.
    """
    claude, removed = install_claude(config, replace)
    written = [install_git_hook(config), claude]
    if config.extras.codex_sync:
        codex, removed_codex = install_codex(config, replace)
        written.append(codex)
        removed += removed_codex
    return [path.relative_to(config.root).as_posix() for path in written], removed
