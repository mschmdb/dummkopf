"""Black-box harness: every test talks to the CLI through a subprocess and reads files and Git state.

Nothing here imports the implementation, so a port in another language can run the same suite
by pointing DUMMKOPF_BIN at its binary.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

GIT_IDENTITY = {
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}
BASE_TOML = 'schema_version = 1\n[repo]\nremote = "{remote}"\n'
PLACEHOLDER_REMOTE = "git@example.org:me/brain.git"
TIMEOUT_S = 120

Maker = Callable[..., "Brain"]


@dataclass(frozen=True)
class Result:
    code: int
    out: str
    err: str


def binary() -> str:
    """The binary under test: DUMMKOPF_BIN, else the venv's dummkopf, else the one on PATH."""
    configured = os.environ.get("DUMMKOPF_BIN")
    if configured:
        return configured
    beside_python = Path(sys.executable).parent / "dummkopf"
    if beside_python.is_file():
        return str(beside_python)
    found = shutil.which("dummkopf")
    if found is None:
        raise RuntimeError("Set DUMMKOPF_BIN or install dummkopf next to the Python interpreter.")
    return found


def base_env(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """Process environment without DUMMKOPF_ROOT, with the binary's folder first on PATH for hooks."""
    env = {key: value for key, value in os.environ.items() if key != "DUMMKOPF_ROOT"}
    program = binary()
    if os.sep in program:
        env["PATH"] = str(Path(program).parent) + os.pathsep + env.get("PATH", "")
    env.update(GIT_IDENTITY)
    env.update(extra or {})
    return env


def run(*args: str, cwd: Path | str | None = None, stdin: str = "",
        env: Mapping[str, str] | None = None) -> Result:
    done = subprocess.run([binary(), *args], cwd=cwd, input=stdin, capture_output=True, text=True,
                          env=base_env(env), timeout=TIMEOUT_S, check=False)
    return Result(done.returncode, done.stdout, done.stderr)


def git(cwd: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=base_env(),
                          check=check, timeout=TIMEOUT_S)
    return done.stdout.strip()


def note(title: str = "Docker", body: str = "pnpm esbuild fails", fields: str = "",
         updated: str = "2026-10-04") -> str:
    """A note with minimal frontmatter; each line in `fields` shifts the heading down by one line."""
    return f"---\nupdated: {updated}\nstatus: active\n{fields}---\n\n# {title}\n\n{body}\n"


def full_note(title: str = "Test", body: str = "Proven content.", scope: str = "") -> str:
    """A complete note: valid frontmatter, so `check` finds no issue."""
    return ("---\nupdated: 2026-10-01\nstatus: active\nkey_fact: Proven content.\n"
            "summary: Proven content.\naliases: [test]\nperiod: []\nentities: []\n"
            + (f"scope: {scope}\n" if scope else "") + f"---\n\n# {title}\n\n{body}\n")


@dataclass
class Brain:
    root: Path
    toml: str

    def write(self, rel: str, text: str) -> Path:
        target = self.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        return target

    def read(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8")

    def exists(self, rel: str) -> bool:
        return (self.root / rel).exists()

    def configure(self, extra: str) -> None:
        """Append TOML to dummkopf.toml; start a new section with its header inside `extra`."""
        self.toml += extra
        (self.root / "dummkopf.toml").write_text(self.toml, encoding="utf-8")

    def repo_option(self, line: str, commit: bool = True) -> None:
        """Add a key to the [repo] table; in a Git brain, commit the config so the tree stays clean."""
        self.toml = self.toml.replace("[repo]\n", "[repo]\n" + line + "\n", 1)
        (self.root / "dummkopf.toml").write_text(self.toml, encoding="utf-8")
        if commit:
            self.commit("config")

    def run(self, *args: str, stdin: str = "", env: Mapping[str, str] | None = None) -> Result:
        """Run the CLI inside the brain in plain tone."""
        return run(*args, "--serious", cwd=self.root, stdin=stdin, env=env)

    def cheeky(self, *args: str, stdin: str = "") -> Result:
        return run(*args, cwd=self.root, stdin=stdin)

    def git(self, *args: str) -> str:
        return git(self.root, *args)

    def git_init(self) -> None:
        self.git("init", "-q", "-b", "main")

    def commit(self, message: str = "add") -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "--no-verify", "-m", message)

    def mode(self, rel: str) -> int:
        return (self.root / rel).stat().st_mode & 0o777


def make_brain(root: Path, remote: str = PLACEHOLDER_REMOTE, extra: str = "") -> Brain:
    root.mkdir(parents=True, exist_ok=True)
    toml = BASE_TOML.format(remote=remote) + extra
    (root / "dummkopf.toml").write_text(toml, encoding="utf-8")
    (root / ".sensitive-paths").write_text("# generated\n", encoding="utf-8")
    return Brain(root.resolve(), toml)


@dataclass
class Synced:
    """A brain cloned from a local bare remote, with one committed note, `notes/first.md`."""

    base: Path
    remote: Path
    brain: Brain

    def remote_log(self) -> list[str]:
        return git(self.remote, "log", "--format=%s", "main").splitlines()

    def remote_files(self) -> list[str]:
        return git(self.remote, "ls-tree", "-r", "--name-only", "main").splitlines()

    def remote_file(self, rel: str) -> str:
        return git(self.remote, "show", "main:" + rel)

    def remote_edit(self, rel: str, content: str) -> None:
        other = self.base / "other"
        if other.exists():
            git(other, "pull", "-q")
        else:
            git(self.base, "clone", "-q", "-b", "main", str(self.remote), str(other))
        target = other / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        git(other, "add", "-A")
        git(other, "commit", "-q", "-m", "Remote change")
        git(other, "push", "-q", "origin", "main")


@pytest.fixture(autouse=True)
def isolated_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Own HOME and a Git identity per test, so no user config leaks in or out."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / ".gitconfig"))
    monkeypatch.delenv("DUMMKOPF_ROOT", raising=False)
    for key, value in GIT_IDENTITY.items():
        monkeypatch.setenv(key, value)
    return home


@pytest.fixture
def brain(tmp_path: Path) -> Brain:
    return make_brain(tmp_path / "brain")


@pytest.fixture
def make(tmp_path: Path) -> Maker:
    """Build further brains next to the default one: make(name, extra_toml, remote)."""

    def factory(name: str = "other-brain", extra: str = "", remote: str = PLACEHOLDER_REMOTE) -> Brain:
        return make_brain(tmp_path / name, remote=remote, extra=extra)

    return factory


@pytest.fixture
def synced(tmp_path: Path) -> Synced:
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    brain = make_brain(tmp_path / "work", remote=str(remote))
    brain.git_init()
    git(brain.root, "remote", "add", "origin", str(remote))
    brain.write("notes/first.md", full_note("First"))
    brain.commit("Initial")
    git(brain.root, "push", "-q", "-u", "origin", "main")
    return Synced(tmp_path, remote, brain)


def rev_of(out: str, path: str) -> str:
    """Revision (12 hex chars) from the header line `path | rev=...` of text output."""
    for line in out.splitlines():
        if line.startswith(path + " | rev="):
            return line.split("rev=", 1)[1].split(" ", 1)[0]
    raise AssertionError("no header for " + path + " in:\n" + out)


@pytest.fixture
def repo(synced: Synced) -> Brain:
    """The working brain of `synced`: a clean Git checkout whose remote is a local bare repository."""
    return synced.brain


def md(body: str = "Body", fields: str = "", title: str = "T") -> str:
    """Markdown a writer sends: only a key fact in the frontmatter, the rest is completed by dummkopf."""
    return f"---\nkey_fact: A fact.\n{fields}---\n\n# {title}\n\n{body}\n"


Entry = dict[str, Any]


def package(*changes: Entry) -> str:
    return json.dumps({"changes": list(changes)})


def new(path: str, content: str | None = None, **extra: Any) -> Entry:
    """A package entry that creates a file."""
    return {"path": path, "expected": None, "content": md() if content is None else content, **extra}


def ingest(brain: Brain, *changes: Entry, args: tuple[str, ...] = ()) -> Result:
    return brain.run("ingest", "--input", "-", *args, stdin=package(*changes))


def rev(brain: Brain, path: str, *args: str) -> str:
    return rev_of(brain.run("read", path, *args).out, path)


def topic(name: str, scope: str = "work") -> list[Entry]:
    """The README entry that opens a new topic with a scope."""
    return [new(f"topics/{name}/README.md", md(fields=f"scope: {scope}\n", title=name))]
