"""One process lock per brain, shared by readers, write packages and Git sync. POSIX only."""

from __future__ import annotations

import fcntl
import hashlib
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from dummkopf.errors import DummkopfError


def lock_path(root: Path) -> Path:
    name = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / ("dummkopf-" + name + ".lock")


@contextmanager
def repository_lock(root: Path, shared: bool = False, timeout: float = 10) -> Iterator[None]:
    mode = fcntl.LOCK_SH if shared else fcntl.LOCK_EX
    deadline = time.monotonic() + timeout
    with lock_path(root).open("a") as handle:
        while True:
            try:
                fcntl.flock(handle, mode | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise DummkopfError("busy") from None
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
