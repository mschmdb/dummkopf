"""The small YAML subset dummkopf reads and writes: scalars, inline lists, block lists.

No dependency on a YAML library. Values are strings or lists of strings.
"""

from __future__ import annotations

import re

SUMMARY_MAX = 160
KEY_RE = re.compile(r"^([A-Za-z0-9_.\-]+)\s*:\s*(.*)$")
ITEM_RE = re.compile(r"^\s*-\s+(.*)$")

Value = str | list[str]
Data = dict[str, Value]


def _unescape(text: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            out.append({"n": "\n", "t": "\t"}.get(text[i + 1], text[i + 1]))
            i += 2
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _unquote(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        return _unescape(raw[1:-1])
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        return raw[1:-1].replace("''", "'")
    return raw


def _split_inline(raw: str) -> list[str]:
    items: list[str] = []
    current = ""
    quote: str | None = None
    i = 0
    while i < len(raw):
        char = raw[i]
        if quote:
            if char == "\\" and quote == '"' and i + 1 < len(raw):
                current += char + raw[i + 1]
                i += 2
                continue
            current += char
            if char == quote:
                quote = None
        elif char in "\"'":
            quote = char
            current += char
        elif char == ",":
            items.append(current)
            current = ""
        else:
            current += char
        i += 1
    items.append(current)
    return [_unquote(item) for item in items if item.strip()]


def _needs_quotes(value: str, inline: bool = False) -> bool:
    if value == "" or value != value.strip():
        return True
    if value[0] in "-?:,[]{}#&*!|>%@`'\"":
        return True
    triggers = (":", "#", '"', "'", "\n", "\\") + ((",", "[", "]", "{", "}") if inline else ())
    return any(char in value for char in triggers)


def dump_scalar(value: str, inline: bool = False) -> str:
    """inline=True: the value sits in a `[a, b]` list, where a comma separates items."""
    if _needs_quotes(value, inline):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")
        return '"' + escaped + '"'
    return value


def dump_frontmatter(data: Data) -> str:
    lines = ["---"]
    for key, value in data.items():
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(dump_scalar(item, inline=True) for item in value)}]")
        else:
            lines.append(f"{key}: {dump_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def _parse_block(lines: list[str]) -> Data:
    data: Data = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        match = KEY_RE.match(line)
        if not match:
            i += 1
            continue
        key, raw = match.group(1), match.group(2).strip()
        if raw == "":
            items: list[str] = []
            j = i + 1
            while j < len(lines) and (item := ITEM_RE.match(lines[j])):
                items.append(_unquote(item.group(1)))
                j += 1
            if items:
                data[key] = items
                i = j
                continue
            data[key] = ""
        elif raw.startswith("[") and raw.endswith("]"):
            data[key] = _split_inline(raw[1:-1])
        else:
            data[key] = _unquote(raw)
        i += 1
    return data


def parse_frontmatter(text: str) -> tuple[Data, str, bool]:
    """Return (data, body, had_frontmatter). The body stays byte-identical."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text, False
    end = next((i for i in range(1, len(lines)) if lines[i].strip() in ("---", "...")), None)
    if end is None:
        return {}, text, False
    return _parse_block(lines[1:end]), "\n".join(lines[end + 1:]), True


def shorten(text: str, limit: int = SUMMARY_MAX) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    space = cut.rfind(" ")
    if space > 0:
        cut = cut[:space]
    return cut.rstrip() + "…"
