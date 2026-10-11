"""Disclosure paths: write checks, link checks and hook output answer a hidden path like a missing one."""

from __future__ import annotations

import pytest

from .conftest import Brain, ingest, md, new

DENIED = "Path unavailable or access excluded.\n"
TOPIC_UNAVAILABLE = ("This topic is unavailable to this call, or it is new and needs a README.md "
                     "with a scope in the same package.\n")
WORK = ("--scope", "work", "--dry-run")
FILLER = ("---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\naliases: []\nperiod: []\n"
          "entities: []\n---\n")


@pytest.fixture
def private(repo: Brain) -> Brain:
    repo.write("topics/private/README.md", "---\nscope: private\n---\n\n# Private\n")
    repo.commit("private topic")
    return repo


# --- a new file over a hidden one: the documented "path is free" signal -------------------------------------


def test_new_file_over_a_hidden_note_in_a_hidden_topic_says_the_path_is_taken(private: Brain) -> None:
    """README: writers learn whether a path is free. A taken path answers path_denied, a free one in a
    hidden topic answers like a missing topic. Pinned here so a change to the signal is deliberate."""
    entry = new("topics/private/sub/hidden.md")
    assert ingest(private, entry, args=WORK).err == TOPIC_UNAVAILABLE
    private.write("topics/private/sub/hidden.md", md())
    assert ingest(private, entry, args=WORK).err == DENIED


# --- a new README above hidden notes -------------------------------------------------------------------------


def test_readme_in_a_hidden_folder_answers_like_a_missing_topic_with_or_without_notes_below(
        private: Brain) -> None:
    readme = new("topics/private/sub/README.md", md(fields="scope: work\n"))
    empty = ingest(private, readme, args=WORK)
    private.write("topics/private/sub/hidden.md", md())
    filled = ingest(private, readme, args=WORK)
    assert (empty.code, empty.err) == (2, TOPIC_UNAVAILABLE)
    assert (filled.code, filled.err) == (2, TOPIC_UNAVAILABLE)


def test_readme_in_a_visible_folder_still_may_not_shift_a_scope(private: Brain) -> None:
    private.write("topics/job/README.md", "---\nscope: work\n---\n\n# Job\n")
    private.write("topics/job/sub/a.md", md())
    result = ingest(private, new("topics/job/sub/README.md", md(fields="scope: private\n")),
                    args=("--dry-run",))
    assert result.err == "Changing a scope needs a separate review.\n"


def test_new_topic_readme_still_works(private: Brain) -> None:
    result = ingest(private, new("topics/fresh/README.md", md(fields="scope: work\n")), args=WORK)
    assert result.code == 0


# --- links to non-Markdown files -----------------------------------------------------------------------------


def link_error(brain: Brain) -> str:
    result = ingest(brain, new("notes/linker.md", md("[t](secret.png)")), args=WORK)
    assert result.code == 2
    return result.err


def test_link_to_a_listed_file_answers_like_a_link_to_a_missing_file(repo: Brain) -> None:
    missing = link_error(repo)
    repo.write(".sensitive-paths", "# generated\nnotes/secret.png\n")
    (repo.root / "notes" / "secret.png").write_bytes(b"\x89PNG")
    assert link_error(repo) == missing
    assert "link-unavailable" in missing


def test_link_to_a_file_in_a_hidden_folder_answers_like_a_missing_file(private: Brain) -> None:
    result = ingest(private, new("notes/linker.md", md("[t](../topics/private/secret.png)")), args=WORK)
    private.write("topics/private/secret.png", "png")
    hidden = ingest(private, new("notes/linker.md", md("[t](../topics/private/secret.png)")), args=WORK)
    assert (hidden.code, hidden.err) == (result.code, result.err)


def test_link_to_a_visible_non_markdown_file_is_accepted(repo: Brain) -> None:
    (repo.root / "notes" / "photo.png").write_bytes(b"\x89PNG")
    assert ingest(repo, new("notes/linker.md", md("[t](photo.png)")), args=WORK).code == 0


# --- pre-commit hook output ----------------------------------------------------------------------------------


def test_pre_commit_does_not_name_a_sensitive_file_with_unstaged_edits(brain: Brain) -> None:
    brain.git_init()
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    brain.write("topics/divorce/README.md", FILLER + "\n# Divorce\n\n> SENSITIVE\n")
    brain.write("topics/job/README.md", FILLER + "\n# Job\n")
    brain.commit("start")
    brain.write("topics/divorce/README.md", FILLER + "\n# Divorce\n\n> SENSITIVE\n\nEdited by hand.\n")
    brain.write("topics/divorce/lawyer.md", FILLER + "\n# Lawyer\n")
    brain.write("topics/job/README.md", FILLER + "\n# Job\n\nEdited by hand.\n")
    brain.write("topics/job/plan.md", FILLER + "\n# Plan\n")
    result = brain.run("hook", "pre-commit")
    assert result.code == 0
    assert "divorce" not in result.out + result.err
    assert "Sensitive files with unstaged edits: 1." in result.out
    assert "topics/job/README.md has unstaged edits" in result.out
