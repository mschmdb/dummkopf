"""Setup and maintenance commands: init, install, hook, meta."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path

from dummkopf.config import LOCALES, Config, find_root, load_config
from dummkopf.errors import DummkopfError
from dummkopf.extras import curator, links
from dummkopf.extras.common import require
from dummkopf.files import write_generated
from dummkopf.hook import agent_event, pre_commit
from dummkopf.install import install
from dummkopf.messages import HELP
from dummkopf.messages import text as say
from dummkopf.meta import generate, migrate, report
from dummkopf.scaffold import init, render_agents
from dummkopf.scopes import read_raw
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
    command.add_argument("action", choices=("migrate", "generate", "report", "index", "agents"),
                         help=HELP["meta_action"])
    command.add_argument("--dry-run", action="store_true", help=HELP["dry_run"])
    command.add_argument("--only", action="append", default=[], metavar="PATH", help=HELP["meta_only"])
    command.add_argument("--max-age", type=int, default=None, help=HELP["meta_max_age"])
    command.add_argument("--scope", metavar="SCOPE", help=HELP["scope"])
    command = adder("links")
    command.add_argument("--out", default=None, metavar="PATH", help=HELP["links_out"])
    command.add_argument("--min-topics", type=int, default=None, help=HELP["links_min"])
    command.add_argument("--scope", metavar="SCOPE", help=HELP["scope"])
    command.add_argument("--json", action="store_true", help=HELP["extra_json"])
    command = adder("curator")
    command.add_argument("--open-days", type=int, default=None, help=HELP["curator_open"])
    command.add_argument("--stale-days", type=int, default=None, help=HELP["curator_stale"])
    command.add_argument("--prompt", action="store_true", help=HELP["curator_prompt"])
    command.add_argument("--scope", metavar="SCOPE", help=HELP["scope"])
    command.add_argument("--json", action="store_true", help=HELP["extra_json"])


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
        sys.stdout.write(report(config, args.max_age, scope=args.scope) + "\n")
        return 0
    if args.action == "agents":
        sys.stdout.write(render_agents(config))
        return 0
    changed: list[str] = []
    if args.action == "migrate":
        changed = migrate(config, dry_run=args.dry_run, only=args.only or None)
    else:
        if args.action == "index" and not args.dry_run:
            paths_file = config.root / config.sensitive.paths_file
            fresh = Sensitivity.generate(config)
            current = read_raw(paths_file)
            if current != fresh and write_generated(paths_file, fresh, 0o600):
                changed.append(config.sensitive.paths_file)
        changed += generate(config, dry_run=args.dry_run)
    for path in changed:
        sys.stdout.write(path + "\n")
    sys.stderr.write(say("out_index_changed", tone, count=len(changed)) + "\n")
    return 0


def run_links(args: argparse.Namespace, config: Config, tone: str) -> int:
    if args.json:
        report_data = links.build(config, args.min_topics, args.scope)
        sys.stdout.write(json.dumps(report_data, ensure_ascii=False, indent=2) + "\n")
        return 0
    path = links.write_links(config, args.out, args.min_topics, args.scope)
    sys.stdout.write(say("out_written", tone, path=path.relative_to(config.root).as_posix()) + "\n")
    return 0


def run_curator(args: argparse.Namespace, config: Config, tone: str) -> int:
    del tone
    if args.prompt:
        require(config, "curator")
        sys.stdout.write(curator.prompt(config))
        return 0
    result = curator.scan(config, args.open_days, args.stale_days, args.scope)
    if args.json:
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    else:
        sys.stdout.write(curator.render_markdown(result))
    return 0
