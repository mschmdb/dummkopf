"""Save validated packets atomically; on a write error, roll back our own changes."""

from __future__ import annotations

import contextlib
import hashlib
import os
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import TypedDict

from dummkopf.access import Access
from dummkopf.errors import AccessDenied, Rejected, SyncError
from dummkopf.links import Issue, link_issues
from dummkopf.lock import repository_lock
from dummkopf.sync import prepare_repository, sync_locked
from dummkopf.validate import Change, Plan, metadata_issues, validate_packet

NEW_FILE_MODE = 0o600


class WriteResult(TypedDict):
    changed: list[str]
    unchanged: list[str]
    revisions: dict[str, str]
    issues: list[Issue]
    saved: bool
    sync: str


class CheckResult(TypedDict):
    checked: int
    issues: list[Issue]
    ok: bool


def report(plan: Plan) -> WriteResult:
    changed = [change.note.path for change in plan.changes
               if change.previous is None or change.note.text != change.previous.text]
    return WriteResult(changed=changed,
                       unchanged=[change.note.path for change in plan.changes if change.note.path not in changed],
                       revisions={change.note.path: change.note.revision for change in plan.changes},
                       issues=plan.issues, saved=False, sync="not-run")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    mode = path.stat().st_mode & 0o777 if path.exists() else NEW_FILE_MODE
    descriptor, name = tempfile.mkstemp(prefix=".dummkopf-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def rollback(access: Access, written: list[Change], created_dirs: list[Path]) -> bool:
    """Undo our writes. False if a foreign change made a full rollback impossible."""
    complete = True
    for change in reversed(written):
        path = access.root / change.note.path
        try:
            if digest(path) != change.note.revision:
                complete = False
                continue
            if change.previous:
                atomic_write(path, change.previous.text.encode("utf-8"))
            else:
                path.unlink()
        except OSError:
            complete = False
    for directory in reversed(created_dirs):
        with contextlib.suppress(OSError):
            directory.rmdir()
    return complete


def apply_plan(access: Access, plan: Plan) -> None:
    written: list[Change] = []
    created_dirs: list[Path] = []
    try:
        for change in plan.changes:
            note, previous = change.note, change.previous
            if previous and previous.text == note.text:
                continue
            path = access.resolve(note.path, allow_new=True)
            if path.exists():
                changed_meanwhile = previous is None or digest(path) != previous.revision
            else:
                changed_meanwhile = previous is not None
            if changed_meanwhile:
                raise Rejected("write_race")
            missing: list[Path] = []
            parent = path.parent
            while not parent.exists():
                missing.append(parent)
                parent = parent.parent
            for directory in reversed(missing):
                directory.mkdir()
                created_dirs.append(directory)
            access.resolve(note.path, allow_new=True)
            atomic_write(path, note.text.encode("utf-8"))
            written.append(change)
    except (OSError, Rejected, AccessDenied) as error:
        if not rollback(access, written, created_dirs):
            raise Rejected("rollback_failed") from error
        raise Rejected("not_saved") from error


def ingest(access: Access, packet: object, dry_run: bool = False, sync: bool = True) -> WriteResult:
    config = access.config
    with repository_lock(config.root, timeout=config.limits.lock_timeout_s):
        if sync and not dry_run:
            prepare_repository(config)
            # The remote may have changed markers and scopes; read them again.
            access = Access(config, access.scope, access.topic, access.allowed)
        plan = validate_packet(access, packet)
        result = report(plan)
        if dry_run:
            return result
        apply_plan(access, plan)
        result["saved"] = True
        result["sync"] = "pending"
        if sync:
            try:
                sync_locked(config)
                result["sync"] = "ok"
                refreshed = Access(config, access.scope, access.topic, access.allowed)
                result["revisions"] = {change.note.path: refreshed.read(change.note.path).revision
                                       for change in plan.changes}
            except SyncError:
                result["sync"] = "failed"
        return result


def check(access: Access, paths: Sequence[str] | None = None) -> CheckResult:
    problems: list[Issue] = []
    checked = 0
    for path in paths if paths is not None else access.paths():
        try:
            note = access.read(path)
        except AccessDenied:
            if paths is not None:
                raise
            continue
        checked += 1
        problems.extend(metadata_issues(note, access.config))
        # Report existing dead links; this is not a write request.
        problems.extend(link_issues(access, note, {}, note))
    return CheckResult(checked=checked, issues=problems,
                       ok=not any(problem["severity"] == "error" for problem in problems))
