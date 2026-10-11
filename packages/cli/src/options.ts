/** Options shared by several commands. */

import { HELP, Rejected } from "@dummkopf/core";

import type { Parser } from "./argparse.ts";

export const MAX_CHARS_RANGE: readonly [number, number] = [500, 20000];
export const LIMIT_RANGE: readonly [number, number] = [1, 10];

/** --root and --serious work before and after the subcommand. */
export function commonOptions(command: Parser, topLevel: boolean): void {
  command.option("--root", { metavar: "PATH", group: "global", help: HELP.root!, suppress: !topLevel });
  command.option("--serious", { kind: "flag", group: "global", help: HELP.serious!, suppress: !topLevel });
}

export function accessOptions(command: Parser): void {
  command.option("--scope", { metavar: "SCOPE", group: "access", help: HELP.scope! });
  command.option("--topic", { group: "access", help: HELP.topic! });
  command.option("--allow-sensitive", { kind: "append", metavar: "PATH", group: "access", help: HELP.allow_sensitive! });
}

export function outputOptions(command: Parser): void {
  command.option("--json", { kind: "flag", group: "output", help: HELP.json! });
  command.option("--max-chars", { type: "int", group: "output", help: HELP.max_chars! });
}

export function checkRange(value: number, bounds: readonly [number, number], key: string): void {
  if (!(bounds[0] <= value && value <= bounds[1])) throw new Rejected(key, { low: bounds[0], high: bounds[1] });
}
