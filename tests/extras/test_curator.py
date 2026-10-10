from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
from conftest import Brain, invoke

from dummkopf.extras.curator import prompt, render_markdown, scan


def ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


@pytest.fixture
def repo(brain: Brain) -> Brain:
    brain.git_init()
    return brain


@pytest.fixture
def hub(german: Brain) -> Brain:
    german.git_init()
    return german


def run(brain: Brain, days_ago: int = 0, **options: int) -> dict[str, Any]:
    brain.commit("init", date=ago(days_ago) + "T12:00:00")
    return dict(scan(brain.config, **options))


def paths(data: dict[str, Any], key: str) -> list[str]:
    return [entry["path"] for entry in data[key]]


def test_open_loop_flagged_only_when_old(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", "This question is not yet answered.\n")
    assert "topics/foo/bar.md" in paths(run(repo, 40, open_days=28), "open_loops")


def test_open_loop_not_flagged_when_recent(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", "This question is not yet answered.\n")
    assert "topics/foo/bar.md" not in paths(run(repo, 5, open_days=28), "open_loops")


def test_german_open_words_and_word_boundary(hub: Brain) -> None:
    hub.write("topics/foo/offen.md", "Diese Frage ist noch offen.\n")
    hub.write("topics/foo/bar.md", "Das war eine Zeit der Offenheit. Hoffentlich bleibt das so.\n")
    found = paths(run(hub, 40, open_days=28), "open_loops")
    assert "topics/foo/offen.md" in found
    assert "topics/foo/bar.md" not in found


def test_open_loop_shows_up_to_three_short_lines(hub: Brain) -> None:
    long = "x" * 200
    hub.write("topics/foo/bar.md", f"Zeile1 offen {long}\nZeile2 prüfen\nZeile3 TODO\nZeile4 noch nicht fertig\n")
    entry = next(e for e in run(hub, 40, open_days=28)["open_loops"] if e["path"] == "topics/foo/bar.md")
    assert len(entry["lines"]) <= 3
    assert all(len(line) <= 120 for line in entry["lines"])


def test_stale_topic(repo: Brain) -> None:
    repo.write("topics/bar/README.md", "# Bar\n")
    assert "topics/bar/" in paths(run(repo, 70, stale_days=56), "stale_topics")


def test_recent_topic_not_stale(repo: Brain) -> None:
    repo.write("topics/bar/README.md", "# Bar\n")
    assert "topics/bar/" not in paths(run(repo, 5, stale_days=56), "stale_topics")


def test_frontmatter_date_beats_recent_commit(repo: Brain) -> None:
    old = ago(90)
    repo.write("topics/foo/bar.md", f"---\nupdated: {old}\n---\n\nStill TBD.\n")
    data = run(repo, 0, open_days=28)
    entry = next(e for e in data["open_loops"] if e["path"] == "topics/foo/bar.md")
    assert entry["updated"] == old


def test_recent_frontmatter_date_beats_old_commit(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", f"---\nupdated: {ago(0)}\n---\n\nStill TBD.\n")
    assert "topics/foo/bar.md" not in paths(run(repo, 90, open_days=28), "open_loops")


def test_git_date_fallback_without_frontmatter(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", "No frontmatter, still TBD.\n")
    entry = next(e for e in run(repo, 40, open_days=28)["open_loops"] if e["path"] == "topics/foo/bar.md")
    assert len(entry["updated"]) == 10


def test_stale_topic_uses_frontmatter_and_any_recent_file(repo: Brain) -> None:
    repo.write("topics/bar/README.md", f"---\nupdated: {ago(90)}\n---\n\n# Bar\n")
    assert "topics/bar/" in paths(run(repo, 0, stale_days=56), "stale_topics")
    repo.write("topics/bar/new.md", f"---\nupdated: {ago(0)}\n---\n\nNew.\n")
    assert "topics/bar/" not in paths(run(repo, 0, stale_days=56), "stale_topics")


def test_conflicting_dates(hub: Brain, repo: Brain) -> None:
    hub.write("topics/foo/bar.md", "Stand: 06.08.2026\n\nSpäter: Stand 2026-09-25\n")
    hub.write("topics/foo/one.md", "Stand: 06.08.2026\n")
    data = run(hub)
    entry = next(e for e in data["conflicting_dates"] if e["path"] == "topics/foo/bar.md")
    assert set(entry["dates"]) == {"06.08.2026", "2026-09-25"}
    assert "topics/foo/one.md" not in paths(data, "conflicting_dates")
    repo.write("topics/foo/bar.md", "As of 2026-08-06.\n\nUpdated: 2026-09-25\n")
    assert "topics/foo/bar.md" in paths(run(repo), "conflicting_dates")


def test_stale_active_notes(hub: Brain) -> None:
    hub.write("topics/foo/old.md", f"---\nstatus: aktiv\nstand: {ago(90)}\n---\n\n# Foo\n")
    hub.write("topics/foo/new.md", f"---\nstatus: aktiv\nstand: {ago(0)}\n---\n\n# Foo\n")
    hub.write("topics/foo/plain.md", "No frontmatter.\n")
    found = paths(run(hub, stale_days=56), "stale_active")
    assert found == ["topics/foo/old.md"]


def test_sensitive_folder_and_paths_file_excluded(repo: Brain) -> None:
    repo.write("topics/hidden/README.md", "> SENSITIVE\n\n# Hidden\n")
    repo.write("topics/hidden/note.md", "Not yet done.\n")
    repo.write("topics/listed/note.md", "Not yet done.\n")
    repo.write("topics/public/note.md", "Not yet done.\n")
    repo.write(".sensitive-paths", "topics/listed/\n")
    data = run(repo, 40, open_days=28)
    assert paths(data, "open_loops") == ["topics/public/note.md"]
    assert data["sensitive_files"] >= 3 and data["sensitive_topics"] >= 2


def test_open_words_in_frontmatter_are_ignored(hub: Brain) -> None:
    hub.write("notes/a.md", '---\nstand: 2026-01-01\nkernfakt: "Kandidat ungeprüft"\n---\n\nNur Fließtext.\n')
    hub.write("notes/b.md", "---\nstand: 2026-01-01\n---\n\nDas ist noch offen.\n")
    found = paths(run(hub, 200, open_days=28), "open_loops")
    assert "notes/a.md" not in found and "notes/b.md" in found


def test_markdown_has_closing_count_line(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", "Nothing special.\n")
    repo.commit("init")
    text = render_markdown(scan(repo.config))
    assert "sensitive files and" in text and "sensitive topics skipped" in text


def test_prompt_uses_config_values(hub: Brain) -> None:
    text = prompt(hub.config)
    assert "topics/hub/kurator/" in text
    assert "kernfakt" in text and "KANTEN.md" in text
    assert "> SENSIBEL" in text


def test_cli(repo: Brain) -> None:
    repo.write("topics/foo/bar.md", "x\n")
    repo.commit()
    assert invoke(repo, "curator")[0] == 0
    code, output, _ = invoke(repo, "curator", "--prompt")
    assert code == 0 and "Curator" in output
    repo.configure("[extras]\ncurator = false\n")
    assert invoke(repo, "curator")[0] == 2
