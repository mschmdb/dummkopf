from __future__ import annotations

import datetime as dt

import pytest
from conftest import Brain

from dummkopf import meta
from dummkopf.frontmatter import parse_frontmatter
from dummkopf.tables import scrape_rows, split_row

TODAY = dt.date.today().isoformat()
FIELDS = "status: active\nkey_fact: {fact}\nsummary: {fact}\naliases: [{alias}]\nperiod: []\nentities: []\n"
BASE_INDEX = (
    "# Brain index\n\nProse on top.\n\n## Topics\n\n"
    "| Folder | About | Aliases |\n|---|---|---|\n| `topics/old/` | old | a |\n\n"
    "## Notes (flat)\n\n"
    "| File | Key fact | Aliases |\n|---|---|---|\n| `notes/old.md` | old | a |\n\n"
    "## Bookmarks\n\n"
    "| File | Key fact | Aliases |\n|---|---|---|\n| `bookmarks/old.md` | old | a |\n"
)


@pytest.fixture
def repo(brain: Brain) -> Brain:
    brain.git_init()
    for folder in ("topics", "notes", "bookmarks"):
        (brain.root / folder).mkdir()
    return brain


def full(updated: str, fact: str, alias: str = "", status: str = "active", extra: str = "",
         body: str = "# T\n") -> str:
    fields = FIELDS.format(fact=fact, alias=alias).replace("status: active", "status: " + status)
    return "---\n" + extra + "updated: " + updated + "\n" + fields + "---\n\n" + body


def test_split_row_escaped_pipe() -> None:
    assert split_row(r"| `a/b.md` | x \| y | e1, e2 |") == ["`a/b.md`", "x | y", "e1, e2"]


def test_scrape_rows() -> None:
    rows = scrape_rows("| File | Key fact | Aliases |\n|---|---|---|\n| `notes/a.md` | Fact A | al1, al2 |\n"
                       "| `topics/t/` | Topic T | tt |\n")
    assert rows["notes/a.md"] == ("Fact A", ["al1", "al2"])
    assert rows["topics/t/"] == ("Topic T", ["tt"])
    assert scrape_rows("|---|---|---|\n| File | Key fact | Aliases |\n") == {}


def test_migrate_creates_frontmatter(repo: Brain) -> None:
    repo.write("notes/a.md", "# A\n\nText\n")
    repo.commit(date="2026-03-04T09:00:00")
    meta.migrate(repo.config)
    data, body, had = parse_frontmatter(repo.read("notes/a.md"))
    assert had
    assert data["updated"] == "2026-03-04"
    assert data["status"] == "active"
    assert data["key_fact"] == "TODO"
    assert data["aliases"] == data["period"] == data["entities"] == []
    assert "# A" in body and "Text" in body


def test_migrate_keeps_scope_and_order(repo: Brain) -> None:
    repo.write("notes/a.md", "---\nscope: private\n---\n\n# A\n")
    repo.commit()
    meta.migrate(repo.config)
    data, _, _ = parse_frontmatter(repo.read("notes/a.md"))
    assert data["scope"] == "private"
    assert list(data)[0] == "scope"


def test_migrate_falls_back_to_today_without_commit(repo: Brain) -> None:
    repo.write("notes/new.md", "# New\n")
    meta.migrate(repo.config)
    assert parse_frontmatter(repo.read("notes/new.md"))[0]["updated"] == TODAY


def test_migrate_archive_status_from_path(repo: Brain) -> None:
    repo.write("topics/t/archive-research.md", "# X\n")
    repo.write("topics/t/archive/old.md", "# X\n")
    repo.write("topics/t/normal.md", "# Y\n")
    repo.commit()
    meta.migrate(repo.config)
    for rel, status in (("topics/t/archive-research.md", "archived"), ("topics/t/archive/old.md", "archived"),
                        ("topics/t/normal.md", "active")):
        assert parse_frontmatter(repo.read(rel))[0]["status"] == status


def test_migrate_seeds_from_folder_readme(repo: Brain) -> None:
    repo.write("topics/t/README.md", "# T\n\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n"
               "| `topics/t/a.md` | Fact A | al1, al2 |\n")
    repo.write("topics/t/a.md", "# A\n")
    repo.write("INDEX.md", BASE_INDEX)
    repo.commit()
    meta.migrate(repo.config)
    data = parse_frontmatter(repo.read("topics/t/a.md"))[0]
    assert data["key_fact"] == "Fact A"
    assert data["aliases"] == ["al1", "al2"]


def test_migrate_seeds_topic_readme_from_index(repo: Brain) -> None:
    repo.write("INDEX.md", "# Index\n\n## Topics\n\n| Folder | About | Aliases |\n|---|---|---|\n"
               "| `topics/t/` | What T is about | tt, tee |\n")
    repo.write("topics/t/README.md", "---\nscope: work\n---\n\n# T\n")
    repo.commit()
    meta.migrate(repo.config)
    data = parse_frontmatter(repo.read("topics/t/README.md"))[0]
    assert data["key_fact"] == "What T is about"
    assert data["aliases"] == ["tt", "tee"]
    assert data["scope"] == "work"


def test_migrate_shortens_summary(repo: Brain) -> None:
    long = ("verylongword " * 20).strip()
    repo.write("topics/t/README.md", "## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n"
               "| `topics/t/a.md` | " + long + " | x |\n")
    repo.write("topics/t/a.md", "# A\n")
    repo.commit()
    meta.migrate(repo.config)
    data = parse_frontmatter(repo.read("topics/t/a.md"))[0]
    assert data["key_fact"] == long
    assert len(str(data["summary"])) <= 160 and str(data["summary"]).endswith("…")


def test_migrate_is_idempotent_dry_run_and_only(repo: Brain) -> None:
    repo.write("notes/a.md", "# A\n")
    repo.write("notes/b.md", "# B\n")
    repo.commit()
    assert meta.migrate(repo.config, dry_run=True) == ["notes/a.md", "notes/b.md"]
    assert repo.read("notes/a.md") == "# A\n"
    assert meta.migrate(repo.config, only=["notes/a.md"]) == ["notes/a.md"]
    assert not repo.read("notes/b.md").startswith("---")
    first = repo.read("notes/a.md")
    assert meta.migrate(repo.config, only=["notes/a.md"]) == []
    assert repo.read("notes/a.md") == first


def test_migrate_keeps_body_unchanged(repo: Brain) -> None:
    body = "# A\n\n> SENSITIVE\n\nSecret.\n"
    repo.write("notes/a.md", body)
    repo.commit()
    meta.migrate(repo.config)
    assert parse_frontmatter(repo.read("notes/a.md"))[1].lstrip("\n") == body


def seed_skill(repo: Brain) -> None:
    repo.write("topics/t/tool/SKILL.md", "---\nname: tool\ndescription: A skill.\n---\n\n# tool\n")
    repo.write("topics/t/tool/references/api.md", "# API\n")
    repo.write("topics/t/normal.md", "# Normal\n")
    repo.write("topics/t/README.md", "# T\n\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n")
    repo.commit()


def test_skill_folders_are_never_touched(repo: Brain) -> None:
    seed_skill(repo)
    before = {rel: repo.read(rel) for rel in ("topics/t/tool/SKILL.md", "topics/t/tool/references/api.md")}
    changed = meta.migrate(repo.config)
    assert not set(before) & set(changed)
    for rel, text in before.items():
        assert repo.read(rel) == text
    meta.generate(repo.config)
    readme = repo.read("topics/t/README.md")
    assert "| `topics/t/normal.md` |" in readme
    assert "SKILL.md" not in readme and "references/api.md" not in readme
    report = meta.report(repo.config)
    assert "SKILL.md" not in report and "api.md" not in report


def test_prose_mentioning_a_skill_folder_stays(repo: Brain) -> None:
    seed_skill(repo)
    path = repo.root / "topics/t/README.md"
    path.write_text(path.read_text() + "\nSource: `topics/t/tool/` stays mentioned.\n")
    meta.migrate(repo.config)
    meta.generate(repo.config)
    assert "Source: `topics/t/tool/` stays mentioned." in repo.read("topics/t/README.md")


def test_topic_with_skill_md_is_not_a_topic(repo: Brain) -> None:
    repo.write("topics/skillonly/SKILL.md", "---\nname: x\n---\n\n# X\n")
    repo.write("topics/skillonly/README.md", "# X\n")
    assert "skillonly" not in meta.topic_dirs(repo.config)


def seed_brain(repo: Brain) -> None:
    repo.write("INDEX.md", BASE_INDEX)
    repo.write("topics/t/README.md",
               full("2026-05-01", '"Topic T, long"', "tt", extra="scope: work\n",
                    body="# T\n\nProse.\n\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n"
                    "| `topics/t/gone.md` | OLD | x |\n\nAfterword in block.\n\n## Related\n\nLink.\n"))
    repo.write("topics/t/a.md", full("2026-02-01", "Fact A", "al1", body="# A\n"))
    repo.write("topics/t/b.md", full("2026-09-01", "Fact B", "al2", status="archived", body="# B\n"))
    repo.write("notes/n.md", full("2026-04-01", "Fact N", "aln", body="# N\n"))
    repo.write("bookmarks/bm.md", full("2026-06-01", "Fact BM", "albm", body="# BM\n"))
    repo.commit()


def test_generate_replaces_files_block(repo: Brain) -> None:
    seed_brain(repo)
    meta.generate(repo.config)
    text = repo.read("topics/t/README.md")
    assert "topics/t/gone.md" not in text
    for expected in ("Afterword in block.", "## Files", "| `topics/t/a.md` | Fact A | al1 |",
                     "| `topics/t/b.md` | Fact B | al2 |", "## Related", "Link.", "Prose."):
        assert expected in text
    assert "topics/t/README.md`" not in text
    assert text.index("topics/t/b.md") < text.index("topics/t/a.md"), "newest first"


def test_generate_appends_files_block(repo: Brain) -> None:
    seed_brain(repo)
    path = repo.root / "topics/t/README.md"
    text = path.read_text()
    path.write_text(text[:text.index("## Files")] + "## Related\n\nLink.\n")
    meta.generate(repo.config)
    assert "## Files" in repo.read("topics/t/README.md")
    assert "| `topics/t/a.md` |" in repo.read("topics/t/README.md")


def test_generate_drops_auto_stub(repo: Brain) -> None:
    seed_brain(repo)
    path = repo.root / "topics/t/README.md"
    path.write_text(path.read_text() + "\n---\n\n## Unfiled (auto-stub)\n\n| File | Key fact | Aliases |\n"
                    "|---|---|---|\n| `topics/t/a.md` | TODO | |\n")
    meta.generate(repo.config)
    assert "auto-stub" not in repo.read("topics/t/README.md")
    assert "| TODO |" not in repo.read("topics/t/README.md")


def test_generate_index_tables(repo: Brain) -> None:
    seed_brain(repo)
    meta.generate(repo.config)
    text = repo.read("INDEX.md")
    assert "Prose on top." in text
    assert "topics/old/" not in text and "notes/old.md" not in text
    assert "| `topics/t/` | Topic T, long | tt |" in text
    assert "| `notes/n.md` | Fact N | aln |" in text
    assert "| `bookmarks/bm.md` | Fact BM | albm |" in text


def test_generate_index_status_prefix(repo: Brain) -> None:
    seed_brain(repo)
    path = repo.root / "topics/t/README.md"
    path.write_text(path.read_text().replace("status: active", "status: archived"))
    meta.generate(repo.config)
    assert "| `topics/t/` | [archived] Topic T, long | tt |" in repo.read("INDEX.md")


def test_generate_index_without_sensitive_entries(repo: Brain) -> None:
    seed_brain(repo)
    repo.write("topics/s/README.md", full("2026-01-01", "Hidden", body="# S\n\n> SENSITIVE\n"))
    repo.write("notes/hidden.md", full("2026-01-01", "HiddenN", body="# G\n\n> SENSITIVE\n"))
    repo.configure("[sensitive]\nalways = ['topics/health/']\n")
    repo.write("topics/health/README.md", full("2026-01-01", "Pulse", body="# H\n"))
    meta.generate(repo.config)
    text = repo.read("INDEX.md")
    for absent in ("topics/s/", "notes/hidden.md", "Hidden", "topics/health/", "Pulse"):
        assert absent not in text


def test_generate_is_idempotent_and_dry_run_writes_nothing(repo: Brain) -> None:
    seed_brain(repo)
    before = repo.read("INDEX.md")
    assert "INDEX.md" in meta.generate(repo.config, dry_run=True)
    assert repo.read("INDEX.md") == before
    meta.generate(repo.config)
    snapshot = {rel: repo.read(rel) for rel in ("INDEX.md", "topics/t/README.md")}
    assert meta.generate(repo.config) == []
    assert {rel: repo.read(rel) for rel in snapshot} == snapshot


def test_generate_escapes_pipes(repo: Brain) -> None:
    seed_brain(repo)
    repo.write("notes/p.md", full("2026-07-01", '"a | b"', body="# P\n"))
    meta.generate(repo.config)
    assert r"| `notes/p.md` | a \| b |" in repo.read("INDEX.md")


def test_marked_file_dropped_from_open_topic_readme(repo: Brain) -> None:
    repo.write("INDEX.md", BASE_INDEX)
    files_block = "# Open\n\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n"
    repo.write("topics/open/README.md", full("2026-05-01", "Open", "o", extra="scope: work\n", body=files_block))
    repo.write("topics/open/normal.md", full("2026-01-01", "K", "a"))
    repo.write("topics/open/hidden.md", full("2026-01-01", "K", "a", body="> SENSITIVE\n\n# T\n"))
    repo.commit()
    meta.generate(repo.config)
    out = repo.read("topics/open/README.md")
    assert "normal.md" in out and "hidden.md" not in out


def test_protected_topic_still_lists_its_files(repo: Brain) -> None:
    repo.write("INDEX.md", BASE_INDEX)
    repo.write("topics/private/README.md", full("2026-05-01", "Private", "p", extra="scope: private\n",
                                                body="> SENSITIVE\n\n# Private\n\n## Files\n\n"
                                                     "| File | Key fact | Aliases |\n|---|---|---|\n"))
    repo.write("topics/private/one.md", full("2026-01-01", "K", "a"))
    repo.commit()
    meta.generate(repo.config)
    assert "one.md" in repo.read("topics/private/README.md")


def test_report_lists_missing_stale_and_todo(repo: Brain) -> None:
    repo.write("notes/without.md", "# Without\n")
    repo.write("notes/old.md", full("2020-01-01", "X"))
    repo.write("notes/todo.md", full(TODAY, "TODO"))
    repo.write("notes/ok.md", full(TODAY, "Good"))
    repo.write("notes/arch.md", full("2020-01-01", "X", status="archived"))
    repo.write("notes/hidden.md", "# G\n\n> SENSITIVE\n")
    repo.commit()
    report = meta.report(repo.config)
    for present in ("notes/without.md", "notes/old.md", "notes/todo.md", "1 sensitive file(s) skipped"):
        assert present in report
    for absent in ("notes/ok.md", "notes/arch.md", "hidden"):
        assert absent not in report


def test_german_hub_generates_identical_german_tables(german: Brain) -> None:
    german.git_init()
    german.write("INDEX.md", "# Hub-Index\n\n## Topics\n\n| Ordner | Worum es geht | Aliase |\n|---|---|---|\n\n"
                 "## Notes (flach)\n\n| Datei | Kernfakt | Aliase |\n|---|---|---|\n\n"
                 "## Bookmarks\n\n| Datei | Kernfakt | Aliase |\n|---|---|---|\n")
    german.write("topics/t/README.md", "---\nscope: work\nstand: 2026-05-01\nstatus: aktiv\nkernfakt: Thema T\n"
                 "kurz: Thema T\naliase: [tt]\nzeitraum: []\nentitaeten: []\n---\n\n# T\n")
    german.write("topics/t/a.md", "---\nstand: 2026-02-01\nstatus: aktiv\nkernfakt: Fakt A\nkurz: Fakt A\n"
                 "aliase: [al1]\nzeitraum: []\nentitaeten: []\n---\n\n# A\n")
    german.write("topics/t/archiv-alt.md", "# Alt\n")
    german.commit()
    meta.migrate(german.config)
    assert parse_frontmatter(german.read("topics/t/archiv-alt.md"))[0]["status"] == "archiv"
    meta.generate(german.config)
    readme = german.read("topics/t/README.md")
    assert "## Dateien\n\n| Datei | Kernfakt | Aliase |" in readme
    assert "| `topics/t/a.md` | Fakt A | al1 |" in readme
    assert "| `topics/t/` | Thema T | tt |" in german.read("INDEX.md")
    snapshot = german.read("INDEX.md"), readme
    assert meta.generate(german.config) == []
    assert (german.read("INDEX.md"), german.read("topics/t/README.md")) == snapshot


def test_report_can_stay_silent_without_findings(repo: Brain) -> None:
    repo.write("notes/ok.md", full(TODAY, "Good"))
    assert meta.report(repo.config, only_findings=True) == ""
    repo.write("notes/todo.md", full(TODAY, "TODO"))
    assert "notes/todo.md" in meta.report(repo.config, only_findings=True)
