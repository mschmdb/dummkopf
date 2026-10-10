from __future__ import annotations

from conftest import Brain

from dummkopf.files import iter_note_files, topic_of
from dummkopf.sensitive import Sensitivity, marker_pattern


def test_marker_matches_at_line_start_only(brain: Brain) -> None:
    pattern = marker_pattern("> SENSITIVE")
    assert pattern.search("# A\n\n> SENSITIVE\n")
    assert pattern.search("# A\n\n>SENSITIVE\n")
    assert pattern.search("# A\n\n>   sensitive\n")
    assert not pattern.search("A word SENSITIVE mid-sentence.\n")
    assert not pattern.search("# A\n>\nSENSITIVE\n"), "marker must not span lines"
    assert pattern.search("# A\n>\u00a0SENSITIVE\n"), "a non-breaking space looks like a space"
    assert pattern.search("# A\n>\u2003SENSITIVE\n")


def test_custom_marker_is_escaped() -> None:
    pattern = marker_pattern("!! private (do not share)")
    assert pattern.search("x\n!! private (do not share)\n")
    assert not pattern.search("x\n!! private do not share\n")


def test_marker_in_file(brain: Brain) -> None:
    brain.write("notes/a.md", "# A\n\n> SENSITIVE\n")
    assert Sensitivity.load(brain.config).is_sensitive("notes/a.md")


def test_marker_in_any_ancestor_readme(brain: Brain) -> None:
    brain.write("topics/s/README.md", "# S\n\n> SENSITIVE\n")
    brain.write("topics/s/a.md", "# A\n")
    brain.write("topics/s/deep/b.md", "# B\n")
    sensitivity = Sensitivity.load(brain.config)
    assert sensitivity.is_sensitive("topics/s/a.md")
    assert sensitivity.is_sensitive("topics/s/README.md")
    assert sensitivity.is_sensitive("topics/s/deep/b.md")


def test_word_in_prose_is_not_a_marker(brain: Brain) -> None:
    brain.write("notes/a.md", "# A\n\nA word SENSITIVE mid-sentence.\n")
    assert not Sensitivity.load(brain.config).is_sensitive("notes/a.md")


def test_paths_file_lists_files_and_folders(brain: Brain) -> None:
    brain.write(".sensitive-paths", "# comment\nnotes/listed.md\ntopics/locked/\n\n")
    brain.write("notes/listed.md", "# L\n")
    brain.write("topics/locked/a.md", "# A\n")
    brain.write("topics/lockedness/a.md", "# A\n")
    sensitivity = Sensitivity.load(brain.config)
    assert sensitivity.files == frozenset({"notes/listed.md"})
    assert sensitivity.dirs == frozenset({"topics/locked"})
    assert sensitivity.is_listed("notes/listed.md")
    assert sensitivity.is_listed("topics/locked/a.md")
    assert not sensitivity.is_listed("topics/lockedness/a.md")


def test_always_sensitive_prefix_needs_no_marker(german: Brain) -> None:
    german.write("topics/gesundheit/a.md", "# A\n")
    sensitivity = Sensitivity.load(german.config)
    assert sensitivity.is_listed("topics/gesundheit/a.md")
    assert sensitivity.is_sensitive("topics/gesundheit/a.md")
    assert not sensitivity.is_sensitive("topics/ernaehrung/a.md")


def test_german_marker(german: Brain) -> None:
    german.write("notes/a.md", "# A\n\n> SENSIBEL\n")
    german.write("notes/b.md", "# B\n\n> SENSITIVE\n")
    sensitivity = Sensitivity.load(german.config)
    assert sensitivity.is_sensitive("notes/a.md")
    assert not sensitivity.is_sensitive("notes/b.md")


def test_generate_paths_file_from_markers(brain: Brain) -> None:
    brain.configure("[sensitive]\nalways = ['topics/health/']\n")
    brain.write("topics/s/README.md", "# S\n\n> SENSITIVE\n")
    brain.write("topics/s/a.md", "# A\n")
    brain.write("topics/s/deep/b.md", "# B\n")
    brain.write("topics/open/README.md", "# O\n")
    brain.write("topics/open/secret.md", "# X\n\n> SENSITIVE\n")
    brain.write("notes/n.md", "# N\n\n> sensitive\n")
    brain.write("notes/plain.md", "# P\n")
    text = Sensitivity.generate(brain.config)
    entries = [line for line in text.splitlines() if line and not line.startswith("#")]
    assert entries == ["notes/n.md", "topics/health/", "topics/open/secret.md", "topics/s/"]
    assert text.startswith("# ")


def test_iter_note_files_skips_skill_folders_and_other_roots(brain: Brain) -> None:
    brain.write("topics/t/normal.md", "# N\n")
    brain.write("topics/t/skill/SKILL.md", "# S\n")
    brain.write("topics/t/skill/references/x.md", "# X\n")
    brain.write("notes/a.md", "# A\n")
    brain.write("bookmarks/b.md", "# B\n")
    brain.write("archive/old.md", "# O\n")
    brain.write("sources/raw.md", "# R\n")
    brain.write("topics/t/data.txt", "x\n")
    assert iter_note_files(brain.config) == ["bookmarks/b.md", "notes/a.md", "topics/t/normal.md"]


def test_iter_note_files_with_renamed_folders(brain: Brain) -> None:
    config = brain.configure("[layout]\ntopics = 'areas'\nnotes = 'inbox'\n")
    brain.write("areas/x/README.md", "# X\n")
    brain.write("inbox/y.md", "# Y\n")
    brain.write("topics/ignored.md", "# I\n")
    assert iter_note_files(config) == ["areas/x/README.md", "inbox/y.md"]
    assert topic_of("areas/x/README.md", config.layout) == "areas/x"
    assert topic_of("inbox/y.md", config.layout) == "inbox/y.md"
