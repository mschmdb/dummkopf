"""Write rules: topics and READMEs, scope changes, sensitivity markers, links and `check`."""

from __future__ import annotations

import json

from .conftest import Brain, ingest, md, new, package, rev, topic

LINK_UNAVAILABLE = "link-unavailable"


# --- topics and READMEs ----------------------------------------------------------------------------------------


def test_new_topic_needs_a_readme_in_the_same_package(repo: Brain) -> None:
    result = ingest(repo, new("topics/fresh/page.md"))
    assert result.code == 2
    assert result.err == ("This topic is unavailable to this call, or it is new and needs a README.md "
                          "with a scope in the same package.\n")


def test_new_topic_with_readme_and_scope_is_saved(repo: Brain) -> None:
    result = ingest(repo, *topic("fresh"), new("topics/fresh/page.md"))
    assert result.code == 0
    assert result.out.splitlines()[1:] == ["Changed: topics/fresh/README.md", "Changed: topics/fresh/page.md"]


def test_new_topic_readme_without_scope_exits_2(repo: Brain) -> None:
    result = ingest(repo, new("topics/fresh/README.md"), new("topics/fresh/page.md"))
    assert result.code == 2
    assert result.err == "A new topic needs an explicit scope: private, work.\n"


def test_new_topic_readme_with_unknown_scope_exits_2(repo: Brain) -> None:
    result = ingest(repo, *topic("fresh", scope="bogus"))
    assert result.code == 2


def test_scope_is_optional_for_new_topics_when_the_config_says_so(repo: Brain) -> None:
    repo.configure("[scopes]\nrequire_on_new_topic = false\n")
    repo.commit("config")
    assert ingest(repo, new("topics/fresh/README.md", md(title="Fresh"))).code == 0


def test_new_file_in_a_hidden_topic_looks_like_a_new_file_in_a_missing_topic(repo: Brain) -> None:
    repo.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n")
    repo.commit("hidden topic")
    hidden = ingest(repo, new("topics/med/new.md"))
    missing = ingest(repo, new("topics/nothing/new.md"))
    assert hidden.code == missing.code == 2
    assert hidden.err == missing.err
    assert hidden.out == missing.out


def test_new_file_in_an_out_of_scope_topic_is_denied_like_a_missing_topic(repo: Brain) -> None:
    ingest(repo, *topic("job", scope="work"))
    outside = ingest(repo, new("topics/job/new.md"), args=("--scope", "private"))
    missing = ingest(repo, new("topics/nothing/new.md"), args=("--scope", "private"))
    assert outside.code == missing.code == 2
    assert outside.err == missing.err


def test_new_readme_cannot_change_the_scope_of_notes_below_it(repo: Brain) -> None:
    ingest(repo, *topic("job", scope="work"), new("topics/job/sub/note.md"))
    result = ingest(repo, new("topics/job/sub/README.md", md(fields="scope: private\n")))
    assert result.code == 2
    assert result.err == "Changing a scope needs a separate review.\n"


def test_changing_a_scope_in_frontmatter_exits_2(repo: Brain) -> None:
    ingest(repo, new("notes/scoped.md", md(fields="scope: work\n")))
    entry = {"path": "notes/scoped.md", "expected": rev(repo, "notes/scoped.md"),
             "content": md(fields="scope: private\n")}
    result = ingest(repo, entry)
    assert result.code == 2
    assert result.err == "Changing a scope needs a separate review.\n"


def test_dropping_a_scope_from_frontmatter_exits_2(repo: Brain) -> None:
    ingest(repo, new("notes/scoped.md", md(fields="scope: work\n")))
    body = "---\nkey_fact: A fact.\nscope:\n---\n\n# T\n\nBody\n"
    entry = {"path": "notes/scoped.md", "expected": rev(repo, "notes/scoped.md"), "content": body}
    assert ingest(repo, entry).code == 2


# --- markers ----------------------------------------------------------------------------------------------------


def test_new_sensitive_note_needs_allow_sensitive_for_that_path(repo: Brain) -> None:
    result = ingest(repo, new("notes/secret.md", md("> SENSITIVE")))
    assert result.code == 2
    assert result.err == ("New sensitive note. Release it with --allow-sensitive notes/secret.md, "
                          "but only after the user named the topic in the current prompt.\n")
    assert not repo.exists("notes/secret.md")


def test_new_sensitive_note_with_the_grant_is_saved_and_then_hidden(repo: Brain) -> None:
    result = ingest(repo, new("notes/secret.md", md("> SENSITIVE\n\nsecretword")),
                    args=("--allow-sensitive", "notes/secret.md"))
    assert result.code == 0
    assert repo.mode("notes/secret.md") == 0o600
    assert repo.run("read", "notes/secret.md").err == "Path unavailable or access excluded.\n"
    hits = json.loads(repo.run("find", "secretword", "--json").out)["hits"]
    assert [hit["path"] for hit in hits] == []


def test_grant_for_a_different_path_does_not_release_a_new_sensitive_note(repo: Brain) -> None:
    result = ingest(repo, new("notes/secret.md", md("> SENSITIVE")), args=("--allow-sensitive", "notes/other.md"))
    assert result.code == 2
    assert result.err.startswith("New sensitive note.")


def test_new_file_under_sensitive_always_gets_the_marker_automatically(repo: Brain) -> None:
    repo.configure('[sensitive]\nalways = ["topics/health/"]\n')
    repo.commit("config")
    result = ingest(repo, *topic("health", "private"), new("topics/health/visit.md"),
                    args=("--allow-sensitive", "topics/health"))
    assert result.code == 0, result.err
    assert "> SENSITIVE\n" in repo.read("topics/health/visit.md")


def test_removing_a_marker_is_rejected(repo: Brain) -> None:
    ingest(repo, new("notes/secret.md", md("> SENSITIVE\n\nbody")), args=("--allow-sensitive", "notes/secret.md"))
    entry = {"path": "notes/secret.md", "expected": rev(repo, "notes/secret.md", "--allow-sensitive",
                                                        "notes/secret.md"), "content": md("no marker now")}
    result = ingest(repo, entry, args=("--allow-sensitive", "notes/secret.md"))
    assert result.code == 2
    assert result.err == "A write package must not remove a sensitivity marker.\n"
    assert "> SENSITIVE" in repo.read("notes/secret.md")


def test_changing_a_hidden_note_without_the_grant_gets_the_denied_message(repo: Brain) -> None:
    ingest(repo, new("notes/secret.md", md("> SENSITIVE\n\nbody")), args=("--allow-sensitive", "notes/secret.md"))
    hidden = ingest(repo, {"path": "notes/secret.md", "expected": "0123456789ab", "append": "x"})
    assert hidden.code == 2
    assert hidden.err == "Path unavailable or access excluded.\n"
    assert "> SENSITIVE" in repo.read("notes/secret.md")


def test_append_to_a_missing_note_names_the_missing_file_rule(repo: Brain) -> None:
    """Together with the hidden-note test above: a writer can tell an occupied path from a free one."""
    missing = ingest(repo, {"path": "notes/absent.md", "expected": "0123456789ab", "append": "x"})
    assert missing.err == "append needs an existing file and non-empty text.\n"


def test_creating_over_a_hidden_file_is_the_one_documented_oracle(repo: Brain) -> None:
    """README: whoever may create notes learns whether a path is free, because `expected: new` fails."""
    ingest(repo, new("notes/secret.md", md("> SENSITIVE\n\nbody")), args=("--allow-sensitive", "notes/secret.md"))
    result = ingest(repo, new("notes/secret.md"))
    assert result.code == 2
    assert result.err == "Path unavailable or access excluded.\n"


# --- links ------------------------------------------------------------------------------------------------------


def test_dead_link_is_rejected_with_note_and_line(repo: Brain) -> None:
    result = ingest(repo, new("notes/linker.md", md("[x](gone.md)")))
    assert result.code == 2
    assert result.err.startswith("The write package breaks the rules: link-unavailable.\n")
    assert "- notes/linker.md, line 13: A link target is missing or not released." in result.err
    assert "gone.md" not in result.err


def test_link_to_an_existing_note_is_accepted(repo: Brain) -> None:
    assert ingest(repo, new("notes/linker.md", md("[x](first.md)"))).code == 0


def test_link_to_a_note_in_the_same_package_is_accepted(repo: Brain) -> None:
    assert ingest(repo, new("notes/a.md", md("[b](b.md)")), new("notes/b.md")).code == 0


def test_link_with_an_anchor_checks_the_file(repo: Brain) -> None:
    assert ingest(repo, new("notes/linker.md", md("[x](first.md#section)"))).code == 0


def test_external_and_fragment_links_are_not_checked(repo: Brain) -> None:
    body = "[a](https://example.org) [b](mailto:me@example.org) [c](#top)"
    assert ingest(repo, new("notes/linker.md", md(body))).code == 0


def test_link_to_a_hidden_note_looks_like_a_link_to_a_missing_note(repo: Brain) -> None:
    ingest(repo, new("notes/secret.md", md("> SENSITIVE")), args=("--allow-sensitive", "notes/secret.md"))
    hidden = ingest(repo, new("notes/linker.md", md("[x](secret.md)")))
    missing = ingest(repo, new("notes/linker.md", md("[x](nothing.md)")))
    assert hidden.code == missing.code == 2
    assert hidden.err == missing.err
    assert LINK_UNAVAILABLE in hidden.err


def test_a_granted_sensitive_note_may_link_to_a_granted_target(repo: Brain) -> None:
    grants = ("--allow-sensitive", "notes/secret.md", "--allow-sensitive", "notes/inner.md")
    ingest(repo, new("notes/secret.md", md("> SENSITIVE")), args=grants)
    result = ingest(repo, new("notes/inner.md", md("> SENSITIVE\n\n[x](secret.md)")), args=grants)
    assert result.code == 0


def test_link_scheme_other_than_http_and_mailto_is_rejected(repo: Brain) -> None:
    result = ingest(repo, new("notes/linker.md", md("[x](javascript:alert)")))
    assert result.code == 2
    assert "link-invalid" in result.err
    assert "This link scheme is not allowed." in result.err


def test_link_that_leaves_the_brain_is_rejected(repo: Brain) -> None:
    result = ingest(repo, new("notes/linker.md", md("[x](../../outside.md)")))
    assert result.code == 2
    assert "A local link leaves the brain." in result.err


def test_work_note_may_not_link_to_a_private_note(repo: Brain) -> None:
    ingest(repo, *topic("job", "work"), *topic("home", "private"), new("topics/home/diary.md"))
    result = ingest(repo, new("topics/job/page.md", md("[x](../home/diary.md)")))
    assert result.code == 2
    assert "link-scope" in result.err
    assert "A link crosses a sensitivity or scope boundary." in result.err


def test_private_note_may_link_to_a_work_note(repo: Brain) -> None:
    ingest(repo, *topic("job", "work"), *topic("home", "private"), new("topics/job/page.md"))
    assert ingest(repo, new("topics/home/diary.md", md("[x](../job/page.md)"))).code == 0


def test_link_barriers_come_from_the_config(repo: Brain) -> None:
    repo.configure('[scopes]\nlink_barriers = []\n')
    repo.commit("config")
    ingest(repo, *topic("job", "work"), *topic("home", "private"), new("topics/home/diary.md"))
    assert ingest(repo, new("topics/job/page.md", md("[x](../home/diary.md)"))).code == 0


def test_link_to_a_folder_outside_the_note_folders_is_unavailable(repo: Brain) -> None:
    repo.write("archive/old.md", "# Old\n")
    repo.commit("archive")
    result = ingest(repo, new("notes/linker.md", md("[x](../archive/old.md)")))
    assert result.code == 2
    assert LINK_UNAVAILABLE in result.err


def test_links_allow_outside_opens_a_listed_folder_for_existing_files(repo: Brain) -> None:
    repo.write("archive/old.md", "# Old\n")
    repo.configure('[links]\nallow_outside = ["archive"]\n')
    repo.commit("archive")
    assert ingest(repo, new("notes/linker.md", md("[x](../archive/old.md)"))).code == 0
    missing = ingest(repo, new("notes/other.md", md("[x](../archive/absent.md)")))
    assert missing.code == 2
    assert LINK_UNAVAILABLE in missing.err


def test_check_reports_a_dead_link_in_an_existing_note_as_a_warning(repo: Brain) -> None:
    repo.write("notes/dead.md", "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\n"
               "aliases: []\nperiod: []\nentities: []\n---\n\n# Dead\n\n[x](gone.md)\n")
    repo.commit("dead link")
    result = repo.run("check", "notes/dead.md", "--json")
    assert result.code == 0
    data = json.loads(result.out)
    assert data["ok"] is True
    assert data["issues"] == [{"path": "notes/dead.md", "code": "link-unavailable", "severity": "warning",
                               "message": "A link target is missing or not released.", "line": 13}]


# --- check --input ----------------------------------------------------------------------------------------------


def test_check_input_previews_a_package_without_saving(repo: Brain) -> None:
    result = repo.run("check", "--input", "-", stdin=package(new("notes/one.md")))
    assert result.code == 0
    assert result.out == "Write status: preview; sync: not-run\nChanged: notes/one.md\n"
    assert not repo.exists("notes/one.md")


def test_check_input_json_marks_the_result_as_not_saved(repo: Brain) -> None:
    data = json.loads(repo.run("check", "--input", "-", "--json", stdin=package(new("notes/one.md"))).out)
    assert (data["saved"], data["sync"]) == (False, "not-run")


def test_check_input_rejects_a_broken_package_like_ingest(repo: Brain) -> None:
    result = repo.run("check", "--input", "-", stdin=package(new("notes/one.md", "no heading")))
    assert result.code == 2
    assert result.err.startswith("The write package breaks the rules:")


def test_check_input_works_on_a_dirty_tree(repo: Brain) -> None:
    repo.write("notes/by-hand.md", md())
    assert repo.run("check", "--input", "-", stdin=package(new("notes/one.md"))).code == 0


def test_check_takes_paths_or_input_not_both(repo: Brain) -> None:
    result = repo.run("check", "notes/first.md", "--input", "-", stdin="{}")
    assert result.code == 2
    assert result.err == "check takes file paths or --input, not both.\n"


def test_check_without_arguments_counts_the_released_files(repo: Brain) -> None:
    result = repo.run("check")
    assert result.code == 0
    assert result.out == "Checked files: 1; status: ok\n"


def test_check_json_has_checked_issues_and_ok(repo: Brain) -> None:
    assert json.loads(repo.run("check", "--json").out) == {"checked": 1, "issues": [], "ok": True}


def test_check_exits_2_when_a_note_has_errors(repo: Brain) -> None:
    repo.write("notes/bare.md", "# Bare\n\nno frontmatter\n")
    result = repo.run("check")
    assert result.code == 2
    assert result.out.startswith("Checked files: 2; status: error\n")
    assert "notes/bare.md: Frontmatter is missing. (error)" in result.out


def test_check_json_issue_keys(repo: Brain) -> None:
    repo.write("notes/bare.md", "# Bare\n\nno frontmatter\n")
    data = json.loads(repo.run("check", "--json").out)
    assert data["ok"] is False
    assert {"path", "code", "severity", "message"} <= set(data["issues"][0])
    assert data["issues"][0]["severity"] == "error"


def test_check_of_a_hidden_or_missing_path_exits_2_with_the_denied_message(repo: Brain) -> None:
    result = repo.run("check", "notes/absent.md")
    assert result.code == 2
    assert result.err == "Path unavailable or access excluded.\n"
