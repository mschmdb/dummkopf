from __future__ import annotations

from pathlib import Path

import pytest

from dummkopf.config import CONFIG_NAME, Config, find_root, load_config
from dummkopf.errors import ConfigError, ConfigMissing

REPO = Path(__file__).resolve().parents[1]
MINIMAL = 'schema_version = 1\n[repo]\nremote = "git@example.org:me/brain.git"\n'


def write(root: Path, text: str) -> Path:
    path = root / CONFIG_NAME
    path.write_text(text, encoding="utf-8")
    return path


def test_minimal_config_uses_documented_defaults(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL)
    config = load_config(tmp_path)
    assert isinstance(config, Config)
    assert config.root == tmp_path.resolve()
    assert config.repo.remote == "git@example.org:me/brain.git"
    assert config.repo.branch == "main"
    assert config.repo.remote_name == "origin"
    assert config.repo.auto_push is True
    assert config.layout.roots == ("topics", "notes", "bookmarks")
    assert config.layout.sources == "sources"
    assert config.scopes.values == ("private", "work")
    assert config.scopes.all == "both"
    assert config.sensitive.marker == "> SENSITIVE"
    assert config.sensitive.always == ()
    assert config.frontmatter.key_fact == "key_fact"
    assert config.ui.tone == "cheeky"
    assert config.limits.max_chars == 6000
    assert config.search.weights.aliases == 12
    assert config.extras.links is True
    assert config.links.output == "LINKS.md"


def test_example_config_loads(tmp_path: Path) -> None:
    write(tmp_path, (REPO / "examples" / "dummkopf.example.toml").read_text(encoding="utf-8"))
    assert load_config(tmp_path).curator.open_days == 28


def test_german_hub_mapping_needs_no_note_migration(tmp_path: Path) -> None:
    write(tmp_path, (REPO / "examples" / "config-german-hub.toml").read_text(encoding="utf-8"))
    config = load_config(tmp_path)
    fm = config.frontmatter
    assert (fm.key_fact, fm.summary, fm.aliases, fm.updated) == ("kernfakt", "kurz", "aliase", "stand")
    assert (fm.period, fm.entities, fm.scope, fm.status) == ("zeitraum", "entitaeten", "scope", "status")
    assert config.scopes.values == ("privat", "work")
    assert config.scopes.mixed_label == "gemischt"
    assert config.status.active == "aktiv"
    assert config.sensitive.marker == "> SENSIBEL"
    assert config.sensitive.always == ("topics/gesundheit/",)
    assert config.layout.sources == "quellen"
    assert config.ui.locale == "de"
    assert config.links.output == "KANTEN.md"
    assert config.repo.sync_exclude == ("scripts", "hub", ".codex", ".claude")


def test_missing_config_is_reported(tmp_path: Path) -> None:
    with pytest.raises(ConfigMissing):
        load_config(tmp_path)


def test_unknown_key_is_rejected_so_typos_never_disable_rules(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL + "[sensitive]\nmarkr = '> SECRET'\n")
    with pytest.raises(ConfigError, match=r"sensitive\.markr"):
        load_config(tmp_path)


def test_unknown_section_is_rejected(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL + "[sensitiv]\nmarker = '> SECRET'\n")
    with pytest.raises(ConfigError, match="sensitiv"):
        load_config(tmp_path)


@pytest.mark.parametrize(
    "text, key",
    [
        ("schema_version = 1\n[repo]\n", "repo.remote"),
        ('[repo]\nremote = "x"\n', "schema_version"),
    ],
)
def test_required_keys(tmp_path: Path, text: str, key: str) -> None:
    write(tmp_path, text)
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(tmp_path)


@pytest.mark.parametrize(
    "snippet, key",
    [
        ("[scopes]\nvalues = []\n", "scopes.values"),
        ("[scopes]\nvalues = ['a', 'a']\n", "scopes.values"),
        ("[scopes]\nvalues = ['a b']\n", "scopes.values"),
        ("[scopes]\nvalues = ['both']\n", "scopes.all"),
        ("[scopes]\nquery_default = 'nope'\n", "scopes.query_default"),
        ("[scopes]\nlink_barriers = ['work>nope']\n", "scopes.link_barriers"),
        ("[scopes]\nvalues = ['a', 'b']\n", "scopes.link_barriers"),
        ("[sensitive]\nmarker = ''\n", "sensitive.marker"),
        ('[sensitive]\nmarker = "a\\nb"\n', "sensitive.marker"),
        ("[sensitive]\nalways = ['../x/']\n", "sensitive.always"),
        ("[layout]\ntopics = 'a/b'\n", "layout.topics"),
        ("[layout]\nnotes = 'topics'\n", "layout"),
        ("[frontmatter]\nkey_fact = 'has space'\n", "frontmatter.key_fact"),
        ("[frontmatter]\nsummary = 'key_fact'\n", "frontmatter"),
        ("[ui]\ntone = 'rude'\n", "ui.tone"),
        ("[ui]\nlocale = 'fr'\n", "ui.locale"),
        ("[limits]\nmax_chars = 'many'\n", "limits.max_chars"),
        ("[limits]\nfind_limit = 0\n", "limits.find_limit"),
        ("[extras]\nlinks = 'yes'\n", "extras.links"),
        ("[links]\noutput = '/etc/passwd'\n", "links.output"),
    ],
)
def test_invalid_values_name_the_key(tmp_path: Path, snippet: str, key: str) -> None:
    write(tmp_path, MINIMAL + snippet)
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(tmp_path)


def test_booleans_are_not_accepted_as_integers(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL + "[limits]\nmax_chars = true\n")
    with pytest.raises(ConfigError, match=r"limits\.max_chars"):
        load_config(tmp_path)


def test_unsupported_schema_version(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL.replace("= 1", "= 2"))
    with pytest.raises(ConfigError, match="schema_version"):
        load_config(tmp_path)


def test_broken_toml_is_a_config_error(tmp_path: Path) -> None:
    write(tmp_path, "schema_version = = 1\n")
    with pytest.raises(ConfigError):
        load_config(tmp_path)


def test_find_root_walks_up_from_cwd(tmp_path: Path) -> None:
    write(tmp_path, MINIMAL)
    nested = tmp_path / "topics" / "a"
    nested.mkdir(parents=True)
    assert find_root(cwd=nested, explicit=None, env={}) == tmp_path.resolve()


def test_find_root_prefers_explicit_then_env(tmp_path: Path) -> None:
    first, second = tmp_path / "one", tmp_path / "two"
    for directory in (first, second):
        directory.mkdir()
        write(directory, MINIMAL)
    assert find_root(cwd=tmp_path, explicit=first, env={"DUMMKOPF_ROOT": str(second)}) == first.resolve()
    assert find_root(cwd=tmp_path, explicit=None, env={"DUMMKOPF_ROOT": str(second)}) == second.resolve()


def test_find_root_without_config_raises(tmp_path: Path) -> None:
    with pytest.raises(ConfigMissing):
        find_root(cwd=tmp_path, explicit=None, env={})
    with pytest.raises(ConfigMissing):
        find_root(cwd=tmp_path, explicit=tmp_path, env={})


def test_config_symlink_is_rejected(tmp_path: Path) -> None:
    real = tmp_path / "real.toml"
    real.write_text(MINIMAL, encoding="utf-8")
    (tmp_path / CONFIG_NAME).symlink_to(real)
    with pytest.raises(ConfigError):
        load_config(tmp_path)
