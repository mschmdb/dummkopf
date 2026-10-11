/**
 * Compare the Python release and the TypeScript port on a copy of a real brain.
 *
 *   node scripts/compare-brain.ts ~/brain [--config hub.toml] [--question "..."]... [--keep]
 *
 * The script copies the brain twice into a temporary folder, one copy per implementation, and never
 * touches the original. It runs the same commands on both copies, then compares exit codes, output
 * and the files the commands generated. Nothing syncs: no command here commits or pushes, and Git
 * hooks are switched off in the copies.
 *
 * The report holds note text. It stays in the temporary folder on this machine; delete it when done.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TS_BIN = path.join(REPO, "packages", "cli", "dev", "dummkopf");
const NOTE_FOLDERS = ["topics", "notes", "bookmarks"];
const QUESTION_LIMIT = 40;

interface Options {
  brain: string;
  config: string | null;
  questions: string[];
  keep: boolean;
}

interface Result {
  code: number | null;
  out: string;
  err: string;
}

function usage(message: string): never {
  process.stderr.write(message + "\n\nUsage: node scripts/compare-brain.ts <brain> [--config FILE] "
    + "[--question TEXT]... [--questions FILE] [--keep]\n");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { brain: "", config: null, questions: [], keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => argv[++i] ?? usage(arg + " needs a value");
    if (arg === "--config") options.config = path.resolve(value());
    else if (arg === "--question") options.questions.push(value());
    else if (arg === "--questions") {
      options.questions.push(...fs.readFileSync(value(), "utf-8").split("\n").map((line) => line.trim()).filter(Boolean));
    } else if (arg === "--keep") options.keep = true;
    else if (arg.startsWith("-")) usage("Unknown option " + arg);
    else if (!options.brain) options.brain = path.resolve(arg);
    else usage("Only one brain folder, please.");
  }
  if (!options.brain) usage("Name the brain folder.");
  if (!fs.statSync(options.brain, { throwIfNoEntry: false })?.isDirectory()) usage(options.brain + " is not a folder.");
  return options;
}

function copyBrain(source: string, target: string, config: string | null): void {
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  if (config) fs.copyFileSync(config, path.join(target, "dummkopf.toml"));
  if (fs.existsSync(path.join(target, ".git"))) {
    spawnSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: target });
  }
}

function runPython(cwd: string, args: string[]): Result {
  const done = spawnSync("uv", ["run", "--quiet", "--project", REPO, "dummkopf", ...args], { cwd, encoding: "utf-8" });
  return { code: done.status, out: done.stdout ?? "", err: done.stderr ?? "" };
}

function runTs(cwd: string, args: string[]): Result {
  const done = spawnSync(TS_BIN, args, { cwd, encoding: "utf-8" });
  return { code: done.status, out: done.stdout ?? "", err: done.stderr ?? "" };
}

/** Markdown files under the note folders, relative to the brain, without following symlinks. */
function noteFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path.relative(root, full));
    }
  };
  for (const folder of NOTE_FOLDERS) {
    const directory = path.join(root, folder);
    if (fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) walk(directory);
  }
  return found.sort();
}

/** Questions from the note titles, so the comparison covers search without hand-written input. */
function derivedQuestions(root: string, files: string[]): string[] {
  const titles: string[] = [];
  for (const rel of files) {
    const heading = fs.readFileSync(path.join(root, rel), "utf-8").split("\n").find((line) => line.startsWith("# "));
    if (heading) titles.push(heading.slice(2).trim());
    if (titles.length >= QUESTION_LIMIT) break;
  }
  return titles;
}

/** Files below root except .git, with their content, for the tree comparison. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.set(path.relative(root, full), fs.readFileSync(full, "utf-8"));
    }
  };
  walk(root);
  return files;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dummkopf-compare-"));
  const pyRoot = path.join(work, "python");
  const tsRoot = path.join(work, "typescript");
  const report = path.join(work, "report");
  fs.mkdirSync(report);
  copyBrain(options.brain, pyRoot, options.config);
  copyBrain(options.brain, tsRoot, options.config);

  const files = noteFiles(pyRoot);
  const questions = options.questions.length > 0 ? options.questions : derivedQuestions(pyRoot, files);
  const commands: string[][] = [
    ["meta", "index"],
    ["check", "--json"],
    ["meta", "report"],
    ["meta", "migrate", "--dry-run"],
    ["meta", "generate", "--dry-run"],
    ["meta", "agents"],
    ["links", "--json"],
    ["curator", "--json"],
    ...questions.flatMap((question) => [["context", question, "--json"], ["find", question, "--json"]]),
    ...files.map((rel) => ["read", rel, "--json"]),
  ];

  let same = 0;
  const differences: string[] = [];
  commands.forEach((args, index) => {
    const full = [...args, "--serious"];
    const expected = runPython(pyRoot, full);
    const actual = runTs(tsRoot, full);
    if (expected.code === actual.code && expected.out === actual.out && expected.err === actual.err) {
      same++;
      return;
    }
    const name = String(index + 1).padStart(4, "0") + "-" + args[0];
    fs.writeFileSync(path.join(report, name + ".txt"), [
      "command: dummkopf " + full.join(" "),
      "exit: python " + expected.code + ", typescript " + actual.code,
      "--- python stdout", expected.out, "--- typescript stdout", actual.out,
      "--- python stderr", expected.err, "--- typescript stderr", actual.err,
    ].join("\n"));
    differences.push(name + ": dummkopf " + args.join(" "));
  });

  const pyFiles = snapshot(pyRoot);
  const tsFiles = snapshot(tsRoot);
  const treeDiffs = [...new Set([...pyFiles.keys(), ...tsFiles.keys()])].sort()
    .filter((rel) => pyFiles.get(rel) !== tsFiles.get(rel));
  for (const rel of treeDiffs) differences.push("file differs after the commands: " + rel);

  process.stdout.write("Commands: " + commands.length + ", identical: " + same + ", different: "
    + (commands.length - same) + "\nGenerated files that differ: " + treeDiffs.length + "\n");
  if (differences.length > 0) {
    process.stdout.write("\n" + differences.join("\n") + "\n\nDetails (contain note text): " + report + "\n");
  }
  if (differences.length === 0 && !options.keep) fs.rmSync(work, { recursive: true, force: true });
  else process.stdout.write("Work folder (delete it when done): " + work + "\n");
  process.exitCode = differences.length === 0 ? 0 : 1;
}

main();
