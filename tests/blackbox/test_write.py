"""`write`: one file from Markdown on stdin. Revisions, append, dry runs, file mode and input limits."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from .conftest import Brain, Result, Synced, md, rev_of, run

SAVED = "Write status: saved; sync: ok\n"


def current_rev(brain: Brain, path: str, *args: str) -> str:
    return rev_of(brain.run("read", path, *args).out, path)


def write_new(brain: Brain, path: str, content: str, *args: str) -> Result:
    return brain.run("write", path, "--expected", "new", *args, stdin=content)


def test_write_creates_a_new_file_and_reports_it(repo: Brain) -> None:
    result = write_new(repo, "notes/fresh.md", md())
    assert result.code == 0
    assert result.out == SAVED + "Changed: notes/fresh.md\n"
    assert result.err == ""
    assert repo.exists("notes/fresh.md")


def test_write_completes_missing_frontmatter(repo: Brain) -> None:
    write_new(repo, "notes/fresh.md", md(fields="aliases: [fresh]\n"))
    text = repo.read("notes/fresh.md")
    frontmatter, _, body = text.removeprefix("---\n").partition("\n---\n")
    fields = dict(line.split(": ", 1) for line in frontmatter.splitlines())
    assert set(fields) == {"key_fact", "aliases", "updated", "status", "period", "entities", "summary"}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", fields["updated"])
    assert fields["status"] == "active"
    assert fields["summary"] == fields["key_fact"] == "A fact."
    assert fields["aliases"] == "[fresh]"
    assert fields["period"] == fields["entities"] == "[]"
    assert body == "\n# T\n\nBody\n"


def test_write_keeps_a_given_updated_date(repo: Brain) -> None:
    write_new(repo, "notes/dated.md", md(fields="updated: 2025-01-02\n"))
    assert "updated: 2025-01-02\n" in repo.read("notes/dated.md")


def test_summary_is_shortened_from_a_long_key_fact(repo: Brain) -> None:
    long_fact = "word " * 80
    write_new(repo, "notes/long.md", f"---\nkey_fact: {long_fact}\n---\n\n# T\n\nBody\n")
    summary = next(line for line in repo.read("notes/long.md").splitlines() if line.startswith("summary: "))
    assert len(summary) - len("summary: ") <= 160
    assert summary.endswith("…")


def test_new_files_get_mode_0600(repo: Brain) -> None:
    write_new(repo, "notes/private-mode.md", md())
    assert repo.mode("notes/private-mode.md") == 0o600


def test_new_files_in_new_folders_work_and_get_mode_0600(repo: Brain) -> None:
    package = {"changes": [
        {"path": "topics/fresh/README.md", "expected": None, "content": md(fields="scope: work\n")},
        {"path": "topics/fresh/page.md", "expected": None, "content": md()}]}
    assert repo.run("ingest", "--input", "-", stdin=json.dumps(package)).code == 0
    assert repo.mode("topics/fresh/page.md") == 0o600


def test_existing_file_mode_is_kept_on_change(repo: Brain) -> None:
    (repo.root / "notes/first.md").chmod(0o640)
    assert repo.run("write", "notes/first.md", "--expected", current_rev(repo, "notes/first.md"), "--append",
                    stdin="more\n").code == 0
    assert repo.mode("notes/first.md") == 0o640


def test_write_commits_and_pushes_to_the_remote(synced: Synced) -> None:
    write_new(synced.brain, "notes/fresh.md", md())
    assert synced.remote_log()[0] == "Update notes"
    assert "# T" in synced.remote_file("notes/fresh.md")
    assert synced.brain.git("status", "--porcelain") == ""


def test_write_uses_the_configured_commit_message(synced: Synced) -> None:
    synced.brain.repo_option('commit_message = "Remember things"')
    write_new(synced.brain, "notes/fresh.md", md())
    assert synced.brain.git("log", "-1", "--format=%s") == "Remember things"


def test_auto_push_false_commits_locally_and_leaves_the_remote_alone(synced: Synced) -> None:
    synced.brain.repo_option("auto_push = false")
    result = write_new(synced.brain, "notes/fresh.md", md())
    assert result.code == 0
    assert synced.brain.git("log", "-1", "--format=%s") == "Update notes"
    assert synced.remote_log() == ["Initial"]


def test_write_to_an_existing_file_with_expected_new_is_a_conflict_with_the_current_rev(repo: Brain) -> None:
    result = write_new(repo, "notes/first.md", md())
    assert result.code == 2
    assert result.out == ""
    rev = current_rev(repo, "notes/first.md")
    assert result.err == f"A file changed since you read it (current rev={rev}). Read it again, then retry.\n"


def test_stale_revision_is_rejected_with_the_current_rev_and_changes_nothing(repo: Brain) -> None:
    before = repo.read("notes/first.md")
    result = repo.run("write", "notes/first.md", "--expected", "0123456789ab", stdin=md())
    assert result.code == 2
    assert f"current rev={current_rev(repo, 'notes/first.md')}" in result.err
    assert repo.read("notes/first.md") == before


def test_correct_revision_replaces_the_file(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    result = repo.run("write", "notes/first.md", "--expected", rev, stdin=md("Replaced body"))
    assert result.code == 0
    assert "Replaced body" in repo.read("notes/first.md")


def test_full_length_revision_is_accepted(repo: Brain) -> None:
    full = json.loads(repo.run("read", "notes/first.md", "--json").out)["hits"][0]["revision"]
    assert repo.run("write", "notes/first.md", "--expected", full, stdin=md("Full rev")).code == 0


def test_rewriting_changes_the_updated_date_only_when_content_changes(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    repo.run("write", "notes/first.md", "--expected", rev, stdin=repo.read("notes/first.md"))
    assert "updated: 2026-10-01\n" in repo.read("notes/first.md")
    repo.run("write", "notes/first.md", "--expected", rev, stdin=md("Different"))
    assert "updated: 2026-10-01\n" not in repo.read("notes/first.md")


@pytest.mark.parametrize("expected", ["abc", "xyz123456789", "0123456789a", "NEW"])
def test_malformed_expected_value_exits_2(repo: Brain, expected: str) -> None:
    result = repo.run("write", "notes/fresh.md", "--expected", expected, stdin=md())
    assert result.code == 2
    assert result.err == "expected must be null for new files or a revision (at least 12 hex characters of rev).\n"
    assert not repo.exists("notes/fresh.md")


def test_expected_revision_for_a_missing_file_exits_2(repo: Brain) -> None:
    result = repo.run("write", "notes/absent.md", "--expected", "0123456789ab", stdin=md())
    assert result.code == 2
    assert result.err == "An expected file is missing. Check the current state.\n"


def test_write_requires_the_expected_option(repo: Brain) -> None:
    result = repo.run("write", "notes/fresh.md", stdin=md())
    assert result.code == 2
    assert "--expected" in result.err


# --- append ---------------------------------------------------------------------------------------------------------


def test_append_adds_the_text_after_a_blank_line(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    result = repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="## More\n- item\n")
    assert result.code == 0
    assert repo.read("notes/first.md").endswith("Proven content.\n\n## More\n- item\n")


def test_append_refreshes_the_updated_date(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="more\n")
    assert "updated: 2026-10-01\n" not in repo.read("notes/first.md")


def test_repeating_an_append_with_the_same_revision_changes_nothing(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="## More\n- item\n")
    after_first = repo.read("notes/first.md")
    result = repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="## More\n- item\n")
    assert result.code == 0
    assert result.out == SAVED + "Unchanged: notes/first.md\n"
    assert repo.read("notes/first.md") == after_first


def test_a_different_append_with_a_stale_revision_is_rejected(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="one\n")
    result = repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="two\n")
    assert result.code == 2
    assert "current rev=" in result.err


def test_append_to_a_missing_file_exits_2(repo: Brain) -> None:
    result = repo.run("write", "notes/absent.md", "--expected", "new", "--append", stdin="text\n")
    assert result.code == 2
    assert result.err == "append needs an existing file and non-empty text.\n"


def test_append_of_empty_text_exits_2(repo: Brain) -> None:
    rev = current_rev(repo, "notes/first.md")
    result = repo.run("write", "notes/first.md", "--expected", rev, "--append", stdin="  \n")
    assert result.code == 2
    assert result.err == "append needs an existing file and non-empty text.\n"


# --- dry run, json, input ---------------------------------------------------------------------------------------


def test_dry_run_writes_nothing_and_commits_nothing(synced: Synced) -> None:
    head = synced.brain.git("rev-parse", "HEAD")
    result = write_new(synced.brain, "notes/fresh.md", md(), "--dry-run")
    assert result.code == 0
    assert result.out == "Write status: preview; sync: not-run\nChanged: notes/fresh.md\n"
    assert not synced.brain.exists("notes/fresh.md")
    assert synced.brain.git("rev-parse", "HEAD") == head
    assert synced.remote_log() == ["Initial"]


def test_dry_run_still_validates(repo: Brain) -> None:
    result = write_new(repo, "notes/Bad_Name.md", md(), "--dry-run")
    assert result.code == 2
    assert not repo.exists("notes/Bad_Name.md")


def test_dry_run_works_on_a_dirty_tree(repo: Brain) -> None:
    repo.write("notes/uncommitted.md", md())
    assert write_new(repo, "notes/fresh.md", md(), "--dry-run").code == 0


def test_write_json_has_the_result_keys(repo: Brain) -> None:
    result = write_new(repo, "notes/fresh.md", md(), "--json")
    assert result.code == 0
    data = json.loads(result.out)
    assert list(data) == ["changed", "unchanged", "revisions", "issues", "saved", "sync"]
    assert data["changed"] == ["notes/fresh.md"]
    assert data["unchanged"] == []
    assert data["issues"] == []
    assert data["saved"] is True
    assert data["sync"] == "ok"


def test_write_json_revision_matches_a_later_read(repo: Brain) -> None:
    data = json.loads(write_new(repo, "notes/fresh.md", md(), "--json").out)
    read = json.loads(repo.run("read", "notes/fresh.md", "--json").out)["hits"][0]["revision"]
    assert data["revisions"] == {"notes/fresh.md": read}


def test_dry_run_json_reports_preview(repo: Brain) -> None:
    data = json.loads(write_new(repo, "notes/fresh.md", md(), "--dry-run", "--json").out)
    assert (data["saved"], data["sync"]) == (False, "not-run")


def test_write_reads_markdown_from_a_file_with_input(repo: Brain, tmp_path: Path) -> None:
    source = tmp_path / "draft.md"
    source.write_text(md("From a file"), encoding="utf-8")
    result = repo.run("write", "notes/fresh.md", "--expected", "new", "--input", str(source))
    assert result.code == 0
    assert "From a file" in repo.read("notes/fresh.md")


def test_unreadable_input_file_exits_2(repo: Brain, tmp_path: Path) -> None:
    result = repo.run("write", "notes/fresh.md", "--expected", "new", "--input", str(tmp_path / "absent.md"))
    assert result.code == 2
    assert result.err == "The input is not readable.\n"


def test_input_larger_than_max_input_chars_exits_2_and_writes_nothing(synced: Synced) -> None:
    synced.brain.configure("[limits]\nmax_input_chars = 100\n")
    synced.brain.commit("config")
    result = write_new(synced.brain, "notes/fresh.md", md("x" * 500))
    assert result.code == 2
    assert result.err == "The write package is too large.\n"
    assert not synced.brain.exists("notes/fresh.md")


def test_input_at_the_limit_is_accepted(synced: Synced) -> None:
    content = md("y")
    synced.brain.configure(f"[limits]\nmax_input_chars = {len(content)}\n")
    synced.brain.commit("config")
    assert write_new(synced.brain, "notes/fresh.md", content).code == 0


# --- rejected input leaves everything alone --------------------------------------------------------------------


@pytest.mark.parametrize("content", ["no heading, no frontmatter\n", "---\nkey_fact: x\n---\n\nno heading\n"])
def test_content_without_heading_or_key_fact_is_rejected(repo: Brain, content: str) -> None:
    head = repo.git("rev-parse", "HEAD")
    result = write_new(repo, "notes/fresh.md", content)
    assert result.code == 2
    assert result.err.startswith("The write package breaks the rules:")
    assert not repo.exists("notes/fresh.md")
    assert repo.git("rev-parse", "HEAD") == head


def test_missing_key_fact_is_named_in_the_error(repo: Brain) -> None:
    result = write_new(repo, "notes/fresh.md", "# T\n\nBody\n")
    assert "key_fact" in result.err.splitlines()[0]
    assert "- notes/fresh.md: key_fact is missing or has no valid text." in result.err


def test_todo_placeholder_does_not_count_as_a_key_fact(repo: Brain) -> None:
    result = write_new(repo, "notes/fresh.md", md().replace("A fact.", "TODO"))
    assert result.code == 2


def test_write_without_git_repository_exits_2(brain: Brain) -> None:
    result = run("write", "notes/fresh.md", "--expected", "new", "--serious", cwd=brain.root, stdin=md())
    assert result.code == 2
    assert result.err.startswith("Git step failed")
    assert not brain.exists("notes/fresh.md")


def test_write_refuses_a_dirty_tree_until_sync_ran(repo: Brain) -> None:
    repo.write("notes/by-hand.md", md())
    result = write_new(repo, "notes/fresh.md", md())
    assert result.code == 2
    assert result.err == "The brain has uncommitted note changes. Run `dummkopf sync` first.\n"
    assert repo.run("sync").code == 0
    assert write_new(repo, "notes/fresh.md", md()).code == 0
