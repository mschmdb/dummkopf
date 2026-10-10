"""Setup and maintenance commands: init, install, hook, meta."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path

from dummkopf.config import LOCALES, Config, find_root, load_config
from dummkopf.errors import DummkopfError
from dummkopf.hook import agent_event, pre_commit
from dummkopf.install import install
from dummkopf.messages import HELP
from dummkopf.messages import text as say
from dummkopf.meta import generate, migrate, report
from dummkopf.scaffold import init
from dummkopf.sensitive import Sensitivity


def register(adder: Callable[[str], argparse.ArgumentParser]) -> None:
    command = adder("init")
    command.add_argument("path", nargs="?", default=None, help=HELP["init_path"])
    command.add_argument("--remote", help=HELP["init_remote"])
    command.add_argument("--locale", choices=LOCALES, default="en", help=HELP["init_locale"])
    adder("install")
    command = adder("hook")
    command.add_argument("kind", choices=("pre-commit", "agent"), help=HELP["hook_kind"])
    command = adder("meta")
    command.add_argument("action", choices=("migrate", "generate", "report", "index"), help=HELP["meta_action"])
    command.add_argument("--dry-run", action="store_true", help=HELP["dry_run"])
    command.add_argument("--only", action="append", default=[], metavar="PATH", help=HELP["meta_only"])
    command.add_argument("--max-age", type=int, default=None, help=HELP["meta_max_age"])


def run_init(args: argparse.Namespace, root: Path, tone: str) -> int:
    target = Path(args.path) if args.path else root
    created = init(target, args.remote, args.locale)
    sys.stdout.write(say("out_init", tone, path=str(created)) + "\n")
    return 0


def run_hook(args: argparse.Namespace, root: Path, tone: str) -> int:
    """Hooks must never return 2: Claude Code treats exit 2 as a blocking error."""
    del tone
    try:
        config = load_config(find_root(Path.cwd(), root))
    except DummkopfError:
        return 0
    if args.kind == "pre-commit":
        return pre_commit(config)
    try:
        event = json.loads(sys.stdin.read())
    except (ValueError, UnicodeError):
        return 0
    return agent_event(event, config)


def run_install(args: argparse.Namespace, config: Config, tone: str) -> int:
    del args
    for path in install(config):
        sys.stdout.write(say("out_installed", tone, what=path) + "\n")
    return 0


def run_meta(args: argparse.Namespace, config: Config, tone: str) -> int:
    if args.action == "report":
        sys.stdout.write(report(config, args.max_age) + "\n")
        return 0
    changed: list[str] = []
    if args.action == "migrate":
        changed = migrate(config, dry_run=args.dry_run, only=args.only or None)
    else:
        if args.action == "index" and not args.dry_run:
            paths_file = config.root / config.sensitive.paths_file
            fresh = Sensitivity.generate(config)
            if not paths_file.is_file() or paths_file.read_text(encoding="utf-8") != fresh:
                paths_file.write_text(fresh, encoding="utf-8")
                paths_file.chmod(0o600)
                changed.append(config.sensitive.paths_file)
        changed += generate(config, dry_run=args.dry_run)
    for path in changed:
        sys.stdout.write(path + "\n")
    sys.stderr.write(say("out_index_changed", tone, count=len(changed)) + "\n")
    return 0
