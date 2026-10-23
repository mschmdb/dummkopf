/** Help layout and usage errors: purpose first, then examples, then options grouped by meaning. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox } from "./harness.ts";
import type { Result } from "./harness.ts";

const COMMANDS = ["context", "find", "read", "ingest", "write", "check", "sync", "init", "install", "import-memory", "migrate-name", "hook", "meta",
  "links", "curator"];
const WIDTH = 100;

function run(args: readonly string[]): Result {
  return new Sandbox().run(args);
}

/** The lines below a section heading, up to the next blank line. */
function section(out: string, heading: string): string[] {
  const all = out.split("\n");
  const start = all.indexOf(heading);
  assert.ok(start !== -1, "no section " + heading + " in:\n" + out);
  const end = all.indexOf("", start);
  return all.slice(start + 1, end === -1 ? undefined : end);
}

/** The entry lines of a section, without wrapped continuation lines. */
function entries(out: string, heading: string): string[] {
  return section(out, heading).filter((line) => /^ {2}\S/.test(line));
}

function positions(out: string, headings: readonly string[]): number[] {
  const all = out.split("\n");
  return headings.map((heading) => all.indexOf(heading));
}

function assertOrdered(out: string, headings: readonly string[]): void {
  const found = positions(out, headings);
  assert.ok(found.every((index) => index !== -1), "missing one of " + headings.join(", ") + " in:\n" + out);
  assert.deepEqual([...found].sort((a, b) => a - b), found, "order of " + headings.join(", ") + " in:\n" + out);
}

// --- top level ---------------------------------------------------------------------------------------------------

test("top-level help: usage, purpose, commands, global options, pointer", () => {
  const result = run(["--help"]);
  assert.equal(result.code, 0);
  const lines = result.out.split("\n");
  assert.equal(lines[0], "usage: rcllr [--root PATH] [--serious] <command> ...");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "Long-term memory for coding agents, kept in a Git repo of Markdown notes.");
  assertOrdered(result.out, ["Read:", "Write:", "Setup and maintenance:", "Extras:", "Global options:"]);
  const listed = ["Read:", "Write:", "Setup and maintenance:", "Extras:"]
    .flatMap((heading) => entries(result.out, heading)).map((line) => line.trim().split(/\s+/)[0]);
  assert.deepEqual([...listed].sort(), [...COMMANDS].sort());
  assert.ok(section(result.out, "Read:").some((line) => /^ {2}find {2,}Keyword search/.test(line)), result.out);
  const global = section(result.out, "Global options:");
  assert.ok(global.some((line) => /^ {2}--root PATH {2,}\S/.test(line)), result.out);
  assert.ok(global.some((line) => /^ {2}--serious {2,}\S/.test(line)), result.out);
  assert.ok(global.some((line) => line.startsWith("  -h, --help")), result.out);
  assert.ok(global.some((line) => /^ {2}--version {2,}\S/.test(line)), result.out);
  assert.equal(lines.filter((line) => line !== "").at(-1), "Details and examples: rcllr <command> --help");
});

test("--version prints the version and exits 0, at the top level only", () => {
  const result = run(["--version"]);
  assert.equal(result.code, 0);
  assert.match(result.out, /^rcllr \d+\.\d+\.\d+\S*\n$/);
  assert.equal(result.err, "");
  assert.equal(run(["--serious", "--version"]).out, result.out);
  assert.equal(run(["find", "--version"]).code, 2);
});

test("help drops the argparse sections", () => {
  for (const args of [["--help"], ["find", "--help"], ["meta", "--help"]]) {
    const out = run(args).out;
    assert.ok(!out.includes("positional arguments:"), args.join(" "));
    assert.ok(!out.includes("\noptions:"), args.join(" "));
    assert.ok(!out.includes("show this help message and exit"), args.join(" "));
    assert.ok(!out.includes("{context,find"), args.join(" "));
  }
});

// --- per command ---------------------------------------------------------------------------------------------------

test("find help: purpose, examples, then access, output and own options", () => {
  const result = run(["find", "--help"]);
  assert.equal(result.code, 0);
  const lines = result.out.split("\n");
  assert.equal(lines[0], "usage: rcllr find <query> [options]");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "Keyword search over title, aliases, key fact, path and text.");
  assertOrdered(result.out, ["Examples:", "Arguments:", "Access:", "Output:", "Options:", "Global options:"]);
  assert.deepEqual(section(result.out, "Examples:"), ["  rcllr find \"pnpm esbuild\" --limit 5"]);
  const names = (heading: string): string[] => entries(result.out, heading).map((line) => line.trim().split(/ {2,}/)[0]!);
  assert.deepEqual(names("Arguments:"), ["<query>"]);
  assert.deepEqual(names("Access:"), ["--scope SCOPE", "--topic TOPIC", "--allow-sensitive PATH"]);
  assert.deepEqual(names("Output:"), ["--json", "--max-chars N"]);
  assert.deepEqual(names("Options:"), ["--limit N"]);
  assert.deepEqual(names("Global options:"), ["--root PATH", "--serious", "-h, --help"]);
});

test("each option sits on one line with its description", () => {
  const out = run(["find", "--help"]).out;
  for (const flag of ["--scope", "--topic", "--allow-sensitive", "--json", "--max-chars", "--limit"]) {
    const line = out.split("\n").find((candidate) => candidate.startsWith("  " + flag));
    assert.ok(line && /^ {2}--\S+(?: [A-Z]+)? {2,}[A-Z]/.test(line), flag + " in:\n" + out);
  }
});

test("long descriptions wrap under the description column", () => {
  const out = run(["find", "--help"]).out.split("\n");
  const index = out.findIndex((line) => line.startsWith("  --allow-sensitive PATH"));
  const column = out[index]!.indexOf("Release");
  const scope = out.findIndex((line) => line.startsWith("  --scope SCOPE"));
  assert.equal(out[scope]!.indexOf("A scope"), column);
});

for (const command of COMMANDS) {
  test(command + " help starts with usage and purpose, then examples, within " + WIDTH + " columns", () => {
    const result = run([command, "--help"]);
    assert.equal(result.code, 0);
    const lines = result.out.split("\n");
    assert.ok(lines[0]!.startsWith("usage: rcllr " + command + " "), lines[0]);
    assert.equal(lines[1], "");
    assert.ok(/^[A-Z]/.test(lines[2]!) && lines[3] === "", "one-line purpose in:\n" + result.out);
    const examples = lines.indexOf("Examples:");
    assert.ok(examples > 2, result.out);
    for (const heading of ["Arguments:", "Access:", "Output:", "Options:", "Global options:"]) {
      const at = lines.indexOf(heading);
      if (at !== -1) assert.ok(at > examples, heading + " before Examples:\n" + result.out);
    }
    assert.ok(lines.includes("Global options:"), result.out);
    for (const line of lines) assert.ok(line.length <= WIDTH, "too long: " + line);
  });
}

test("required options show in the usage line and say so", () => {
  const out = run(["write", "--help"]).out;
  assert.equal(out.split("\n")[0], "usage: rcllr write <path> --expected REV [options]");
  assert.ok(section(out, "Options:").some((line) => /^ {2}--expected REV {2,}Required\. /.test(line)), out);
});

test("positionals with choices and optional positionals", () => {
  assert.equal(run(["meta", "--help"]).out.split("\n")[0], "usage: rcllr meta <action> [options]");
  assert.equal(run(["init", "--help"]).out.split("\n")[0], "usage: rcllr init [<path>] [options]");
  assert.equal(run(["check", "--help"]).out.split("\n")[0], "usage: rcllr check [<paths>...] [options]");
  assert.ok(run(["init", "--help"]).out.includes("  --locale en|de  "));
});

test("read help keeps the notes on line ranges", () => {
  const out = run(["read", "--help"]).out;
  assertOrdered(out, ["Examples:", "Options:", "Notes:"]);
  assert.ok(section(out, "Notes:").join(" ").includes("If --end lies before the first body line"), out);
});

test("help works after global options and with -h", () => {
  const result = run(["--serious", "find", "-h"]);
  assert.equal(result.code, 0);
  assert.ok(result.out.startsWith("usage: rcllr find <query> [options]\n"));
});

// --- usage errors --------------------------------------------------------------------------------------------------

function usageError(args: readonly string[], usage: string, needle: string): void {
  const result = run(args);
  assert.equal(result.code, 2, args.join(" "));
  assert.equal(result.out, "");
  const lines = result.err.trimEnd().split("\n");
  assert.equal(lines[0], usage, result.err);
  assert.ok(lines[1]!.startsWith("error: ") && lines[1]!.includes(needle), result.err);
  assert.ok(lines.length <= 4, result.err);
  assert.ok(lines.every((line) => line.length <= WIDTH), result.err);
}

test("a missing positional names it", () => {
  usageError(["read"], "usage: rcllr read <path> [options]", "<path>");
});

test("a missing required option names it", () => {
  usageError(["write", "notes/a.md"], "usage: rcllr write <path> --expected REV [options]", "--expected");
});

test("an unknown command lists the commands", () => {
  usageError(["bogus"], "usage: rcllr [--root PATH] [--serious] <command> ...", "'bogus'");
  assert.ok(run(["bogus"]).err.includes("context, find, read"));
});

test("no command at all", () => {
  usageError([], "usage: rcllr [--root PATH] [--serious] <command> ...", "command");
});

test("a bad option value names the option", () => {
  usageError(["find", "x", "--limit", "abc"], "usage: rcllr find <query> [options]", "--limit");
  usageError(["find", "x", "--limit"], "usage: rcllr find <query> [options]", "--limit");
  usageError(["init", "--locale", "fr"], "usage: rcllr init [<path>] [options]", "en, de");
  usageError(["find", "x", "--json=yes"], "usage: rcllr find <query> [options]", "--json");
});

test("unknown options and extra arguments are named", () => {
  usageError(["find", "x", "--bogus"], "usage: rcllr find <query> [options]", "--bogus");
  usageError(["read", "a.md", "b.md"], "usage: rcllr read <path> [options]", "b.md");
});

test("usage errors point to the command help", () => {
  const result = run(["read"]);
  assert.ok(result.err.includes("rcllr read --help"), result.err);
});
