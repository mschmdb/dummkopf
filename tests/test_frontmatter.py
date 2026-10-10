from __future__ import annotations

from dummkopf.frontmatter import dump_frontmatter, dump_scalar, parse_frontmatter, shorten


def test_parse_scalar() -> None:
    data, body, had = parse_frontmatter("---\nscope: work\n---\n\n# Title\n")
    assert had
    assert data["scope"] == "work"
    assert body == "\n# Title\n"


def test_parse_without_frontmatter() -> None:
    data, body, had = parse_frontmatter("# Title\n\nText\n")
    assert not had
    assert data == {}
    assert body == "# Title\n\nText\n"


def test_unclosed_frontmatter_is_body() -> None:
    text = "---\nscope: work\n# Title\n"
    assert parse_frontmatter(text) == ({}, text, False)


def test_parse_inline_list() -> None:
    data, _, _ = parse_frontmatter('---\naliases: [a, b, "c, d"]\n---\n')
    assert data["aliases"] == ["a", "b", "c, d"]


def test_parse_empty_inline_list() -> None:
    data, _, _ = parse_frontmatter("---\nperiod: []\n---\n")
    assert data["period"] == []


def test_parse_block_list() -> None:
    data, _, _ = parse_frontmatter("---\nrelated:\n  - docs/a.md\n  - docs/b.md\n---\n")
    assert data["related"] == ["docs/a.md", "docs/b.md"]


def test_empty_value_without_items_is_empty_string() -> None:
    data, _, _ = parse_frontmatter("---\nsummary:\nscope: work\n---\n")
    assert data == {"summary": "", "scope": "work"}


def test_parse_quoted_with_colon() -> None:
    data, _, _ = parse_frontmatter('---\nsummary: "a: b"\n---\n')
    assert data["summary"] == "a: b"


def test_parse_single_quotes() -> None:
    data, _, _ = parse_frontmatter("---\nsummary: 'it''s'\n---\n")
    assert data["summary"] == "it's"


def test_parse_unquoted_url() -> None:
    data, _, _ = parse_frontmatter("---\nsource: https://example.org/a\n---\n")
    assert data["source"] == "https://example.org/a"


def test_comments_and_garbage_lines_are_skipped() -> None:
    data, _, _ = parse_frontmatter("---\n# comment\nnot a key\nscope: work\n---\n")
    assert data == {"scope": "work"}


def test_dump_quoting() -> None:
    assert dump_scalar("work") == "work"
    assert dump_scalar("a: b") == '"a: b"'
    assert dump_scalar("x # y") == '"x # y"'
    assert dump_scalar('says "hi"') == '"says \\"hi\\""'
    assert dump_scalar("- leading") == '"- leading"'
    assert dump_scalar("") == '""'
    assert dump_scalar(" padded") == '" padded"'
    assert dump_scalar("a, b") == "a, b"
    assert dump_scalar("a, b", inline=True) == '"a, b"'


def test_roundtrip_special_characters() -> None:
    original: dict[str, str | list[str]] = {
        "key_fact": 'As of 08/2026: **live**, "test" # 1 | two',
        "aliases": ["a, b", "c"],
        "period": [],
        "note": "back\\slash and\nnewline",
    }
    text = dump_frontmatter(original) + "\nBody\n"
    data, body, had = parse_frontmatter(text)
    assert had
    assert data == original
    assert body == "\nBody\n"


def test_dump_keeps_key_order() -> None:
    assert dump_frontmatter({"b": "1", "a": ["x"]}) == "---\nb: 1\na: [x]\n---\n"


def test_shorten_keeps_short_text() -> None:
    assert shorten("Short key fact") == "Short key fact"


def test_shorten_cuts_at_word_boundary() -> None:
    text = ("word " * 60).strip()
    out = shorten(text)
    assert len(out) <= 160
    assert out.endswith("…")
    assert not out[:-1].endswith(" ")
    assert text.startswith(out[:-1])


def test_shorten_exact_limit_and_custom_limit() -> None:
    assert shorten("a" * 160) == "a" * 160
    assert shorten("a" * 30, limit=20) == "a" * 19 + "…"
