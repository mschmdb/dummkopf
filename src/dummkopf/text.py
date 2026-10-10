"""Word tokens shared by search and routes."""

from __future__ import annotations

import re
import unicodedata


def words(value: str) -> list[str]:
    """Case- and accent-folded word tokens: `Straße Café` -> `strasse cafe`."""
    folded = "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                     if not unicodedata.combining(char))
    return re.findall(r"[^\W_]+", folded)
