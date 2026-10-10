"""Second threat-model round: findings from an adversarial review and a cross-provider review."""

from __future__ import annotations

import json
import time
import unicodedata
from pathlib import Path
from unittest.mock import patch

import pytest
from conftest import Brain, Synced, document, invoke, revision

from dummkopf import meta
from dummkopf.access import Access
from dummkopf.errors import AccessDenied, DummkopfError
from dummkopf.hook import pre_commit
from dummkopf.links import references
from dummkopf.search import context_packet, find
from dummkopf.write import check, ingest

# --- sensitivity -------------------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "﻿> SENSITIVE\n\n# t\n\nzorkmid\n",
    "# t\n\n  > SENSITIVE\n\nzorkmid\n",
    "# t\n\n\t> SENSITIVE\n\nzorkmid\n",
    "# t\ntext\r> SENSITIVE\rzorkmid\n",
    "# t\r\n\r\n> SENSITIVE\r\nzorkmid\r\n",
])
def test_marker_variants_hide_the_note(brain: Brain, text: str) -> None:
    brain.write("notes/a.md", text)
    assert find(Access(brain.config), "zorkmid")["hits"] == []


def test_marker_variant_in_readme_hides_the_topic(brain: Brain) -> None:
    brain.write("topics/t/README.md", "﻿  > SENSITIVE\n# T\n")
    brain.note("topics/t/a.md", body="zorkmid")
    assert find(Access(brain.config), "zorkmid")["hits"] == []


def test_unicode_normalization_cannot_bypass_always(brain: Brain) -> None:
    brain.configure("[sensitive]\nalways = ['topics/" + unicodedata.normalize("NFC", "café") + "/']\n")
    brain.note("topics/" + unicodedata.normalize("NFD", "café") + "/a.md", body="zorkmid")
    assert find(Access(brain.config), "zorkmid")["hits"] == []


# --- scope -------------------------------------------------------------------------------------


def test_new_sub_readme_cannot_move_private_notes_into_work(brain: Brain) -> None:
    brain.write("topics/pub/README.md", document(scope="private"))
    brain.write("topics/pub/sub/b.md", document(body="wibble"))
    readme = {"path": "topics/pub/sub/README.md", "expected": None, "content": document(scope="work")}
    with pytest.raises(DummkopfError) as caught:
        ingest(Access(brain.config, scope="work"), {"changes": [readme]}, sync=False)
    assert caught.value.key == "scope_change"
    assert find(Access(brain.config, scope="work"), "wibble")["hits"] == []


def test_sub_readme_with_the_inherited_scope_is_fine(brain: Brain) -> None:
    brain.write("topics/pub/README.md", document(scope="private"))
    brain.write("topics/pub/sub/b.md", document(body="wibble"))
    readme = {"path": "topics/pub/sub/README.md", "expected": None, "content": document(scope="private")}
    ingest(Access(brain.config, scope="private"), {"changes": [readme]}, sync=False)


def test_readme_table_lists_only_notes_of_its_own_scope(brain: Brain) -> None:
    brain.git_init()
    brain.write("topics/wk/README.md", document(scope="work"))
    brain.write("topics/wk/p.md", document(scope="private").replace("Proven content.", "divorce lawyer"))
    brain.write("topics/wk/w.md", document())
    meta.generate(brain.config)
    readme = brain.read("topics/wk/README.md")
    assert "topics/wk/w.md" in readme
    assert "divorce" not in readme and "topics/wk/p.md" not in readme


def test_mixed_readme_does_not_list_scoped_notes(brain: Brain) -> None:
    brain.git_init()
    brain.write("topics/mix/README.md", document())
    brain.write("topics/mix/p.md", document(scope="private").replace("Proven content.", "divorce lawyer"))
    meta.generate(brain.config)
    assert "divorce" not in brain.read("topics/mix/README.md")


# --- existence oracles --------------------------------------------------------------------------


def link_result(brain: Brain, target: str) -> str:
    data = {"changes": [{"path": "notes/x.md", "expected": None, "content": document(body=f"[x]({target})")}]}
    try:
        ingest(Access(brain.config), data, dry_run=True, sync=False)
    except DummkopfError as error:
        return str(error)
    return "accepted"


def test_folders_and_files_outside_notes_give_no_existence_signal(brain: Brain) -> None:
    brain.write("topics/health/README.md", document(body="> SENSITIVE"))
    brain.write("archive/old.md", "# Old\n")
    absent = link_result(brain, "../topics/nonexist")
    for target in ("../topics/health", "../archive/old.md", "../.sensitive-paths", "../.git",
                   "../dummkopf.toml", "../nonexist-dir", "../.git/nonexist"):
        assert link_result(brain, target) == absent, target


def test_link_to_a_readable_topic_folder_resolves_to_its_readme(brain: Brain) -> None:
    brain.write("topics/open/README.md", document(scope="work"))
    assert link_result(brain, "../topics/open") == "accepted"
    assert link_result(brain, "../topics/open/") == "accepted"


def test_new_file_in_hidden_and_missing_topic_look_identical(brain: Brain) -> None:
    brain.write("topics/health/README.md", document(body="> SENSITIVE"))
    brain.write("topics/pub/README.md", document(scope="private"))
    messages = []
    for rel, scope in (("topics/health/zz.md", None), ("topics/nonexist/zz.md", None),
                       ("topics/pub/zz.md", "work"), ("topics/nonexist/zz.md", "work")):
        data = {"changes": [{"path": rel, "expected": None, "content": document()}]}
        with pytest.raises(DummkopfError) as caught:
            ingest(Access(brain.config, scope=scope), data, dry_run=True, sync=False)
        messages.append(str(caught.value))
    assert len(set(messages)) == 1


# --- symlinks and robustness --------------------------------------------------------------------


def test_meta_index_refuses_a_symlinked_paths_file(brain: Brain, tmp_path: Path) -> None:
    victim = tmp_path / "victim.txt"
    victim.write_text("keep\n", encoding="utf-8")
    (brain.root / ".sensitive-paths").unlink()
    (brain.root / ".sensitive-paths").symlink_to(victim)
    brain.note("notes/a.md", body="> SENSITIVE")
    invoke(brain, "meta", "index")
    assert victim.read_text(encoding="utf-8") == "keep\n"


def test_symlinked_index_is_never_read_into_notes(brain: Brain, tmp_path: Path) -> None:
    outside = tmp_path / "index.md"
    outside.write_text("## Notes (flat)\n\n| File | Key fact | Aliases |\n|---|---|---|\n"
                       "| `notes/a.md` | OUTSIDE-SECRET | x |\n", encoding="utf-8")
    brain.git_init()
    (brain.root / "INDEX.md").symlink_to(outside)
    brain.write("notes/a.md", "# A\n")
    meta.migrate(brain.config)
    assert "OUTSIDE-SECRET" not in brain.read("notes/a.md")


def test_unreadable_note_is_never_overwritten(brain: Brain) -> None:
    brain.git_init()
    path = brain.write("notes/a.md", "# A\n\nprecious\n")
    path.chmod(0o200)
    try:
        meta.migrate(brain.config)
        meta.generate(brain.config)
    finally:
        path.chmod(0o600)
    assert brain.read("notes/a.md") == "# A\n\nprecious\n"


def test_migrate_never_touches_sources(brain: Brain) -> None:
    brain.git_init()
    brain.write("topics/t/sources/original.md", "Original text.\n")
    meta.migrate(brain.config)
    assert brain.read("topics/t/sources/original.md") == "Original text.\n"


def test_long_bracket_runs_are_checked_in_linear_time() -> None:
    start = time.monotonic()
    references("[[" * 40000 + "\n" + "[" * 80000)
    assert time.monotonic() - start < 2


def test_broken_url_is_an_issue_not_a_crash(brain: Brain) -> None:
    brain.write("notes/a.md", document(body="[x](http://[)"))
    result = check(Access(brain.config))
    assert any(issue["code"] == "link-invalid" for issue in result["issues"])


# --- routes ------------------------------------------------------------------------------------


def route_brain(brain: Brain, alias: str) -> None:
    brain.write("topics/meals/README.md", "---\nscope: private\n---\n> SENSITIVE\n# Meals\n")
    brain.write("routes.json", json.dumps({"routes": [{"aliases": [alias], "sources": "topics/meals/plan-*.md",
                                                         "scope": "private", "kind": "dated-plan",
                                                         "allow_sensitive": True}]}))


@pytest.mark.parametrize("alias", ["what", "the", "a", "is it"])
def test_stopword_aliases_are_rejected(brain: Brain, alias: str) -> None:
    route_brain(brain, alias)
    with pytest.raises(AccessDenied):
        context_packet(Access(brain.config), "What changed?")


def test_newest_unreadable_plan_does_not_hide_an_older_readable_one(brain: Brain) -> None:
    route_brain(brain, "meal plan")
    brain.write("topics/meals/plan-2020-01-06-to-12.md", "# Old plan\n| Mon 01-06 | OLD |\n")
    brain.write("topics/meals/plan-2020-02-03-to-09.md", "---\nscope: work\n---\n# New plan\n")
    import datetime as dt

    packet = context_packet(Access(brain.config, scope="private"), "meal plan", today=dt.date(2020, 3, 1))
    assert [hit["path"] for hit in packet["hits"]] == ["topics/meals/plan-2020-01-06-to-12.md"]


# --- pre-commit --------------------------------------------------------------------------------


def test_pre_commit_never_stages_unstaged_readme_prose(synced: Synced) -> None:
    brain = synced.brain
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    brain.write("topics/t/README.md", document(scope="work"))
    brain.commit("Topic")
    brain.write("topics/t/README.md", document(scope="work") + "\nHALF WRITTEN DRAFT\n")
    brain.write("topics/t/new.md", document())
    synced.git("add", "topics/t/new.md", "INDEX.md")
    pre_commit(brain.config)
    staged = synced.git("show", ":topics/t/README.md")
    assert "HALF WRITTEN DRAFT" not in staged
    assert "HALF WRITTEN DRAFT" in brain.read("topics/t/README.md")


def test_pre_commit_never_migrates_partly_staged_notes(synced: Synced) -> None:
    brain = synced.brain
    brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n")
    brain.write("notes/raw.md", "# Raw\n")
    synced.git("add", "-A")
    brain.write("notes/raw.md", "# Raw\n\nUNSTAGED\n")
    pre_commit(brain.config)
    assert "UNSTAGED" not in synced.git("show", ":notes/raw.md")


# --- write refresh -----------------------------------------------------------------------------


def test_saved_write_survives_a_deleted_paths_file_upstream(brain: Brain) -> None:
    brain.write("notes/a.md", document())

    def remote_deletes_list(config: object, refresh_remote: bool = False) -> None:
        del config, refresh_remote
        (brain.root / ".sensitive-paths").unlink()

    with patch("dummkopf.write.prepare_repository"), \
            patch("dummkopf.write.sync_locked", side_effect=remote_deletes_list):
        result = ingest(Access(brain.config), {"changes": [
            {"path": "notes/a.md", "expected": revision(brain, "notes/a.md"), "append": "More."}]})
    assert result["saved"] and result["sync"] == "ok" and result["revisions"] == {}


# --- review round 3 ----------------------------------------------------------------------------


def plan_brain(brain: Brain, allow: bool | None) -> None:
    brain.write("topics/meals/README.md", "---\nscope: private\n---\n> SENSITIVE\n# Meals\n")
    route: dict[str, object] = {"aliases": ["meal plan"], "sources": "topics/meals/plan-*.md",
                                "scope": "private", "kind": "dated-plan"}
    if allow is not None:
        route["allow_sensitive"] = allow
    brain.write("routes.json", json.dumps({"routes": [route]}))
    brain.write("topics/meals/plan-2020-01-06-to-12.md", "# Plan\n| Mon 01-06 | SOUP |\n")


@pytest.mark.parametrize("allow", [None, False])
def test_route_without_opt_in_never_opens_sensitive_plans(brain: Brain, allow: bool | None) -> None:
    import datetime as dt

    plan_brain(brain, allow)
    packet = context_packet(Access(brain.config, scope="private"), "meal plan", today=dt.date(2020, 1, 7))
    assert packet["hits"] == []


def test_route_with_opt_in_opens_sensitive_plans(brain: Brain) -> None:
    import datetime as dt

    plan_brain(brain, True)
    packet = context_packet(Access(brain.config, scope="private"), "meal plan", today=dt.date(2020, 1, 7))
    assert [hit["path"] for hit in packet["hits"]] == ["topics/meals/plan-2020-01-06-to-12.md"]


@pytest.mark.parametrize("value", ["yes", 1])
def test_route_opt_in_must_be_a_boolean(brain: Brain, value: object) -> None:
    plan_brain(brain, True)
    data = json.loads(brain.read("routes.json"))
    data["routes"][0]["allow_sensitive"] = value
    brain.write("routes.json", json.dumps(data))
    with pytest.raises(AccessDenied):
        context_packet(Access(brain.config, scope="private"), "meal plan")


def scoped_topics(brain: Brain) -> None:
    brain.git_init()
    brain.write("topics/job/README.md", document(scope="work", body="August 2026, TODO ship it"))
    brain.write("topics/diary/README.md",
                document(scope="private", body="August 2026, TODO call the divorce lawyer"))
    brain.commit("seed", date="2020-01-01T12:00:00")


def test_extras_and_report_respect_the_scope(brain: Brain) -> None:
    scoped_topics(brain)
    for args in (("links", "--json", "--min-topics", "1"), ("curator", "--json", "--open-days", "1"),
                 ("meta", "report")):
        code, output, _ = invoke(brain, *args, "--scope", "work")
        assert code == 0, args
        assert "diary" not in output and "divorce" not in output, args
    code, output, _ = invoke(brain, "links", "--json", "--min-topics", "1", "--scope", "private")
    assert "diary" in output and "job" not in output


def test_extras_default_to_query_default(brain: Brain) -> None:
    brain.configure("[scopes]\nquery_default = 'work'\n")
    scoped_topics(brain)
    code, output, _ = invoke(brain, "curator", "--json", "--open-days", "1")
    assert code == 0 and "divorce" not in output
