"""`dummkopf init`: create a new brain repository from the packaged templates."""

from __future__ import annotations

import subprocess
from importlib.resources import files
from pathlib import Path

from dummkopf.config import CONFIG_NAME, Config, load_config
from dummkopf.errors import Rejected
from dummkopf.locale import get_locale
from dummkopf.sensitive import Sensitivity

PLACEHOLDER_REMOTE = "git@github.com:you/your-brain.git"


def template(name: str) -> str:
    return files("dummkopf").joinpath("templates", name).read_text(encoding="utf-8")


def code_list(values: tuple[str, ...]) -> str:
    return ", ".join("`" + value + "`" for value in values)


def render_agents(config: Config) -> str:
    """AGENTS.md with this brain's folders, keys, scopes and marker filled in."""
    fm = config.frontmatter
    layout = config.layout
    barriers = [barrier.partition(">") for barrier in config.scopes.link_barriers]
    if barriers:
        barrier_text = ("Links respect scope barriers: " + "; ".join(
            f"a `{left}` note must not link to a `{right}` note" for left, _, right in barriers) + ".")
    else:
        barrier_text = "Links may cross scopes."
    always = ""
    if config.sensitive.always:
        always = (" These paths are always sensitive, marker or not: " + code_list(config.sensitive.always)
                  + ". New files there get the marker automatically.")
    return template("AGENTS.md").format(
        topics=layout.topics, notes=layout.notes, bookmarks=layout.bookmarks, sources=layout.sources,
        readme=layout.topic_readme, index=layout.index, scope_key=fm.scope, scopes=code_list(config.scopes.values),
        all=config.scopes.all, barriers=barrier_text, marker=config.sensitive.marker,
        paths_file=config.sensitive.paths_file, always=always, key_fact=fm.key_fact, updated=fm.updated,
        status=fm.status, summary=fm.summary, aliases=fm.aliases, period=fm.period, entities=fm.entities)


def index_text(locale_name: str) -> str:
    locale = get_locale(locale_name)
    return ("# Index\n\nThe tables below are generated from frontmatter. Prose around them stays.\n\n"
            + locale.index_topics + "\n\n" + locale.index_notes + "\n\n" + locale.index_bookmarks + "\n")


def inside_git_repo(path: Path) -> bool:
    done = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=path, capture_output=True,
                          text=True, check=False)
    return done.returncode == 0


def has_remote(path: Path, name: str) -> bool:
    done = subprocess.run(["git", "remote", "get-url", name], cwd=path, capture_output=True, text=True, check=False)
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
        "AGENTS.md": render_agents(config),
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
    if remote and not has_remote(target, config.repo.remote_name):
        subprocess.run(["git", "remote", "add", config.repo.remote_name, remote], cwd=target, check=True)
    return target
