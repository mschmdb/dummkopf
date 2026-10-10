"""`dummkopf init`: create a new brain repository from the packaged templates."""

from __future__ import annotations

import subprocess
from importlib.resources import files
from pathlib import Path

from dummkopf.config import CONFIG_NAME, load_config
from dummkopf.errors import Rejected
from dummkopf.locale import get_locale
from dummkopf.sensitive import Sensitivity

PLACEHOLDER_REMOTE = "git@github.com:you/your-brain.git"


def template(name: str) -> str:
    return files("dummkopf").joinpath("templates", name).read_text(encoding="utf-8")


def index_text(locale_name: str) -> str:
    locale = get_locale(locale_name)
    return ("# Index\n\nThe tables below are generated from frontmatter. Prose around them stays.\n\n"
            + locale.index_topics + "\n\n" + locale.index_notes + "\n\n" + locale.index_bookmarks + "\n")


def inside_git_repo(path: Path) -> bool:
    done = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=path, capture_output=True,
                          text=True, check=False)
    return done.returncode == 0


def init(target: Path, remote: str | None, locale: str) -> Path:
    target = target.resolve()
    if (target / CONFIG_NAME).exists():
        raise Rejected("brain_exists", path=str(target))
    target.mkdir(parents=True, exist_ok=True)
    settings = template("dummkopf.toml").replace("{remote}", remote or PLACEHOLDER_REMOTE)
    (target / CONFIG_NAME).write_text(settings.replace("{locale}", locale), encoding="utf-8")
    config = load_config(target)
    files_to_write = {
        "AGENTS.md": template("AGENTS.md"),
        "CLAUDE.md": template("CLAUDE.md"),
        ".gitignore": template("gitignore"),
        config.layout.index: index_text(locale),
    }
    for name, text in files_to_write.items():
        path = target / name
        if not path.exists():
            path.write_text(text, encoding="utf-8")
    layout = config.layout
    for folder in (layout.topics, layout.notes, layout.bookmarks, layout.sources, layout.archive):
        (target / folder).mkdir(exist_ok=True)
        keep = target / folder / ".gitkeep"
        if not any((target / folder).iterdir()):
            keep.touch()
    paths_file = target / config.sensitive.paths_file
    paths_file.write_text(Sensitivity.generate(config), encoding="utf-8")
    paths_file.chmod(0o600)
    if not inside_git_repo(target):
        subprocess.run(["git", "init", "-q", "-b", config.repo.branch], cwd=target, check=True)
        if remote:
            subprocess.run(["git", "remote", "add", config.repo.remote_name, remote], cwd=target, check=True)
    return target
