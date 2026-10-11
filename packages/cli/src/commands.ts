/** Write and maintenance commands: write, ingest, check, sync. Port of commands.py. */

import type { Config } from "@dummkopf/core";

import type { Namespace, Parser } from "./argparse.ts";

export const EXIT_SYNC_FAILED = 3;

export function register(add: (name: string) => Parser): void {
  void add;
}

export function run(args: Namespace, config: Config, tone: string): number {
  void args;
  void config;
  void tone;
  throw new Error("not implemented: write commands");
}
