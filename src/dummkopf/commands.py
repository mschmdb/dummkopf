"""Write and maintenance commands: write, ingest, check, sync."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from dummkopf.access import Access
from dummkopf.config import Config
from dummkopf.errors import Rejected
from dummkopf.lock import repository_lock
from dummkopf.messages import HELP
from dummkopf.messages import text as say
from dummkopf.sync import sync_repository
from dummkopf.validate import validate_packet
from dummkopf.write import check, ingest, report

Handler = Callable[[argparse.Namespace, Config, str], int]
NoConfigHandler = Callable[[argparse.Namespace, Path, str], int]
Adder = Callable[[str], argparse.ArgumentParser]
OptionAdder = Callable[[argparse.ArgumentParser], None]

EXIT_SYNC_FAILED = 3


def register(sub: argparse._SubParsersAction[argparse.ArgumentParser], add: Adder,
             access_options: OptionAdder, output_options: OptionAdder) -> None:
    del sub
    for name in ("ingest", "write", "check", "sync"):
        action = add(name)
        if name == "write":
            action.add_argument("path", help=HELP["path"])
            action.add_argument("--expected", required=True, metavar="REV", help=HELP["expected"])
            action.add_argument("--append", action="store_true", help=HELP["append"])
        output_options(action)
        if name == "sync":
            continue
        action.add_argument("--input", default=None, metavar="PATH",
                            help=HELP["input_md"] if name == "write" else HELP["input_json"])
        access_options(action)
        if name in ("ingest", "write"):
            action.add_argument("--dry-run", action="store_true", help=HELP["dry_run"])
        else:
            action.add_argument("paths", nargs="*", help=HELP["check_paths"])


def read_input(path: str | None, limit: int) -> str:
    try:
        if path in (None, "-"):
            text = sys.stdin.read(limit + 1)
        else:
            with Path(str(path)).open(encoding="utf-8") as handle:
                text = handle.read(limit + 1)
    except (OSError, UnicodeError) as error:
        raise Rejected("input_unreadable") from error
    if len(text) > limit:
        raise Rejected("input_too_large")
    return text


def write_packet(args: argparse.Namespace, limit: int) -> dict[str, Any]:
    text = read_input(args.input, limit)
    entry: dict[str, Any] = {"path": args.path, "expected": None if args.expected == "new" else args.expected}
    entry["append" if args.append else "content"] = text
    return {"changes": [entry]}


def load_packet(path: str | None, limit: int) -> object:
    text = read_input(path, limit)
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise Rejected("json_unreadable", msg=error.msg, line=error.lineno, col=error.colno) from error


def output_result(value: dict[str, Any], as_json: bool, limit: int, tone: str) -> str:
    result = copy.deepcopy(value)

    def encode() -> str:
        if as_json:
            return json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
        lines: list[str] = []
        if "sync" in result:
            status = say("out_saved" if result["saved"] else "out_preview", tone)
            lines.append(say("out_write_status", tone, status=status, sync=result["sync"]))
            lines.extend(say("out_changed", tone, path=path) for path in result["changed"])
            lines.extend(say("out_unchanged", tone, path=path) for path in result["unchanged"])
        if "checked" in result:
            lines.append(say("out_checked", tone, count=result["checked"], status="ok" if result["ok"] else "error"))
        if result.get("status"):
            lines.append(say("sync_ok", tone))
        lines.extend(say("out_issue", tone, path=problem["path"], message=problem["message"],
                         severity=problem["severity"]) for problem in result.get("issues", []))
        if result.get("truncated"):
            lines.append(say("out_write_truncated", tone))
        return "\n".join(lines) + "\n"

    for key in ("changed", "unchanged", "issues", "revisions"):
        while len(encode()) > limit and result.get(key):
            result["truncated"] = True
            if isinstance(result[key], dict):
                result[key].popitem()
            else:
                result[key].pop()
    return encode()


def run(args: argparse.Namespace, config: Config, tone: str) -> int:
    limit = config.limits.max_input_chars
    code = 0
    result: dict[str, Any]
    if args.command == "sync":
        sync_repository(config, refresh_remote=True)
        result = {"status": "ok"}
    else:
        access = Access(config, args.scope, args.topic, args.allow_sensitive)
        if args.command in ("ingest", "write"):
            packet = load_packet(args.input, limit) if args.command == "ingest" else write_packet(args, limit)
            result = dict(ingest(access, packet, dry_run=args.dry_run))
            code = EXIT_SYNC_FAILED if result["sync"] == "failed" else 0
        else:
            if args.input and args.paths:
                raise Rejected("check_paths_or_input")
            with repository_lock(config.root, shared=True, timeout=config.limits.lock_timeout_s):
                if args.input:
                    result = dict(report(validate_packet(access, load_packet(args.input, limit))))
                else:
                    result = dict(check(access, args.paths or None))
                    code = 0 if result["ok"] else 2
    sys.stdout.write(output_result(result, args.json, args.max_chars, tone))
    if code == EXIT_SYNC_FAILED:
        sys.stderr.write(say("sync_failed_after_save", tone) + "\n")
    return code


def register_admin(add: Adder) -> None:
    from dummkopf import admin

    admin.register(add)


def handlers() -> tuple[dict[str, Handler], dict[str, NoConfigHandler]]:
    from dummkopf import admin

    with_config: dict[str, Handler] = {name: run for name in ("ingest", "write", "check", "sync")}
    with_config.update({"install": admin.run_install, "meta": admin.run_meta})
    return with_config, {"init": admin.run_init, "hook": admin.run_hook}
