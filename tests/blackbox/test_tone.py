"""Tone: cheeky and plain messages carry the same instruction; JSON and note text never change."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from .conftest import Brain, Synced, md, note, run

DENIED_PLAIN = "Path unavailable or access excluded."


@pytest.fixture
def filled(brain: Brain) -> Brain:
    brain.write("notes/alpha.md", note("Alpha", "needle"))
    return brain


# --- the three messages named in the README ---------------------------------------------------------------------


def test_denied_path_is_cheeky_by_default(filled: Brain) -> None:
    result = filled.cheeky("read", "notes/absent.md")
    assert (result.code, result.out) == (2, "")
    assert result.err == f"Dummkopf! {DENIED_PLAIN}\n"


def test_denied_path_is_plain_with_serious(filled: Brain) -> None:
    assert filled.run("read", "notes/absent.md").err == f"{DENIED_PLAIN}\n"


def test_hidden_and_missing_paths_stay_identical_in_the_cheeky_tone(filled: Brain) -> None:
    filled.write("notes/marked.md", note("Marked", "> SENSITIVE"))
    assert filled.cheeky("read", "notes/marked.md") == filled.cheeky("read", "notes/absent.md")


def test_no_results_is_cheeky_by_default(filled: Brain) -> None:
    result = filled.cheeky("find", "zzz")
    assert result.code == 0
    assert result.out == ("Nothing found in released sources. "
                          "Even a Dummkopf knows when it doesn't know.\nNot found: zzz\n")


def test_no_results_is_plain_with_serious(filled: Brain) -> None:
    assert filled.run("find", "zzz").out == "Nothing found in released sources.\nNot found: zzz\n"


def test_sync_says_brain_synced_when_cheeky_and_synced_when_plain(synced: Synced) -> None:
    assert synced.brain.cheeky("sync").out == "Brain synced.\n"
    assert synced.brain.run("sync").out == "Synced.\n"


# --- config and flag -------------------------------------------------------------------------------------------


def test_tone_plain_in_the_config_is_the_default(filled: Brain) -> None:
    filled.configure('[ui]\ntone = "plain"\n')
    result = run("read", "notes/absent.md", cwd=filled.root)
    assert result.err == f"{DENIED_PLAIN}\n"
    assert run("find", "zzz", cwd=filled.root).out.startswith("Nothing found in released sources.\n")


def test_serious_beats_tone_cheeky_in_the_config(filled: Brain) -> None:
    filled.configure('[ui]\ntone = "cheeky"\n')
    assert run("read", "notes/absent.md", "--serious", cwd=filled.root).err == f"{DENIED_PLAIN}\n"


def test_serious_works_before_the_subcommand(filled: Brain) -> None:
    assert run("--serious", "read", "notes/absent.md", cwd=filled.root).err == f"{DENIED_PLAIN}\n"


def test_missing_config_message_is_cheeky_by_default(tmp_path: Path) -> None:
    cheeky = run("find", "x", cwd=tmp_path)
    plain = run("find", "x", "--serious", cwd=tmp_path)
    assert cheeky.err.startswith("No brain here, Dummkopf. No dummkopf.toml found in ")
    assert plain.err.startswith("No dummkopf.toml found in ")
    assert cheeky.err.endswith(plain.err)


# --- the joke never hides the instruction ----------------------------------------------------------------------


def test_cheeky_version_conflict_keeps_the_current_rev(synced: Synced) -> None:
    cheeky = synced.brain.cheeky("write", "notes/first.md", "--expected", "0123456789ab", stdin=md())
    plain = synced.brain.run("write", "notes/first.md", "--expected", "0123456789ab", stdin=md())
    assert cheeky.code == plain.code == 2
    assert cheeky.err == f"Someone else touched this note. Read it again, Dummkopf. {plain.err}"
    assert "current rev=" in cheeky.err


def test_cheeky_new_sensitive_note_keeps_the_grant_instruction(synced: Synced) -> None:
    content = md("> SENSITIVE")
    cheeky = synced.brain.cheeky("write", "notes/secret.md", "--expected", "new", stdin=content)
    plain = synced.brain.run("write", "notes/secret.md", "--expected", "new", stdin=content)
    assert cheeky.err == f"Dummkopf! {plain.err}"
    assert "--allow-sensitive notes/secret.md" in cheeky.err


def test_cheeky_marker_removal_keeps_the_rule(synced: Synced) -> None:
    synced.brain.run("write", "notes/secret.md", "--expected", "new", "--allow-sensitive", "notes/secret.md",
                     stdin=md("> SENSITIVE\n\nbody"))
    rev = json.loads(synced.brain.run("read", "notes/secret.md", "--allow-sensitive", "notes/secret.md",
                                      "--json").out)["hits"][0]["revision"]
    args = ("write", "notes/secret.md", "--expected", rev, "--allow-sensitive", "notes/secret.md")
    cheeky = synced.brain.cheeky(*args, stdin=md("no marker"))
    plain = synced.brain.run(*args, stdin=md("no marker"))
    assert plain.err == "A write package must not remove a sensitivity marker.\n"
    assert cheeky.err == f"Dummkopf! {plain.err}"


@pytest.mark.parametrize("args", [("find", "docker", "--limit", "11"), ("read", "notes/alpha.md", "--start", "0"),
                                  ("find", "docker", "--scope", "nowhere"), ("find", ""),
                                  ("read", "notes/alpha.md", "--section", "nope")])
def test_errors_without_a_cheeky_variant_read_the_same_in_both_tones(filled: Brain, args: tuple[str, ...]) -> None:
    cheeky = filled.cheeky(*args)
    plain = filled.run(*args)
    assert cheeky.code == plain.code == 2
    assert cheeky.err == plain.err


# --- what the tone never touches ---------------------------------------------------------------------------------


@pytest.mark.parametrize("args", [("find", "needle"), ("context", "needle"), ("read", "notes/alpha.md"),
                                  ("find", "needle", "--json"), ("check",), ("meta", "report")])
def test_successful_output_is_the_same_in_both_tones(filled: Brain, args: tuple[str, ...]) -> None:
    assert filled.cheeky(*args) == filled.run(*args)


def test_json_for_empty_results_is_the_same_in_both_tones(filled: Brain) -> None:
    cheeky = filled.cheeky("find", "zzz", "--json")
    assert cheeky == filled.run("find", "zzz", "--json")
    assert json.loads(cheeky.out)["hits"] == []


def test_exit_codes_do_not_depend_on_the_tone(synced: Synced) -> None:
    hook = synced.remote / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)
    result = synced.brain.cheeky("write", "notes/fresh.md", "--expected", "new", stdin=md())
    assert result.code == 3
    assert result.out == "Write status: saved; sync: failed\nChanged: notes/fresh.md\n"
