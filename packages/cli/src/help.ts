/**
 * Help layout for agents that read top-down: usage, a one-line purpose, examples, then options grouped
 * by meaning. Every option sits on one line; long descriptions wrap under their column.
 */

import { HELP } from "@rcllr/core";

/** Help text width; fixed, so agents and tests see the same layout in any terminal. */
export const WIDTH = 100;
const MAX_NAME = 24;

export type Group = "access" | "output" | "options" | "global";
export const GROUPS: readonly Group[] = ["access", "output", "options", "global"];

export interface HelpOption {
  readonly flags: readonly string[];
  readonly kind: "value" | "flag" | "append";
  readonly help: string;
  readonly metavar?: string;
  readonly type?: "int";
  readonly choices?: readonly string[];
  readonly required?: boolean;
  readonly group: Group;
}

export interface HelpPositional {
  readonly dest: string;
  readonly help: string;
  readonly nargs?: "?" | "*";
}

export interface HelpCommand {
  readonly name: string;
  readonly purpose: string;
  readonly group: string;
}

/** What one page shows; `commands` is set for the top level only. */
export interface Page {
  readonly prog: string;
  readonly purpose: string;
  readonly examples: string;
  readonly notes: string;
  readonly options: readonly HelpOption[];
  readonly positionals: readonly HelpPositional[];
  readonly commands: readonly HelpCommand[];
  /** The top level lists --version. */
  readonly version?: boolean;
}

/** `N` for numbers, `a|b` for choices, else the explicit metavar or the long flag in upper case. */
export function metavar(option: HelpOption): string {
  if (option.metavar !== undefined) return option.metavar;
  if (option.choices) return option.choices.join("|");
  if (option.type === "int") return "N";
  const long = option.flags.find((flag) => flag.startsWith("--")) ?? option.flags[0]!;
  return long.replace(/^-+/, "").replace(/-/g, "_").toUpperCase();
}

export function optionName(option: HelpOption): string {
  return option.flags.map((flag) => option.kind === "flag" ? flag : flag + " " + metavar(option)).join(", ");
}

export function positionalName(positional: HelpPositional): string {
  const name = "<" + positional.dest + ">";
  return positional.nargs === "?" ? "[" + name + "]" : positional.nargs === "*" ? "[" + name + "...]" : name;
}

export function usage(page: Page): string {
  if (page.commands.length > 0) {
    const globals = page.options.filter((option) => option.group === "global").map((option) => "[" + optionName(option) + "]");
    return "usage: " + [page.prog, ...globals, "<command> ..."].join(" ");
  }
  const required = page.options.filter((option) => option.required).map(optionName);
  return "usage: " + [page.prog, ...page.positionals.map(positionalName), ...required, "[options]"].join(" ");
}

/** Greedy word wrap after collapsing whitespace. */
export function fill(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : line + " " + word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function rows(entries: readonly [string, string][], column: number): string[] {
  return entries.flatMap(([name, help]) => {
    const start = Math.max(column, 2 + name.length + 2);
    const [first = "", ...rest] = fill(help, WIDTH - start);
    return [("  " + name).padEnd(start) + first, ...rest.map((line) => " ".repeat(start) + line)].map((line) => line.trimEnd());
  });
}

function block(lines: readonly string[]): string[] {
  return lines.map((line) => line === "" ? "" : "  " + line);
}

/** The full help page. */
export function render(page: Page): string {
  const sections: [string, [string, string][]][] = [];
  if (page.commands.length > 0) {
    for (const group of [...new Set(page.commands.map((command) => command.group))]) {
      const entries = page.commands.filter((command) => command.group === group);
      sections.push([HELP["group_" + group]!, entries.map((command) => [command.name, command.purpose])]);
    }
  } else if (page.positionals.length > 0) {
    sections.push([HELP.group_arguments!, page.positionals.map((positional) => [positionalName(positional), positional.help])]);
  }
  for (const group of GROUPS) {
    const entries: [string, string][] = page.options.filter((option) => option.group === group)
      .map((option) => [optionName(option), option.required ? HELP.required! + " " + option.help : option.help]);
    if (group === "global") entries.push(["-h, --help", HELP.help!]);
    if (group === "global" && page.version) entries.push(["--version", HELP.version!]);
    if (entries.length > 0) sections.push([HELP["group_" + group]!, entries]);
  }
  const longest = Math.max(...sections.flatMap(([, entries]) => entries.map(([name]) => name.length)));
  const column = 2 + Math.min(longest, MAX_NAME) + 2;
  const lines = [usage(page), "", ...fill(page.purpose, WIDTH), ""];
  if (page.examples) lines.push(HELP.group_examples + ":", ...block(page.examples.split("\n")), "");
  for (const [heading, entries] of sections) lines.push(heading + ":", ...rows(entries, column), "");
  if (page.notes) lines.push(HELP.group_notes + ":", ...block(page.notes.split("\n")), "");
  if (page.commands.length > 0) lines.push(HELP.footer!, "");
  return lines.slice(0, -1).join("\n") + "\n";
}
