from __future__ import annotations

import string

import pytest

from dummkopf import messages
from dummkopf.errors import AccessDenied, DummkopfError, Rejected


def fields(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


def test_every_cheeky_message_has_a_plain_twin() -> None:
    assert set(messages.CHEEKY) <= set(messages.PLAIN)


def test_cheeky_errors_keep_the_precise_plain_text() -> None:
    for key, template in messages.CHEEKY.items():
        if key not in messages.INFO_KEYS:
            assert "{plain}" in template, key


def test_plain_tone_never_jokes() -> None:
    for key, template in messages.PLAIN.items():
        assert "dummkopf!" not in template.lower(), key
        assert "Dummkopf" not in template.replace("dummkopf.toml", ""), key


def test_cheeky_uses_no_extra_parameters() -> None:
    for key, template in messages.CHEEKY.items():
        assert fields(template) - {"plain"} <= fields(messages.PLAIN[key]), key


@pytest.mark.parametrize(
    "key, params",
    [
        ("path_denied", {}),
        ("no_results", {}),
        ("sync_ok", {}),
        ("version_conflict", {"rev": "abc123abc123"}),
    ],
)
def test_tone_switch(key: str, params: dict[str, object]) -> None:
    plain = messages.text(key, "plain", **params)
    cheeky = messages.text(key, "cheeky", **params)
    assert "Dummkopf" not in plain
    assert plain != cheeky
    assert "Dummkopf" in cheeky or key == "sync_ok"


def test_brief_examples() -> None:
    assert messages.text("no_results", "cheeky").endswith("Even a Dummkopf knows when it doesn't know.")
    assert messages.text("sync_ok", "cheeky") == "Brain synced."
    conflict = messages.text("version_conflict", "cheeky", rev="abc123abc123")
    assert conflict.startswith("Someone else touched this note. Read it again, Dummkopf.")
    assert "rev=abc123abc123" in conflict


def test_denied_path_does_not_reveal_whether_it_is_sensitive_or_missing() -> None:
    for tone in ("plain", "cheeky"):
        assert "sensitive" not in messages.text("path_denied", tone).lower()


def test_unknown_tone_falls_back_to_plain() -> None:
    assert messages.text("no_results", "unknown") == messages.text("no_results", "plain")


def test_missing_message_key_is_a_programming_error() -> None:
    with pytest.raises(KeyError):
        messages.text("does-not-exist", "plain")


def test_errors_render_plain_by_default_and_by_tone_on_request() -> None:
    error = AccessDenied("path_denied")
    assert str(error) == messages.text("path_denied", "plain")
    assert messages.error_text(error, "cheeky") == messages.text("path_denied", "cheeky")
    assert isinstance(error, DummkopfError)
    assert error.exit_code == 2
    assert Rejected("search_needs_term").exit_code == 2


def test_every_template_formats_with_its_own_fields() -> None:
    for key, template in messages.PLAIN.items():
        template.format(**{name: "x" for name in fields(template)})
        if key in messages.CHEEKY:
            messages.text(key, "cheeky", **{name: "x" for name in fields(template)})
