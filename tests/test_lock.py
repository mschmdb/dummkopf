from __future__ import annotations

from pathlib import Path

import pytest

from dummkopf.errors import DummkopfError
from dummkopf.lock import repository_lock


def test_exclusive_lock_blocks_a_second_writer(tmp_path: Path) -> None:
    with repository_lock(tmp_path), pytest.raises(DummkopfError) as caught, \
            repository_lock(tmp_path, timeout=0.1):
        pass
    assert caught.value.key == "busy"


def test_shared_locks_coexist(tmp_path: Path) -> None:
    with repository_lock(tmp_path, shared=True), repository_lock(tmp_path, shared=True, timeout=0.1):
        pass


def test_shared_lock_blocks_writer(tmp_path: Path) -> None:
    with repository_lock(tmp_path, shared=True), pytest.raises(DummkopfError), \
            repository_lock(tmp_path, timeout=0.1):
        pass


def test_lock_is_released(tmp_path: Path) -> None:
    with repository_lock(tmp_path):
        pass
    with repository_lock(tmp_path, timeout=0.1):
        pass


def test_different_brains_do_not_block_each_other(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    with repository_lock(tmp_path / "a"), repository_lock(tmp_path / "b", timeout=0.1):
        pass
