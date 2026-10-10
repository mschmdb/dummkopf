"""Exceptions carry a message key; the CLI renders them in the configured tone."""

from __future__ import annotations

from dummkopf import messages


class DummkopfError(Exception):
    """A rejected call. Exit code 2 unless a subclass says otherwise."""

    exit_code = 2

    def __init__(self, key: str, /, **params: object) -> None:
        self.key = key
        self.params = params
        super().__init__(key)

    def __str__(self) -> str:
        return messages.text(self.key, "plain", **self.params)


class AccessDenied(DummkopfError):
    """Never reveal a path, a sensitivity flag or source text."""


class Rejected(DummkopfError):
    """Input or state violates a rule; nothing was written."""


class SyncError(DummkopfError):
    """Git sync failed; never echo raw Git output, it may contain note text."""


class ConfigError(DummkopfError):
    """dummkopf.toml is unreadable or invalid."""


class ConfigMissing(ConfigError):
    """No dummkopf.toml was found."""
