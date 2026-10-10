"""Load and validate dummkopf.toml. Unknown keys fail, so a typo never disables a rule."""

from __future__ import annotations

import dataclasses
import os
import re
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, TypeVar, get_type_hints

from dummkopf.errors import ConfigError, ConfigMissing

CONFIG_NAME = "dummkopf.toml"
SCHEMA_VERSION = 1
ROOT_ENV = "DUMMKOPF_ROOT"
LOCALES = ("en", "de")
TONES = ("cheeky", "plain")

NAME_RE = re.compile(r"[\w.][\w.-]*")
SCOPE_RE = re.compile(r"[\w-]+")
FRONTMATTER_KEY_RE = re.compile(r"[A-Za-z0-9_.\-]+")


@dataclass(frozen=True)
class RepoConfig:
    remote: str = ""
    remote_name: str = "origin"
    branch: str = "main"
    auto_push: bool = True
    commit_message: str = "Update notes"
    sync_exclude: tuple[str, ...] = ()


@dataclass(frozen=True)
class LayoutConfig:
    topics: str = "topics"
    topic_readme: str = "README.md"
    notes: str = "notes"
    bookmarks: str = "bookmarks"
    archive: str = "archive"
    sources: str = "sources"
    index: str = "INDEX.md"

    @property
    def roots(self) -> tuple[str, str, str]:
        """Folders that hold notes; everything else in the repo is invisible to agents."""
        return (self.topics, self.notes, self.bookmarks)

    @property
    def flat_roots(self) -> tuple[str, str]:
        return (self.notes, self.bookmarks)


@dataclass(frozen=True)
class ScopesConfig:
    values: tuple[str, ...] = ("private", "work")
    all: str = "both"
    query_default: str = "both"
    mixed_label: str = "mixed"
    require_on_new_topic: bool = True
    link_barriers: tuple[str, ...] = ("work>private",)

    @property
    def choices(self) -> tuple[str, ...]:
        return (self.all, *self.values)


@dataclass(frozen=True)
class StatusConfig:
    active: str = "active"
    archived: str = "archived"


@dataclass(frozen=True)
class SensitiveConfig:
    marker: str = "> SENSITIVE"
    paths_file: str = ".sensitive-paths"
    always: tuple[str, ...] = ()


@dataclass(frozen=True)
class FrontmatterConfig:
    key_fact: str = "key_fact"
    summary: str = "summary"
    aliases: str = "aliases"
    updated: str = "updated"
    status: str = "status"
    period: str = "period"
    entities: str = "entities"
    scope: str = "scope"
    todo_placeholder: str = "TODO"
    summary_max: int = 160

    @property
    def mapped_keys(self) -> tuple[str, ...]:
        return (self.key_fact, self.summary, self.aliases, self.updated,
                self.status, self.period, self.entities, self.scope)

    @property
    def list_keys(self) -> tuple[str, str, str]:
        return (self.aliases, self.period, self.entities)

    @property
    def field_order(self) -> tuple[str, ...]:
        """Order of the managed keys when dummkopf writes frontmatter."""
        return (self.updated, self.status, self.key_fact, self.summary,
                self.aliases, self.period, self.entities)


@dataclass(frozen=True)
class UiConfig:
    locale: str = "en"
    tone: str = "cheeky"


@dataclass(frozen=True)
class LimitsConfig:
    max_chars: int = 6000
    find_limit: int = 3
    max_input_chars: int = 2_000_000
    max_changes: int = 50
    lock_timeout_s: int = 10
    git_timeout_s: int = 60
    stale_after_days: int = 56


@dataclass(frozen=True)
class SearchWeights:
    title: int = 8
    aliases: int = 12
    key_fact: int = 4
    path: int = 3
    body: int = 1
    topic_readme_bonus: int = 30


@dataclass(frozen=True)
class SearchConfig:
    weights: SearchWeights = field(default_factory=SearchWeights)


@dataclass(frozen=True)
class ContextConfig:
    routes_file: str = "routes.json"


@dataclass(frozen=True)
class LinksOptions:
    output: str = "LINKS.md"
    entities_file: str = "entities.txt"
    min_topics: int = 2


@dataclass(frozen=True)
class CuratorOptions:
    open_days: int = 28
    stale_days: int = 56
    report_dir: str = "topics/curator"


@dataclass(frozen=True)
class ExtrasConfig:
    links: bool = True
    curator: bool = True
    codex_sync: bool = True


@dataclass(frozen=True)
class Config:
    root: Path
    repo: RepoConfig
    layout: LayoutConfig = field(default_factory=LayoutConfig)
    scopes: ScopesConfig = field(default_factory=ScopesConfig)
    status: StatusConfig = field(default_factory=StatusConfig)
    sensitive: SensitiveConfig = field(default_factory=SensitiveConfig)
    frontmatter: FrontmatterConfig = field(default_factory=FrontmatterConfig)
    ui: UiConfig = field(default_factory=UiConfig)
    limits: LimitsConfig = field(default_factory=LimitsConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    context: ContextConfig = field(default_factory=ContextConfig)
    extras: ExtrasConfig = field(default_factory=ExtrasConfig)
    links: LinksOptions = field(default_factory=LinksOptions)
    curator: CuratorOptions = field(default_factory=CuratorOptions)


T = TypeVar("T")


def invalid(key: str, problem: str) -> ConfigError:
    return ConfigError("config_invalid", key=key, problem=problem)


def build(cls: type[T], table: Mapping[str, Any], prefix: str) -> T:
    hints = get_type_hints(cls)
    names = {f.name for f in dataclasses.fields(cls)}  # type: ignore[arg-type]
    values: dict[str, Any] = {}
    for name, raw in table.items():
        dotted = prefix + "." + name if prefix else name
        if name not in names or name == "root":
            raise invalid(dotted, "unknown key")
        values[name] = coerce(hints[name], raw, dotted)
    return cls(**values)


def coerce(kind: Any, raw: Any, key: str) -> Any:
    if dataclasses.is_dataclass(kind):
        if not isinstance(raw, dict):
            raise invalid(key, "must be a table")
        return build(kind, raw, key)  # type: ignore[arg-type]
    if kind is bool:
        if not isinstance(raw, bool):
            raise invalid(key, "must be true or false")
        return raw
    if kind is int:
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise invalid(key, "must be an integer")
        if raw < 0:
            raise invalid(key, "must not be negative")
        return raw
    if kind is str:
        if not isinstance(raw, str):
            raise invalid(key, "must be a string")
        return raw
    if kind == tuple[str, ...]:
        if not isinstance(raw, list) or any(not isinstance(item, str) for item in raw):
            raise invalid(key, "must be a list of strings")
        return tuple(raw)
    raise TypeError("unsupported config type for " + key)


def relative_path(value: str, key: str, allow_dir: bool = False, written: bool = False) -> None:
    """Relative, normalized (no `./`, no `//`), inside the brain. Prefix matching relies on the exact form."""
    plain = value.rstrip("/") if allow_dir else value
    path = PurePosixPath(plain)
    if (not plain or path.is_absolute() or ".." in path.parts or "\\" in value
            or not path.parts or value.startswith("~") or path.as_posix() != plain
            or (written and path.parts[0] in (".git", CONFIG_NAME))):
        raise invalid(key, "must be a normalized relative path inside the brain")


def validate(config: Config) -> None:
    if not config.repo.remote.strip():
        raise invalid("repo.remote", "is required")
    if not NAME_RE.fullmatch(config.repo.branch) or not NAME_RE.fullmatch(config.repo.remote_name):
        raise invalid("repo.branch", "must be a plain branch name")
    for item in config.repo.sync_exclude:
        relative_path(item, "repo.sync_exclude", allow_dir=True)

    layout = config.layout
    folders = {"topics": layout.topics, "notes": layout.notes, "bookmarks": layout.bookmarks,
               "archive": layout.archive, "sources": layout.sources}
    for name, value in {**folders, "topic_readme": layout.topic_readme, "index": layout.index}.items():
        if not NAME_RE.fullmatch(value) or value in (".", ".."):
            raise invalid("layout." + name, "must be a single file or folder name")
    if len(set(layout.roots)) != len(layout.roots):
        raise invalid("layout", "topics, notes and bookmarks need distinct folders")
    if not layout.topic_readme.endswith(".md"):
        raise invalid("layout.topic_readme", "must be a .md file")

    scopes = config.scopes
    if not scopes.values:
        raise invalid("scopes.values", "needs at least one scope")
    if len(set(scopes.values)) != len(scopes.values):
        raise invalid("scopes.values", "must not repeat a scope")
    if any(not SCOPE_RE.fullmatch(value) for value in scopes.values):
        raise invalid("scopes.values", "use letters, digits, - and _ only")
    if not SCOPE_RE.fullmatch(scopes.all) or scopes.all in scopes.values:
        raise invalid("scopes.all", "must be a plain word that is not a scope value")
    if scopes.query_default not in scopes.choices:
        raise invalid("scopes.query_default", "must be scopes.all or one of scopes.values")
    if not scopes.mixed_label.strip():
        raise invalid("scopes.mixed_label", "must not be empty")
    for barrier in scopes.link_barriers:
        source, _, target = barrier.partition(">")
        if source not in scopes.values or target not in scopes.values or source == target:
            raise invalid("scopes.link_barriers", "'" + barrier + "' must read <scope>><other scope>, "
                          "using scopes.values; set link_barriers when you rename scopes")

    if not config.status.active.strip() or not config.status.archived.strip():
        raise invalid("status", "values must not be empty")

    sensitive = config.sensitive
    if not sensitive.marker.strip() or "\n" in sensitive.marker or "\r" in sensitive.marker:
        raise invalid("sensitive.marker", "must be one non-empty line")
    if not NAME_RE.fullmatch(sensitive.paths_file):
        raise invalid("sensitive.paths_file", "must be a single file name")
    for item in sensitive.always:
        relative_path(item, "sensitive.always", allow_dir=True)

    fm = config.frontmatter
    for name in ("key_fact", "summary", "aliases", "updated", "status", "period", "entities", "scope"):
        if not FRONTMATTER_KEY_RE.fullmatch(getattr(fm, name)):
            raise invalid("frontmatter." + name, "must be a plain frontmatter key")
    if len(set(fm.mapped_keys)) != len(fm.mapped_keys):
        raise invalid("frontmatter", "two fields map to the same key")
    if not fm.todo_placeholder.strip() or fm.summary_max < 20:
        raise invalid("frontmatter.summary_max", "must be at least 20")

    if config.ui.locale not in LOCALES:
        raise invalid("ui.locale", "must be one of " + ", ".join(LOCALES))
    if config.ui.tone not in TONES:
        raise invalid("ui.tone", "must be one of " + ", ".join(TONES))

    limits = config.limits
    for name, low in (("max_chars", 500), ("find_limit", 1), ("max_input_chars", 1), ("max_changes", 1),
                      ("lock_timeout_s", 1), ("git_timeout_s", 1), ("stale_after_days", 1)):
        if getattr(limits, name) < low:
            raise invalid("limits." + name, "must be at least " + str(low))
    if limits.max_chars > 20000:
        raise invalid("limits.max_chars", "must be at most 20000")
    if limits.find_limit > 10:
        raise invalid("limits.find_limit", "must be at most 10")

    relative_path(config.context.routes_file, "context.routes_file")
    relative_path(config.links.output, "links.output", written=True)
    if not config.links.output.endswith(".md"):
        raise invalid("links.output", "must be a .md file")
    if PurePosixPath(config.links.output).parts[0] in layout.roots:
        raise invalid("links.output", "must lie outside the note folders, or it becomes a searchable note")
    relative_path(config.links.entities_file, "links.entities_file")
    relative_path(config.curator.report_dir, "curator.report_dir", allow_dir=True, written=True)
    if config.links.min_topics < 1:
        raise invalid("links.min_topics", "must be at least 1")


def load_config(root: Path) -> Config:
    root = root.resolve()
    path = root / CONFIG_NAME
    if path.is_symlink():
        raise ConfigError("config_unreadable", detail="dummkopf.toml must not be a symlink")
    if not path.is_file():
        raise ConfigMissing("config_missing", start=str(root))
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as error:
        raise ConfigError("config_unreadable", detail=str(error)) from error
    data = dict(data)
    version = data.pop("schema_version", None)
    if version is None:
        raise invalid("schema_version", "is required")
    if version != SCHEMA_VERSION:
        raise invalid("schema_version", "unsupported version; this dummkopf reads version 1")
    repo = data.get("repo")
    if not isinstance(repo, dict) or "remote" not in repo:
        raise invalid("repo.remote", "is required")
    config = dataclasses.replace(build(_Sections, data, ""), root=root)
    as_config = Config(**{f.name: getattr(config, f.name) for f in dataclasses.fields(Config)})
    validate(as_config)
    return as_config


@dataclass(frozen=True)
class _Sections(Config):
    """Config with a placeholder root, so the generic builder can fill it from TOML."""

    root: Path = Path()
    repo: RepoConfig = field(default_factory=RepoConfig)


def find_root(cwd: Path, explicit: Path | None, env: Mapping[str, str] | None = None) -> Path:
    environment = os.environ if env is None else env
    if explicit is not None:
        candidates = [explicit]
    elif environment.get(ROOT_ENV):
        candidates = [Path(environment[ROOT_ENV])]
    else:
        start = cwd.resolve()
        candidates = [start, *start.parents]
    for candidate in candidates:
        if (candidate / CONFIG_NAME).is_file():
            return candidate.resolve()
    raise ConfigMissing("config_missing", start=str(candidates[0]))
