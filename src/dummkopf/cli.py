"""Command line entry point: `dummkopf` and its alias `dk`.

Exit codes: 0 ok, 2 rejected call (nothing changed), 3 saved but Git sync failed.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from dummkopf import commands
from dummkopf.access import Access
from dummkopf.config import Config, find_root, load_config
from dummkopf.errors import DummkopfError, Rejected
from dummkopf.lock import repository_lock
from dummkopf.messages import HELP, error_text
from dummkopf.render import bounded
from dummkopf.search import Packet, body_start, context_packet, find, heading_range, source_hit

MAX_CHARS_RANGE = (500, 20000)
LIMIT_RANGE = (1, 10)
NO_CONFIG_COMMANDS = ("init",)

Handler = Callable[[argparse.Namespace, Config, str], int]


def common_options(top_level: bool) -> argparse.ArgumentParser:
    """--root and --serious work before and after the subcommand."""
    options = argparse.ArgumentParser(add_help=False)
    extra: dict[str, object] = {} if top_level else {"default": argparse.SUPPRESS}
    options.add_argument("--root", metavar="PATH", help=HELP["root"], **extra)  # type: ignore[arg-type]
    options.add_argument("--serious", action="store_true", help=HELP["serious"], **extra)  # type: ignore[arg-type]
    return options


def access_options(command: argparse.ArgumentParser) -> None:
    command.add_argument("--scope", metavar="SCOPE", help=HELP["scope"])
    command.add_argument("--topic", help=HELP["topic"])
    command.add_argument("--allow-sensitive", action="append", default=[], metavar="PATH",
                         help=HELP["allow_sensitive"])


def output_options(command: argparse.ArgumentParser) -> None:
    command.add_argument("--json", action="store_true", help=HELP["json"])
    command.add_argument("--max-chars", type=int, default=None, help=HELP["max_chars"])


def add_command(sub: argparse._SubParsersAction[argparse.ArgumentParser], name: str,
                epilog: str) -> argparse.ArgumentParser:
    return sub.add_parser(name, epilog=epilog, parents=[common_options(top_level=False)],
                          formatter_class=argparse.RawDescriptionHelpFormatter)


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(prog="dummkopf", description=HELP["prog"], epilog=HELP["epilog"],
                                      parents=[common_options(top_level=True)])
    sub = command.add_subparsers(dest="command", required=True)
    for name in ("context", "find", "read"):
        action = add_command(sub, name, HELP["ex_" + name])
        if name == "read":
            action.add_argument("path", help=HELP["path"])
        else:
            action.add_argument("query", help=HELP["query"])
        access_options(action)
        output_options(action)
        if name == "find":
            action.add_argument("--limit", type=int, default=None, help=HELP["limit"])
        elif name == "read":
            action.add_argument("--start", type=int, help=HELP["start"])
            action.add_argument("--end", type=int, help=HELP["end"])
            action.add_argument("--section", help=HELP["section"])
    commands.register(sub, lambda name: add_command(sub, name, HELP["ex_" + name]),
                      access_options, output_options)
    return command


def check_range(value: int, bounds: tuple[int, int], key: str) -> None:
    if not bounds[0] <= value <= bounds[1]:
        raise Rejected(key, low=bounds[0], high=bounds[1])


def run_read(args: argparse.Namespace, config: Config, tone: str) -> int:
    with repository_lock(config.root, shared=True, timeout=config.limits.lock_timeout_s):
        access = Access(config, args.scope, args.topic, args.allow_sensitive)
        packet: Packet
        if args.command == "context":
            packet = context_packet(access, args.query)
        elif args.command == "find":
            limit = config.limits.find_limit if args.limit is None else args.limit
            check_range(limit, LIMIT_RANGE, "limit_range")
            packet = find(access, args.query, limit)
        else:
            if ((args.start is not None and args.start < 1)
                    or (args.end is not None and args.end < (args.start or 1))):
                raise Rejected("bad_line_range")
            if args.section is not None and (args.start is not None or args.end is not None):
                raise Rejected("section_with_range")
            note = access.read(args.path)
            end = args.end if args.end is not None else len(note.text.splitlines())
            start = args.start
            if start is None:
                first = body_start(note)
                start = first if args.end is None or args.end >= first else 1
            if args.section is not None:
                start, end = heading_range(note.text, args.section)
            packet = Packet(hits=[source_hit(note, start, end)], match="direct", more=False, truncated=False)
        sys.stdout.write(bounded(packet, args.max_chars, args.json, tone))
    return 0


def handlers() -> dict[str, Handler]:
    table: dict[str, Handler] = {"context": run_read, "find": run_read, "read": run_read}
    table.update(commands.HANDLERS)
    return table


def main(argv: Sequence[str] | None = None, root: Path | None = None) -> int:
    args = parser().parse_args(argv)
    tone = "plain" if args.serious else "cheeky"
    try:
        explicit = root or (Path(args.root) if args.root else None)
        if args.command in NO_CONFIG_COMMANDS:
            return commands.HANDLERS_WITHOUT_CONFIG[args.command](args, explicit or Path.cwd(), tone)
        config = load_config(find_root(Path.cwd(), explicit))
        if not args.serious:
            tone = config.ui.tone
        if getattr(args, "max_chars", None) is None and hasattr(args, "max_chars"):
            args.max_chars = config.limits.max_chars
        if hasattr(args, "max_chars"):
            check_range(args.max_chars, MAX_CHARS_RANGE, "max_chars_range")
        return handlers()[args.command](args, config, tone)
    except DummkopfError as error:
        sys.stderr.write(error_text(error, tone) + "\n")
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
