from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from conftest import Brain, invoke, run_git

from dummkopf.cli import main
from dummkopf.config import load_config


@pytest.fixture
def repo(brain: Brain) -> Brain:
    brain.git_init()
    return brain


def hook_path(brain: Brain) -> Path:
    return brain.root / run_git(brain.root, "rev-parse", "--git-path", "hooks").stdout.strip() / "pre-commit"


def test_install_writes_git_hook_and_agent_hooks(repo: Brain) -> None:
    code, output, error = invoke(repo, "install")
    assert (code, error) == (0, "")
    hook = hook_path(repo)
    assert hook.is_file() and os.access(hook, os.X_OK)
    script = hook.read_text()
    assert "dummkopf hook pre-commit" in script
    assert "/Users/" not in script and str(repo.root) not in script
    settings = json.loads((repo.root / ".claude/settings.json").read_text())
    post = settings["hooks"]["PostToolUse"][0]
    assert post["matcher"] == "Write|Edit|MultiEdit|Bash"
    assert "hook agent" in post["hooks"][0]["command"]
    assert "$CLAUDE_PROJECT_DIR" in post["hooks"][0]["command"]
    assert "hook agent" in settings["hooks"]["SessionEnd"][0]["hooks"][0]["command"]
    codex = json.loads((repo.root / ".codex/hooks.json").read_text())
    assert codex["hooks"]["PostToolUse"][0]["matcher"] == "Bash|apply_patch|Edit|Write"
    assert "Installed" in output


def test_install_is_idempotent_and_keeps_foreign_settings(repo: Brain) -> None:
    repo.write(".claude/settings.json", json.dumps({"permissions": {"allow": ["Bash(ls)"]},
                                                    "hooks": {"PostToolUse": [{"matcher": "Read", "hooks": []}]}}))
    assert invoke(repo, "install")[0] == 0
    first = (repo.root / ".claude/settings.json").read_text()
    assert invoke(repo, "install")[0] == 0
    assert (repo.root / ".claude/settings.json").read_text() == first
    settings = json.loads(first)
    assert settings["permissions"] == {"allow": ["Bash(ls)"]}
    assert len(settings["hooks"]["PostToolUse"]) == 2


def test_install_skips_codex_when_disabled(repo: Brain) -> None:
    repo.configure("[extras]\ncodex_sync = false\n")
    assert invoke(repo, "install")[0] == 0
    assert not (repo.root / ".codex/hooks.json").exists()


def test_install_never_overwrites_a_foreign_git_hook(repo: Brain) -> None:
    hook = hook_path(repo)
    hook.parent.mkdir(parents=True, exist_ok=True)
    hook.write_text("#!/bin/sh\necho mine\n")
    code, _, error = invoke(repo, "install", "--serious")
    assert code == 2
    assert "pre-commit" in error
    assert hook.read_text() == "#!/bin/sh\necho mine\n"


def test_install_respects_core_hooks_path(repo: Brain) -> None:
    run_git(repo.root, "config", "core.hooksPath", "githooks")
    assert invoke(repo, "install")[0] == 0
    assert (repo.root / "githooks/pre-commit").is_file()


def test_install_outside_git_repo_fails(brain: Brain) -> None:
    assert invoke(brain, "install")[0] == 2


def test_init_scaffolds_a_brain(tmp_path: Path) -> None:
    target = tmp_path / "my-brain"
    assert main(["init", str(target), "--remote", "git@example.org:me/brain.git"]) == 0
    config = load_config(target)
    assert config.repo.remote == "git@example.org:me/brain.git"
    for rel in ("AGENTS.md", "CLAUDE.md", ".gitignore", "INDEX.md", ".sensitive-paths", "topics", "notes",
                "bookmarks", "sources", "archive"):
        assert (target / rel).exists(), rel
    assert "AGENTS.md" in (target / "CLAUDE.md").read_text()
    assert (target / ".git").is_dir()
    assert run_git(target, "symbolic-ref", "--short", "HEAD").stdout.strip() == "main"
    index = (target / "INDEX.md").read_text()
    for heading in ("## Topics", "## Notes (flat)", "## Bookmarks"):
        assert heading in index


def test_init_german_locale_uses_german_headings(tmp_path: Path) -> None:
    target = tmp_path / "hub"
    assert main(["init", str(target), "--locale", "de"]) == 0
    assert "## Notes (flach)" in (target / "INDEX.md").read_text()
    assert load_config(target).ui.locale == "de"


def test_init_refuses_existing_brain(tmp_path: Path) -> None:
    assert main(["init", str(tmp_path)]) == 0
    before = (tmp_path / "dummkopf.toml").read_text()
    assert main(["init", str(tmp_path)]) == 2
    assert (tmp_path / "dummkopf.toml").read_text() == before


def test_init_without_remote_leaves_a_placeholder(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["init", str(tmp_path)]) == 0
    assert "you/your-brain.git" in (tmp_path / "dummkopf.toml").read_text()
    assert "set repo.remote" in capsys.readouterr().out


def test_init_with_remote_does_not_ask_for_it_again(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["init", str(tmp_path), "--remote", "git@example.org:me/brain.git"]) == 0
    output = capsys.readouterr().out
    assert "set repo.remote" not in output and "dummkopf install" in output


def test_agents_rules_are_rendered_for_the_config(tmp_path: Path, german: Brain) -> None:
    import re

    assert main(["init", str(tmp_path / "en")]) == 0
    text = (tmp_path / "en" / "AGENTS.md").read_text()
    assert "> SENSITIVE" in text and "`private`, `work`" in text and "key_fact" in text
    assert "a `work` note must not link to a `private` note" in text
    assert not re.search(r"\{[a-z_]+\}", text), "unfilled placeholder"
    code, output, _ = invoke(german, "meta", "agents")
    assert code == 0
    assert "> SENSIBEL" in output and "`topics/vertraulich/`" in output and "kernfakt" in output
    assert "quellen/" in output and "Optional: Claude desktop app" in output


def test_hook_commands_find_uv_tool_installs_without_fixed_paths(repo: Brain) -> None:
    assert invoke(repo, "install")[0] == 0
    hook = hook_path(repo).read_text()
    claude = (repo.root / ".claude/settings.json").read_text()
    codex = (repo.root / ".codex/hooks.json").read_text()
    for text in (hook, claude, codex):
        assert "$HOME/.local/bin" in text
        assert "/Users/" not in text and str(repo.root) not in text


def test_reinstall_upgrades_older_dummkopf_hook_commands(repo: Brain) -> None:
    old = 'dummkopf --root "$CLAUDE_PROJECT_DIR" hook agent'
    repo.write(".claude/settings.json", json.dumps({"hooks": {
        "PostToolUse": [{"matcher": "Write|Edit|MultiEdit|Bash", "hooks": [{"type": "command", "command": old}]}],
        "SessionEnd": [{"hooks": [{"type": "command", "command": old}]}]}}))
    assert invoke(repo, "install")[0] == 0
    settings = json.loads((repo.root / ".claude/settings.json").read_text())
    commands = [hook["command"] for entries in settings["hooks"].values() for entry in entries
                for hook in entry["hooks"]]
    assert len(commands) == 2
    assert all("$HOME/.local/bin" in command for command in commands)
