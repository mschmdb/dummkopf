"""Configuration: where the brain is found and which dummkopf.toml files are rejected."""

from __future__ import annotations

from pathlib import Path

import pytest

from .conftest import BASE_TOML, Brain, Maker, make_brain, note, run


@pytest.fixture
def filled(brain: Brain) -> Brain:
    brain.write("notes/alpha.md", note("Alpha", "needle"))
    return brain


def test_missing_config_exits_2_and_names_init(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    result = run("find", "needle", "--serious", cwd=empty)
    assert result.code == 2
    assert result.out == ""
    assert "No dummkopf.toml found in" in result.err
    assert "`dummkopf init`" in result.err
    assert "--root" in result.err


def test_missing_config_names_the_searched_folder(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    assert "empty" in run("find", "needle", "--serious", cwd=empty).err


def test_root_option_selects_the_brain(filled: Brain, tmp_path: Path) -> None:
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    result = run("find", "needle", "--serious", "--root", str(filled.root), cwd=elsewhere)
    assert result.code == 0
    assert result.out.startswith("notes/alpha.md | rev=")


def test_root_option_works_after_the_subcommand_and_before_it(filled: Brain, tmp_path: Path) -> None:
    before = run("--root", str(filled.root), "--serious", "find", "needle", cwd=tmp_path)
    after = run("find", "needle", "--serious", "--root", str(filled.root), cwd=tmp_path)
    assert before.code == after.code == 0
    assert before.out == after.out


def test_root_environment_variable_selects_the_brain(filled: Brain, tmp_path: Path) -> None:
    result = run("find", "needle", "--serious", cwd=tmp_path, env={"DUMMKOPF_ROOT": str(filled.root)})
    assert result.code == 0
    assert "notes/alpha.md" in result.out


def test_root_option_beats_the_environment_variable(filled: Brain, tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    result = run("find", "needle", "--serious", "--root", str(empty), cwd=filled.root,
                 env={"DUMMKOPF_ROOT": str(filled.root)})
    assert result.code == 2
    assert "No dummkopf.toml found" in result.err


def test_root_environment_variable_beats_the_working_folder(filled: Brain, make: Maker) -> None:
    other = make("other")
    other.write("notes/beta.md", note("Beta", "needle"))
    result = run("find", "needle", "--serious", cwd=filled.root, env={"DUMMKOPF_ROOT": str(other.root)})
    assert "notes/beta.md" in result.out
    assert "notes/alpha.md" not in result.out


def test_brain_is_found_from_a_nested_folder(filled: Brain) -> None:
    nested = filled.root / "sub" / "deeper"
    nested.mkdir(parents=True)
    result = run("find", "needle", "--serious", cwd=nested)
    assert result.code == 0
    assert "notes/alpha.md" in result.out


def test_root_without_config_exits_2(filled: Brain, tmp_path: Path) -> None:
    result = run("find", "needle", "--serious", "--root", str(tmp_path / "nonexistent"), cwd=filled.root)
    assert result.code == 2
    assert "No dummkopf.toml found" in result.err


@pytest.mark.parametrize(("toml", "named"), [
    (BASE_TOML.format(remote="x") + "[repo2]\nx = 1\n", "repo2"),
    (BASE_TOML.format(remote="x") + "[ui]\ntonee = 1\n", "ui.tonee"),
    (BASE_TOML.format(remote="x").replace('remote = "x"', 'remote = "x"\nbranchh = "m"'), "repo.branchh"),
    (BASE_TOML.format(remote="x") + "[search.weights]\ntitel = 1\n", "search.weights.titel"),
])
def test_unknown_key_is_rejected_and_named(filled: Brain, toml: str, named: str) -> None:
    (filled.root / "dummkopf.toml").write_text(toml, encoding="utf-8")
    result = run("find", "needle", "--serious", cwd=filled.root)
    assert result.code == 2
    assert result.err == f"dummkopf.toml: {named}: unknown key\n"


@pytest.mark.parametrize(("toml", "message"), [
    ("[repo]\nremote = \"x\"\n", "dummkopf.toml: schema_version: is required"),
    ("schema_version = 2\n[repo]\nremote = \"x\"\n", "dummkopf.toml: schema_version: unsupported version"),
    ("schema_version = 1\n", "dummkopf.toml: repo.remote: is required"),
    ("schema_version = 1\n[repo]\nremote = \"\"\n", "dummkopf.toml: repo.remote: is required"),
    ("schema_version = 1\n[repo]\nremote = \"x\"\n[ui]\ntone = \"loud\"\n",
     "dummkopf.toml: ui.tone: must be one of cheeky, plain"),
    ("schema_version = 1\n[repo]\nremote = \"x\"\n[limits]\nmax_chars = -1\n",
     "dummkopf.toml: limits.max_chars: must not be negative"),
    ("schema_version = 1\n[repo]\nremote = \"x\"\n[limits]\nmax_chars = 100\n",
     "dummkopf.toml: limits.max_chars: must be at least 500"),
    ("schema_version = 1\n[repo]\nremote = \"x\"\nauto_push = \"yes\"\n",
     "dummkopf.toml: repo.auto_push: must be true or false"),
])
def test_invalid_config_value_exits_2_and_names_the_key(filled: Brain, toml: str, message: str) -> None:
    (filled.root / "dummkopf.toml").write_text(toml, encoding="utf-8")
    result = run("find", "needle", "--serious", cwd=filled.root)
    assert result.code == 2
    assert result.err.startswith(message)


def test_broken_toml_exits_2_with_a_readable_message(filled: Brain) -> None:
    (filled.root / "dummkopf.toml").write_text("schema_version = 1\n[repo\n", encoding="utf-8")
    result = run("find", "needle", "--serious", cwd=filled.root)
    assert result.code == 2
    assert result.err.startswith("dummkopf.toml is not readable:")


def test_renamed_scopes_need_matching_link_barriers(filled: Brain) -> None:
    filled.configure('[scopes]\nvalues = ["a", "b"]\n')
    result = run("find", "needle", "--serious", cwd=filled.root)
    assert result.code == 2
    assert "scopes.link_barriers" in result.err
    assert "work>private" in result.err


def test_config_symlink_is_not_followed(filled: Brain, tmp_path: Path) -> None:
    real = tmp_path / "real.toml"
    real.write_text(filled.toml, encoding="utf-8")
    (filled.root / "dummkopf.toml").unlink()
    (filled.root / "dummkopf.toml").symlink_to(real)
    result = run("find", "needle", "--serious", cwd=filled.root)
    assert result.code == 2
    assert "must not be a symlink" in result.err


def test_default_limits_apply_without_a_limits_section(filled: Brain) -> None:
    result = run("find", "needle", "--serious", "--max-chars", "20001", cwd=filled.root)
    assert result.code == 2
    assert result.err == "--max-chars must be between 500 and 20000.\n"


def test_config_without_optional_sections_is_valid(tmp_path: Path) -> None:
    minimal = make_brain(tmp_path / "minimal")
    minimal.write("notes/x.md", note("X", "needle"))
    assert run("find", "needle", "--serious", cwd=minimal.root).code == 0
