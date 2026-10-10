"""`meta`: generate, index, report, migrate and agents."""

from __future__ import annotations

import datetime as dt
import re

import pytest

from .conftest import Brain

INDEX = "# Index\n\nProse stays.\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n"


def fm(title: str, extra: str = "", updated: str = "2026-10-01", key_fact: str = "K fact.") -> str:
    return (f"---\nupdated: {updated}\nstatus: active\nkey_fact: {key_fact}\nsummary: {key_fact}\n"
            f"aliases: [a1, a2]\nperiod: []\nentities: []\n{extra}---\n\n# {title}\n\nbody\n")


@pytest.fixture
def indexed(brain: Brain) -> Brain:
    brain.write("INDEX.md", INDEX)
    return brain


def table_rows(text: str, heading: str) -> list[str]:
    section = text.split(heading + "\n", 1)[1].split("\n## ", 1)[0]
    return [line for line in section.splitlines() if line.startswith("| `")]


# --- generate -----------------------------------------------------------------------------------------------


def test_generate_fills_the_index_tables_and_keeps_the_prose(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    indexed.write("notes/n.md", fm("N"))
    indexed.write("bookmarks/b.md", fm("B"))
    result = indexed.run("meta", "generate")
    assert result.code == 0
    text = indexed.read("INDEX.md")
    assert text.startswith("# Index\n\nProse stays.\n\n## Topics\n")
    assert table_rows(text, "## Topics") == ["| `topics/job/` | K fact. | a1, a2 |"]
    assert table_rows(text, "## Notes (flat)") == ["| `notes/n.md` | K fact. | a1, a2 |"]
    assert table_rows(text, "## Bookmarks") == ["| `bookmarks/b.md` | K fact. | a1, a2 |"]


def test_generate_writes_english_column_headers_by_default(indexed: Brain) -> None:
    indexed.run("meta", "generate")
    text = indexed.read("INDEX.md")
    assert "| Folder | About | Aliases |\n|---|---|---|" in text
    assert text.count("| File | Key fact | Aliases |\n|---|---|---|") == 2


def test_generate_prints_changed_paths_on_stdout_and_the_count_on_stderr(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    result = indexed.run("meta", "generate")
    assert result.out == "topics/job/README.md\nINDEX.md\n"
    assert result.err == "2 file(s) updated.\n"


def test_generate_twice_changes_nothing_the_second_time(indexed: Brain) -> None:
    indexed.write("notes/n.md", fm("N"))
    indexed.run("meta", "generate")
    again = indexed.run("meta", "generate")
    assert (again.code, again.out, again.err) == (0, "", "0 file(s) updated.\n")


def test_generate_dry_run_lists_changes_and_writes_nothing(indexed: Brain) -> None:
    indexed.write("notes/n.md", fm("N"))
    result = indexed.run("meta", "generate", "--dry-run")
    assert result.out == "INDEX.md\n"
    assert indexed.read("INDEX.md") == INDEX


def test_generate_leaves_sensitive_and_archived_folders_out(indexed: Brain) -> None:
    indexed.write("notes/open.md", fm("Open"))
    indexed.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"))
    indexed.write("topics/med/README.md", fm("Med", "scope: private\n").replace("body", "> SENSITIVE"))
    indexed.write("archive/old.md", fm("Old"))
    indexed.run("meta", "generate")
    text = indexed.read("INDEX.md")
    assert table_rows(text, "## Notes (flat)") == ["| `notes/open.md` | K fact. | a1, a2 |"]
    assert table_rows(text, "## Topics") == []
    assert "marked" not in text
    assert "topics/med" not in text
    assert "archive" not in text


def test_generate_leaves_listed_sensitive_paths_out(indexed: Brain) -> None:
    indexed.write("notes/open.md", fm("Open"))
    indexed.write("notes/listed.md", fm("Listed"))
    indexed.write(".sensitive-paths", "notes/listed.md\n")
    indexed.run("meta", "generate")
    assert "listed.md" not in indexed.read("INDEX.md")


def test_generate_sorts_notes_by_updated_date_newest_first(indexed: Brain) -> None:
    indexed.write("notes/a-old.md", fm("Old", updated="2020-01-01"))
    indexed.write("notes/z-new.md", fm("New", updated="2026-10-02"))
    indexed.run("meta", "generate")
    paths = [row.split("`")[1] for row in table_rows(indexed.read("INDEX.md"), "## Notes (flat)")]
    assert paths == ["notes/z-new.md", "notes/a-old.md"]


def test_generate_adds_a_file_table_to_each_topic_readme(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    indexed.write("topics/job/a.md", fm("A"))
    indexed.write("topics/job/deep/b.md", fm("B"))
    indexed.run("meta", "generate")
    readme = indexed.read("topics/job/README.md")
    assert "\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n" in readme
    assert table_rows(readme, "## Files") == ["| `topics/job/a.md` | K fact. | a1, a2 |",
                                              "| `topics/job/deep/b.md` | K fact. | a1, a2 |"]


def test_readme_file_table_lists_only_notes_of_the_readme_scope(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    indexed.write("topics/job/work.md", fm("Work"))
    indexed.write("topics/job/private.md", fm("Private", "scope: private\n"))
    indexed.run("meta", "generate")
    assert table_rows(indexed.read("topics/job/README.md"), "## Files") == [
        "| `topics/job/work.md` | K fact. | a1, a2 |"]


def test_readme_file_table_leaves_sensitive_notes_out(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    indexed.write("topics/job/open.md", fm("Open"))
    indexed.write("topics/job/marked.md", fm("Marked").replace("body", "> SENSITIVE"))
    indexed.run("meta", "generate")
    assert "marked" not in indexed.read("topics/job/README.md")


def test_generate_keeps_the_readme_prose_above_the_table(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n").replace("body", "Hand-written intro."))
    indexed.write("topics/job/a.md", fm("A"))
    indexed.run("meta", "generate")
    assert "# Job\n\nHand-written intro.\n" in indexed.read("topics/job/README.md")


def test_generate_replaces_an_existing_file_table_in_place(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n") + "\n## Files\n\nold intro\n\n"
                  "| File | Key fact | Aliases |\n|---|---|---|\n| `topics/job/gone.md` | stale | |\n")
    indexed.write("topics/job/a.md", fm("A"))
    indexed.run("meta", "generate")
    readme = indexed.read("topics/job/README.md")
    assert "gone.md" not in readme
    assert table_rows(readme, "## Files") == ["| `topics/job/a.md` | K fact. | a1, a2 |"]
    assert readme.count("## Files") == 1


def test_german_locale_writes_german_table_headers_and_files_heading(brain: Brain) -> None:
    brain.configure('[ui]\nlocale = "de"\n')
    brain.write("INDEX.md", INDEX)
    brain.write("topics/job/README.md", fm("Job", "scope: work\n"))
    brain.write("topics/job/a.md", fm("A"))
    brain.write("notes/n.md", fm("N"))
    brain.run("meta", "generate")
    index = brain.read("INDEX.md")
    assert "| Ordner | Worum es geht | Aliase |" in index
    assert "| Datei | Kernfakt | Aliase |" in index
    assert "\n## Dateien\n\n| Datei | Kernfakt | Aliase |\n" in brain.read("topics/job/README.md")


def test_english_locale_does_not_use_german_words(indexed: Brain) -> None:
    indexed.write("topics/job/README.md", fm("Job", "scope: work\n"))
    indexed.run("meta", "generate")
    assert "Dateien" not in indexed.read("topics/job/README.md")
    assert "Ordner" not in indexed.read("INDEX.md")


# --- index -----------------------------------------------------------------------------------------------------


def test_index_regenerates_the_paths_list_and_the_tables(indexed: Brain) -> None:
    indexed.write("notes/open.md", fm("Open"))
    indexed.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"))
    result = indexed.run("meta", "index")
    assert result.code == 0
    assert result.out.splitlines() == [".sensitive-paths", "INDEX.md"]
    assert result.err == "2 file(s) updated.\n"
    assert indexed.read(".sensitive-paths").splitlines()[3:] == ["notes/marked.md"]
    assert indexed.mode(".sensitive-paths") == 0o600


def test_index_lists_folders_with_a_marked_readme_and_always_paths(indexed: Brain) -> None:
    indexed.configure('[sensitive]\nalways = ["topics/health/", "notes/vault.md"]\n')
    indexed.write("topics/med/README.md", fm("Med", "scope: private\n").replace("body", "> SENSITIVE"))
    indexed.write("topics/med/visit.md", fm("Visit"))
    indexed.run("meta", "index")
    assert indexed.read(".sensitive-paths").splitlines()[3:] == ["notes/vault.md", "topics/health/", "topics/med/"]


def test_index_dry_run_changes_nothing(indexed: Brain) -> None:
    indexed.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"))
    indexed.run("meta", "index", "--dry-run")
    assert indexed.read(".sensitive-paths") == "# generated\n"


def test_index_twice_reports_no_changes_the_second_time(indexed: Brain) -> None:
    indexed.run("meta", "index")
    assert indexed.run("meta", "index").err == "0 file(s) updated.\n"


# --- report ----------------------------------------------------------------------------------------------------


def test_report_lists_missing_dates_stale_notes_and_missing_key_facts(brain: Brain) -> None:
    brain.write("notes/bare.md", "# Bare\n\nno frontmatter\n")
    brain.write("notes/old.md", fm("Old", updated="2020-01-01"))
    brain.write("notes/todo.md", fm("Todo", key_fact="TODO"))
    brain.write("notes/fine.md", fm("Fine"))
    result = brain.run("meta", "report")
    assert result.code == 0
    assert result.out == (
        "### Missing `updated` (1)\n- `notes/bare.md`\n\n"
        "### Stale (status active, older than 56 days) (1)\n- `notes/old.md` (updated 2020-01-01)\n\n"
        "### No key fact (`TODO`) (2)\n- `notes/bare.md`\n- `notes/todo.md`\n\n"
        "_0 sensitive file(s) skipped._\n")


def test_report_of_a_clean_brain_shows_empty_sections(brain: Brain) -> None:
    brain.write("notes/fine.md", fm("Fine", updated=dt.date.today().isoformat()))
    out = brain.run("meta", "report").out
    assert "### Missing `updated` (0)" in out
    assert "### Stale (status active, older than 56 days) (0)" in out
    assert "### No key fact (`TODO`) (0)" in out


def test_report_counts_skipped_sensitive_files(brain: Brain) -> None:
    brain.write("notes/marked.md", fm("Marked", key_fact="TODO").replace("body", "> SENSITIVE"))
    out = brain.run("meta", "report").out
    assert "marked" not in out
    assert out.rstrip().endswith("_1 sensitive file(s) skipped._")


def test_report_max_age_changes_the_stale_threshold(brain: Brain) -> None:
    forty_days_ago = (dt.date.today() - dt.timedelta(days=40)).isoformat()
    brain.write("notes/aging.md", fm("Aging", updated=forty_days_ago))
    assert "- `notes/aging.md`" not in brain.run("meta", "report").out
    out = brain.run("meta", "report", "--max-age", "30").out
    assert "### Stale (status active, older than 30 days) (1)" in out
    assert f"- `notes/aging.md` (updated {forty_days_ago})" in out


def test_report_ignores_archived_notes_when_looking_for_stale_ones(brain: Brain) -> None:
    brain.write("notes/shelved.md", fm("Shelved", updated="2020-01-01").replace("status: active", "status: archived"))
    assert "### Stale (status active, older than 56 days) (0)" in brain.run("meta", "report").out


def test_report_scope_hides_notes_of_other_scopes(brain: Brain) -> None:
    brain.write("topics/job/README.md", fm("Job", "scope: work\n"))
    brain.write("topics/job/old.md", fm("Old", updated="2020-01-01"))
    brain.write("topics/home/README.md", fm("Home", "scope: private\n"))
    brain.write("topics/home/old.md", fm("Old", updated="2020-01-01"))
    out = brain.run("meta", "report", "--scope", "work").out
    assert "topics/job/old.md" in out
    assert "topics/home/old.md" not in out


def test_report_rejects_an_unknown_scope(brain: Brain) -> None:
    result = brain.run("meta", "report", "--scope", "nowhere")
    assert result.code == 2
    assert result.err == "Invalid scope. Use one of: both, private, work.\n"


def test_report_headings_stay_english_in_the_german_locale(brain: Brain) -> None:
    brain.configure('[ui]\nlocale = "de"\n')
    brain.write("notes/bare.md", "# Bare\n")
    assert "### Missing `updated` (1)" in brain.run("meta", "report").out


# --- migrate and agents ----------------------------------------------------------------------------------------


def test_migrate_adds_complete_frontmatter_to_a_bare_note(brain: Brain) -> None:
    brain.write("notes/bare.md", "# Bare\n\nno frontmatter\n")
    result = brain.run("meta", "migrate")
    assert result.code == 0
    assert result.out == "notes/bare.md\n"
    assert result.err == "1 file(s) updated.\n"
    text = brain.read("notes/bare.md")
    assert re.match(r"---\nupdated: \d{4}-\d{2}-\d{2}\nstatus: active\nkey_fact: TODO\nsummary: TODO\n"
                    r"aliases: \[\]\nperiod: \[\]\nentities: \[\]\n---\n", text)
    assert text.endswith("# Bare\n\nno frontmatter\n")


def test_migrate_fills_only_the_gaps_of_a_partial_note(brain: Brain) -> None:
    brain.write("notes/partial.md", "---\nupdated: 2025-05-05\nkey_fact: Mine.\n---\n\n# Partial\n")
    brain.run("meta", "migrate")
    text = brain.read("notes/partial.md")
    assert "updated: 2025-05-05\n" in text
    assert "key_fact: Mine.\n" in text
    assert "status: active\n" in text
    assert "aliases: []\n" in text


def test_migrate_dry_run_lists_files_and_writes_nothing(brain: Brain) -> None:
    brain.write("notes/bare.md", "# Bare\n")
    result = brain.run("meta", "migrate", "--dry-run")
    assert result.out == "notes/bare.md\n"
    assert brain.read("notes/bare.md") == "# Bare\n"


def test_migrate_only_limits_the_paths(brain: Brain) -> None:
    brain.write("notes/one.md", "# One\n")
    brain.write("notes/two.md", "# Two\n")
    result = brain.run("meta", "migrate", "--only", "notes/one.md")
    assert result.out == "notes/one.md\n"
    assert brain.read("notes/two.md") == "# Two\n"


def test_migrate_leaves_complete_notes_alone(brain: Brain) -> None:
    brain.write("notes/fine.md", fm("Fine"))
    result = brain.run("meta", "migrate")
    assert (result.out, result.err) == ("", "0 file(s) updated.\n")


def test_agents_prints_the_rules_for_this_brain(brain: Brain) -> None:
    out = brain.run("meta", "agents").out
    assert out.startswith("# Agent rules for this brain\n")
    assert "`> SENSITIVE`" in out
    assert "`private`, `work`" in out


def test_unknown_meta_action_exits_2(brain: Brain) -> None:
    result = brain.run("meta", "bogus")
    assert result.code == 2
    assert "invalid choice: 'bogus'" in result.err
