"""Wire a brain into Git, Claude Code and Codex. No absolute paths end up in any file."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from dummkopf.config import Config
from dummkopf.errors import Rejected

MANAGED = "# managed-by: dummkopf"
PRE_COMMIT = f"""#!/bin/sh
{MANAGED}
# Regenerates the sensitive-paths list and the indexes. Never blocks a commit.
if command -v dummkopf >/dev/null 2>&1; then
  dummkopf hook pre-commit || true
else
  echo "dummkopf not found on PATH; indexes not updated." >&2
fi
exit 0
"""
CLAUDE_COMMAND = 'dummkopf --root "$CLAUDE_PROJECT_DIR" hook agent'
CODEX_COMMAND = 'dummkopf --root "$(git rev-parse --show-toplevel)" hook agent'
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


def add_hook(settings: dict[str, Any], event: str, command: dict[str, Any], matcher: str | None) -> None:
    """Append our hook unless an entry already runs the same command."""
    hooks = settings.setdefault("hooks", {})
    entries = hooks.setdefault(event, [])
    for existing in entries:
        if any(hook.get("command") == command["command"] for hook in existing.get("hooks", [])):
            return
    entry: dict[str, Any] = {"matcher": matcher} if matcher else {}
    entry["hooks"] = [command]
    entries.append(entry)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def install_claude(config: Config) -> Path:
    path = config.root / ".claude" / "settings.json"
    settings = load_json(path)
    settings.setdefault("$schema", "https://json.schemastore.org/claude-code-settings.json")
    command = {"type": "command", "command": CLAUDE_COMMAND}
    add_hook(settings, "PostToolUse", command, CLAUDE_MATCHER)
    add_hook(settings, "SessionEnd", command, None)
    write_json(path, settings)
    return path


def install_codex(config: Config) -> Path:
    path = config.root / ".codex" / "hooks.json"
    settings = load_json(path)
    command = {"type": "command", "command": CODEX_COMMAND, "timeout": config.limits.git_timeout_s,
               "statusMessage": "Syncing notes"}
    add_hook(settings, "PostToolUse", command, CODEX_MATCHER)
    write_json(path, settings)
    return path


def install(config: Config) -> list[str]:
    """Return the relative paths written."""
    written = [install_git_hook(config), install_claude(config)]
    if config.extras.codex_sync:
        written.append(install_codex(config))
    return [path.relative_to(config.root).as_posix() for path in written]
