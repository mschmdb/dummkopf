from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest
from conftest import Brain, document, invoke, revision

from dummkopf.access import Access
from dummkopf.errors import AccessDenied, DummkopfError
from dummkopf.write import WriteResult, check, ingest

Packet = dict[str, Any]


def change(path: str, content: str, expected: str | None = None) -> dict[str, Any]:
    return {"path": path, "content": content, "expected": expected}


def packet(*changes: dict[str, Any]) -> Packet:
    return {"changes": list(changes)}


def write(brain: Brain, data: object, scope: str | None = None,
          allow_sensitive: tuple[str, ...] = ()) -> WriteResult:
    return ingest(Access(brain.config, scope, None, allow_sensitive), data, sync=False)


def test_create_returns_version_and_repeating_same_packet_changes_nothing(brain: Brain) -> None:
    data = packet(change("notes/new.md", document()))
    result = write(brain, data)
    assert result["changed"] == ["notes/new.md"]
    assert result["revisions"]["notes/new.md"] == revision(brain, "notes/new.md")
    assert write(brain, data)["changed"] == []


def test_new_files_are_private_to_the_owner(brain: Brain) -> None:
    write(brain, packet(change("notes/new.md", document())))
    assert (brain.root / "notes/new.md").stat().st_mode & 0o777 == 0o600


def test_update_requires_fresh_hash_and_stale_write_preserves_data(brain: Brain) -> None:
    path = brain.write("notes/a.md", document())
    old = revision(brain, "notes/a.md")
    write(brain, packet(change("notes/a.md", document(body="New facts."), old)))
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("notes/a.md", document(body="Stale version."), old)))
    assert caught.value.key == "version_conflict"
    assert "New facts." in path.read_text()


def test_exact_replacement_preserves_rest_and_repeating_it_changes_nothing(brain: Brain) -> None:
    path = brain.write("notes/a.md", document(body="First fact.\nOther fact."))
    data = packet({"path": "notes/a.md", "expected": revision(brain, "notes/a.md"),
                   "replace": [{"old": "First fact.", "new": "Corrected fact."}],
                   "metadata": {"key_fact": "Corrected fact."}})
    write(brain, data)
    assert "Other fact." in path.read_text() and "Corrected fact." in path.read_text()
    assert write(brain, data)["changed"] == []


@pytest.mark.parametrize("old", ["Fact.", "Missing.", ""])
def test_replacement_requires_unique_existing_text(brain: Brain, old: str) -> None:
    brain.write("notes/a.md", document(body="Fact.\nFact."))
    data = packet({"path": "notes/a.md", "expected": revision(brain, "notes/a.md"),
                   "replace": [{"old": old, "new": "Corrected."}]})
    with pytest.raises(DummkopfError):
        write(brain, data)


def test_replacement_cannot_use_stale_revision_or_create_a_file(brain: Brain) -> None:
    path = brain.write("notes/a.md", document(body="Fact."))
    old = revision(brain, "notes/a.md")
    path.write_text(document(body="Fact.\nForeign change."))
    for name, expected in [("notes/a.md", old), ("notes/missing.md", None)]:
        with pytest.raises(DummkopfError):
            write(brain, packet({"path": name, "expected": expected,
                                 "replace": [{"old": "Fact.", "new": "Corrected."}]}))


def test_content_and_replacement_cannot_be_combined(brain: Brain) -> None:
    item = change("notes/a.md", document())
    item["replace"] = [{"old": "x", "new": "y"}]
    with pytest.raises(DummkopfError):
        write(brain, packet(item))


def test_complete_update_packet_is_idempotent_even_with_old_revision(brain: Brain) -> None:
    brain.write("notes/a.md", document())
    data = packet(change("notes/a.md", document(body="New facts."), revision(brain, "notes/a.md")))
    write(brain, data)
    assert write(brain, data)["changed"] == []


def test_all_changes_validate_before_any_write(brain: Brain) -> None:
    data = packet(change("notes/good.md", document()), change("notes/bad.md", "# No metadata"))
    with pytest.raises(DummkopfError):
        write(brain, data)
    assert not (brain.root / "notes/good.md").exists()


def test_new_topic_requires_scoped_readme_in_same_batch(brain: Brain) -> None:
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("topics/new/a.md", document())))
    assert caught.value.key == "topic_needs_readme"
    write(brain, packet(change("topics/new/a.md", document()),
                        change("topics/new/README.md", document(scope="work"))), scope="work")
    assert Access(brain.config, scope="work").read("topics/new/a.md").scope == "work"


def test_unscoped_new_topic_is_rejected(brain: Brain) -> None:
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("topics/new/README.md", document())))
    assert caught.value.key == "topic_needs_scope"


def test_unscoped_new_topic_allowed_when_configured(brain: Brain) -> None:
    brain.configure("[scopes]\nrequire_on_new_topic = false\n")
    write(brain, packet(change("topics/new/README.md", document())))
    assert (brain.root / "topics/new/README.md").exists()


def test_sensitive_batch_requires_explicit_grant_and_remains_protected(brain: Brain) -> None:
    data = packet(change("topics/locked/README.md", document(body="> SENSITIVE", scope="private")),
                  change("topics/locked/a.md", document()))
    with pytest.raises(AccessDenied):
        write(brain, data)
    write(brain, data, scope="private", allow_sensitive=("topics/locked",))
    with pytest.raises(AccessDenied):
        Access(brain.config).read("topics/locked/a.md")


def test_new_sensitive_note_without_grant_names_the_flag(brain: Brain) -> None:
    data = packet(change("notes/new.md", document(body="> SENSITIVE\nSecret")))
    with pytest.raises(AccessDenied, match="--allow-sensitive notes/new.md"):
        write(brain, data, scope="private")
    assert not (brain.root / "notes/new.md").exists()
    write(brain, data, scope="private", allow_sensitive=("notes/new.md",))
    assert (brain.root / "notes/new.md").exists()


def test_new_file_in_sensitive_topic_keeps_generic_denial(brain: Brain) -> None:
    brain.write("topics/locked/README.md", document(scope="private", body="> SENSITIVE"))
    with pytest.raises(AccessDenied) as caught:
        write(brain, packet(change("topics/locked/a.md", document())), scope="private")
    assert "--allow-sensitive" not in str(caught.value)


def test_existing_sensitive_note_keeps_generic_denial(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="> SENSITIVE\nSecret"))
    data = packet(change("notes/a.md", document(body="> SENSITIVE\nNew"), revision(brain, "notes/a.md")))
    with pytest.raises(AccessDenied) as caught:
        write(brain, data)
    assert "--allow-sensitive" not in str(caught.value)


def test_sensitive_marker_cannot_be_removed(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="> SENSITIVE\nSecret"))
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("notes/a.md", document(), revision(brain, "notes/a.md"))),
              allow_sensitive=("notes/a.md",))
    assert caught.value.key == "marker_removal"


def test_always_sensitive_file_automatically_carries_marker(german: Brain) -> None:
    german_doc = ("---\nstand: 2026-10-04\nstatus: aktiv\nkernfakt: Fakt.\nkurz: Fakt.\n"
                  "aliase: []\nzeitraum: []\nentitaeten: []\n{scope}---\n\n# Titel\n\n{body}\n")
    german.write("topics/vertraulich/README.md", german_doc.format(scope="scope: privat\n", body="> SENSIBEL"))
    ingest(Access(german.config, "privat", None, ("topics/vertraulich/a.md",)),
           packet(change("topics/vertraulich/a.md", german_doc.format(scope="", body="Text"))), sync=False)
    assert "> SENSIBEL" in german.read("topics/vertraulich/a.md")


def test_scope_change_on_existing_readme_is_rejected(brain: Brain) -> None:
    brain.write("topics/test/README.md", document(scope="private"))
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("topics/test/README.md", document(scope="work"),
                                   revision(brain, "topics/test/README.md"))))
    assert caught.value.key == "scope_change"


def test_private_source_cannot_be_linked_from_work_note(brain: Brain) -> None:
    brain.write("topics/private/README.md", document(scope="private"))
    brain.write("topics/private/a.md", document())
    with pytest.raises(DummkopfError):
        write(brain, packet(change("notes/work.md", document(scope="work", body="[Source](../topics/private/a.md)"))))


def test_sensitive_link_cannot_escape_through_public_note(brain: Brain) -> None:
    brain.write("notes/secret.md", document(body="> SENSITIVE"))
    with pytest.raises(DummkopfError):
        write(brain, packet(change("notes/public.md", document(body="[Source](secret.md)"))),
              allow_sensitive=("notes/secret.md",))


def test_links_between_new_files_in_same_batch_are_valid(brain: Brain) -> None:
    write(brain, packet(change("notes/a.md", document(body="[Source](b.md#test)")),
                        change("notes/b.md", document())))
    assert (brain.root / "notes/a.md").exists()


def test_wiki_topic_reference_resolves_to_readme(brain: Brain) -> None:
    brain.write("topics/example/README.md", document(scope="work"))
    write(brain, packet(change("notes/a.md", document(body="[[example]]"))))


def test_wiki_cannot_link_a_hidden_topic_from_public_note(brain: Brain) -> None:
    brain.write("topics/locked/README.md", document(body="> SENSITIVE", scope="private"))
    with pytest.raises(DummkopfError):
        write(brain, packet(change("notes/a.md", document(body="[[locked]]"))))


def test_rejected_link_names_note_line_and_hint_but_not_target(brain: Brain) -> None:
    brain.write("topics/locked/README.md", document(body="> SENSITIVE", scope="private"))
    with pytest.raises(DummkopfError) as caught:
        write(brain, packet(change("notes/a.md", document(body="Text.\n\n[[locked]]"))))
    message = str(caught.value)
    assert "link-unavailable" in message
    assert "notes/a.md, line 15:" in message
    assert "--allow-sensitive" in message
    assert "locked" not in message


def test_new_broken_link_is_rejected_but_legacy_link_is_warning(brain: Brain) -> None:
    with pytest.raises(DummkopfError):
        write(brain, packet(change("notes/a.md", document(body="[Source](missing.md)"))))
    brain.write("notes/old.md", document(body="[Source](missing.md)"))
    result = check(Access(brain.config))
    assert any(issue["code"] == "link-unavailable" for issue in result["issues"])


def test_original_source_cannot_be_overwritten(brain: Brain, german: Brain) -> None:
    for target, folder, readme_scope in ((brain, "sources", "work"), (german, "quellen", "work")):
        target.write("topics/test/README.md", document(scope=readme_scope))
        rel = "topics/test/" + folder + "/original.md"
        target.write(rel, document())
        with pytest.raises(DummkopfError) as caught:
            ingest(Access(target.config), packet(change(rel, document(body="Changed"), revision(target, rel))),
                   sync=False)
        assert caught.value.key == "sources_readonly"


def test_paths_symlinks_duplicates_and_missing_expected_are_rejected(brain: Brain) -> None:
    target = brain.write("notes/real.md", document())
    (brain.root / "notes/link.md").symlink_to(target)
    cases = [packet(change("../outside.md", document())),
             packet(change("notes/link.md", document())),
             packet(change("notes/nested/a.md", document())),
             packet(change("notes/real.md", document(body="changed"))),
             packet(change("notes/a.md", document()), change("notes/a.md", document())),
             packet(change("notes/Bad_Name.md", document())),
             packet(change("topics/flat.md", document())),
             {"changes": [{"path": "notes/a.md", "content": document()}]},
             {"changes": []},
             {"changes": [], "extra": 1},
             []]
    for data in cases:
        with pytest.raises(DummkopfError):
            write(brain, data)


@pytest.mark.parametrize("content", [
    document().replace("2026-10-01", "invalid"),
    document().replace("aliases: [test]", "aliases: test"),
    document().replace("key_fact: Proven content.", "key_fact: TODO"),
    document(scope="invalid"),
])
def test_invalid_metadata_does_not_write(brain: Brain, content: str) -> None:
    with pytest.raises(DummkopfError):
        write(brain, packet(change("notes/a.md", content)))
    assert not (brain.root / "notes/a.md").exists()


@pytest.mark.parametrize("metadata", [{"key_fact": "x\nscope: private"}, {"bad:key": "value"},
                                      {"aliases": ["x\nstatus: wrong"]}, {"key_fact": 3}])
def test_metadata_cannot_inject_frontmatter_lines(brain: Brain, metadata: dict[str, object]) -> None:
    item = change("notes/a.md", document())
    item["metadata"] = metadata
    with pytest.raises(DummkopfError):
        write(brain, packet(item))


def test_revision_matches_original_crlf_bytes(brain: Brain) -> None:
    path = brain.root / "notes/crlf.md"
    path.parent.mkdir()
    data = document().replace("\n", "\r\n").encode()
    path.write_bytes(data)
    assert Access(brain.config).read("notes/crlf.md").revision == revision(brain, "notes/crlf.md")


def test_standalone_metadata_can_supply_fact_without_full_frontmatter(brain: Brain) -> None:
    item = change("notes/a.md", "# Test\nProven content.\n")
    item["metadata"] = {"key_fact": "Proven content.", "aliases": ["test"]}
    write(brain, packet(item))
    note = Access(brain.config).read("notes/a.md")
    assert note.key_fact == "Proven content."
    assert note.updated == dt.date.today().isoformat()
    assert note.status == "active"


def test_german_mapping_writes_german_keys(german: Brain) -> None:
    item = change("notes/a.md", "# Test\nInhalt.\n")
    item["metadata"] = {"kernfakt": "Belegt.", "aliase": ["test"]}
    ingest(Access(german.config), packet(item), sync=False)
    text = german.read("notes/a.md")
    for key in ("stand: ", "status: aktiv", "kernfakt: Belegt.", "kurz: Belegt.", "zeitraum: []",
                "entitaeten: []"):
        assert key in text


def test_check_omits_protected_paths_and_does_not_mutate_files(brain: Brain) -> None:
    path = brain.write("notes/secret.md", document(body="> SENSITIVE\nSecret"))
    brain.write("notes/public.md", "# Missing metadata")
    before = path.read_bytes()
    result = check(Access(brain.config))
    assert result["checked"] == 1
    assert "secret" not in json.dumps(result)
    assert path.read_bytes() == before


def test_cli_dry_run_and_check_input_use_same_validation(brain: Brain) -> None:
    source = brain.write("packet.json", json.dumps(packet(change("notes/a.md", document()))))
    for args in (("ingest", "--dry-run"), ("check",)):
        code, output, _ = invoke(brain, *args, "--input", str(source), "--json")
        assert code == 0
        assert not (brain.root / "notes/a.md").exists()
        assert json.loads(output)


def test_append_adds_block_at_end_and_updates_date(brain: Brain) -> None:
    brain.write("bookmarks/tools.md", document(body="## Old\n- URL: a"))
    write(brain, packet({"path": "bookmarks/tools.md", "expected": revision(brain, "bookmarks/tools.md"),
                         "append": "## New\n- URL: b\n"}))
    text = brain.read("bookmarks/tools.md")
    assert text.endswith("- URL: a\n\n## New\n- URL: b\n")
    assert "updated: " + dt.date.today().isoformat() in text


def test_append_needs_existing_file_and_text(brain: Brain) -> None:
    with pytest.raises(DummkopfError, match="append"):
        write(brain, packet({"path": "bookmarks/none.md", "expected": None, "append": "x"}))
    brain.write("bookmarks/tools.md", document())
    with pytest.raises(DummkopfError, match="append"):
        write(brain, packet({"path": "bookmarks/tools.md", "expected": revision(brain, "bookmarks/tools.md"),
                             "append": "  \n"}))


def test_repeated_append_after_success_changes_nothing(brain: Brain) -> None:
    brain.write("bookmarks/tools.md", document())
    item = {"path": "bookmarks/tools.md", "expected": revision(brain, "bookmarks/tools.md"),
            "append": "## New\n- URL: b"}
    write(brain, packet(item))
    assert write(brain, packet(item))["changed"] == []


def test_append_excludes_content(brain: Brain) -> None:
    brain.write("bookmarks/tools.md", document())
    with pytest.raises(DummkopfError):
        write(brain, packet({"path": "bookmarks/tools.md", "expected": revision(brain, "bookmarks/tools.md"),
                             "append": "x", "content": document()}))


def test_short_revision_prefix_is_accepted(brain: Brain) -> None:
    brain.write("notes/a.md", document())
    write(brain, packet({"path": "notes/a.md", "expected": revision(brain, "notes/a.md")[:12], "append": "More."}))
    assert "More." in brain.read("notes/a.md")


def test_too_short_or_wrong_prefix_is_rejected(brain: Brain) -> None:
    brain.write("notes/a.md", document())
    with pytest.raises(DummkopfError, match="expected"):
        write(brain, packet({"path": "notes/a.md", "expected": revision(brain, "notes/a.md")[:8], "append": "x"}))
    with pytest.raises(DummkopfError, match="rev=" + revision(brain, "notes/a.md")[:12]):
        write(brain, packet({"path": "notes/a.md", "expected": "0" * 12, "append": "x"}))


def test_broken_json_names_line_and_column(brain: Brain) -> None:
    code, _, error = invoke(brain, "ingest", "--input", "-", "--dry-run", stdin='{"changes":[\n{"path": }]}')
    assert code == 2
    assert "line 2" in error and "column" in error


def test_write_markdown_with_frontmatter_as_dry_run(brain: Brain) -> None:
    code, output, error = invoke(brain, "write", "notes/new.md", "--expected", "new", "--dry-run",
                                 stdin=document(title="New"))
    assert (code, error) == (0, "")
    assert "Changed: notes/new.md" in output
    assert not (brain.root / "notes/new.md").exists()


def test_write_append_as_dry_run(brain: Brain) -> None:
    brain.write("bookmarks/tools.md", document())
    code, output, error = invoke(brain, "write", "bookmarks/tools.md", "--append", "--dry-run",
                                 "--expected", revision(brain, "bookmarks/tools.md")[:12],
                                 stdin="## New\n- URL: b\n")
    assert (code, error) == (0, "")
    assert "Changed: bookmarks/tools.md" in output


def test_write_requires_expected(brain: Brain) -> None:
    with pytest.raises(SystemExit):
        invoke(brain, "write", "notes/new.md")


def test_too_large_input_is_rejected(brain: Brain) -> None:
    brain.configure("[limits]\nmax_input_chars = 10\n")
    code, _, error = invoke(brain, "write", "notes/new.md", "--expected", "new", "--dry-run",
                            stdin=document())
    assert code == 2
    assert "too large" in error


class Security:
    @staticmethod
    def rejected(brain: Brain, relative: str, message: str, content: str = "Addition.",
                 append: bool = True, flags: tuple[str, ...] = ()) -> None:
        path = brain.root / relative
        before = path.read_bytes()
        arguments = ["write", relative, "--expected", revision(brain, relative)[:12], "--dry-run", "--serious",
                     *flags]
        if append:
            arguments.append("--append")
        code, output, error = invoke(brain, *arguments, stdin=content)
        assert code == 2
        assert output == ""
        assert message in error
        assert path.read_bytes() == before


def test_append_denies_sensitive_note_without_grant(brain: Brain) -> None:
    brain.write("notes/protected.md", document(body="> SENSITIVE\n\nEvidence."))
    Security.rejected(brain, "notes/protected.md", "access excluded")


def test_append_denies_private_note_in_work_scope(brain: Brain) -> None:
    brain.write("notes/private.md", document(scope="private"))
    Security.rejected(brain, "notes/private.md", "access excluded", flags=("--scope", "work"))


def test_append_denies_symlink_and_preserves_target(brain: Brain) -> None:
    target = brain.write("notes/real.md", document())
    before = target.read_bytes()
    (brain.root / "notes/link.md").symlink_to(target)
    Security.rejected(brain, "notes/link.md", "access excluded")
    assert (brain.root / "notes/link.md").is_symlink()
    assert target.read_bytes() == before


def test_append_preserves_original_source(brain: Brain) -> None:
    brain.write("topics/demo/README.md", document(scope="work"))
    brain.write("topics/demo/sources/original.md", document())
    Security.rejected(brain, "topics/demo/sources/original.md", "Originals under sources/ stay unchanged")


def test_write_preserves_sensitive_marker_despite_grant(brain: Brain) -> None:
    brain.write("notes/protected.md", document(body="> SENSITIVE\n\nEvidence."))
    Security.rejected(brain, "notes/protected.md", "must not remove a sensitivity marker",
                      content=document(), append=False, flags=("--allow-sensitive", "notes/protected.md"))


def test_write_preserves_existing_scope(brain: Brain) -> None:
    brain.write("notes/work.md", document(scope="work"))
    Security.rejected(brain, "notes/work.md", "Changing a scope", content=document(scope="private"), append=False)
