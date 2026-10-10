from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

from dummkopf.config import CONFIG_NAME, Config, load_config

REPO = Path(__file__).resolve().parents[1]
GERMAN_CONFIG = REPO / "examples" / "config-german-hub.toml"
BASE_CONFIG = 'schema_version = 1\n[repo]\nremote = "{remote}"\n'
GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


def run_git(cwd: Path, *args: str, date: str | None = None) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, **GIT_ENV}
    if date:
        env.update({"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date})
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True)


@dataclass
class Brain:
    root: Path
    toml: str

    @property
    def config(self) -> Config:
        return load_config(self.root)

    def configure(self, extra: str) -> Config:
        self.toml += extra
        (self.root / CONFIG_NAME).write_text(self.toml, encoding="utf-8")
        return self.config

    def write(self, rel: str, text: str) -> Path:
        target = self.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        return target

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8")

    def note(self, rel: str, title: str = "Docker", body: str = "pnpm esbuild fails",
             fields: str = "", updated: str = "2026-10-04") -> Path:
        return self.write(rel, "---\nupdated: " + updated + "\nstatus: active\n" + fields
                          + "---\n\n# " + title + "\n\n" + body + "\n")

    def git_init(self) -> None:
        run_git(self.root, "init", "-q", "-b", "main")
        run_git(self.root, "config", "user.email", "test@example.com")
        run_git(self.root, "config", "user.name", "Test")

    def commit(self, message: str = "add", date: str = "2026-01-02T10:00:00") -> None:
        run_git(self.root, "add", "-A")
        run_git(self.root, "commit", "-q", "--no-verify", "-m", message, date=date)


def make_brain(root: Path, toml: str) -> Brain:
    root.mkdir(parents=True, exist_ok=True)
    (root / CONFIG_NAME).write_text(toml, encoding="utf-8")
    (root / ".sensitive-paths").write_text("# generated\n", encoding="utf-8")
    return Brain(root.resolve(), toml)


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    return make_brain(tmp_path / "brain", BASE_CONFIG.format(remote="git@example.org:me/brain.git"))


@pytest.fixture
def german(tmp_path: Path) -> Brain:
    return make_brain(tmp_path / "hub", GERMAN_CONFIG.read_text(encoding="utf-8"))
