"""Write and maintenance commands for the CLI."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from dummkopf.config import Config

Handler = Callable[[argparse.Namespace, Config, str], int]
NoConfigHandler = Callable[[argparse.Namespace, Path, str], int]
Adder = Callable[[str], argparse.ArgumentParser]
OptionAdder = Callable[[argparse.ArgumentParser], None]

HANDLERS: dict[str, Handler] = {}
HANDLERS_WITHOUT_CONFIG: dict[str, NoConfigHandler] = {}


def register(sub: argparse._SubParsersAction[argparse.ArgumentParser], add: Adder,
             access_options: OptionAdder, output_options: OptionAdder) -> None:
    del sub, add, access_options, output_options
