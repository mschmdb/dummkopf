/**
 * Black-box harness: every test talks to the CLI through a subprocess and reads files and Git state.
 *
 * Nothing here imports the implementation, so any build of rcllr runs the same suite: point
 * RCLLR_BIN at its binary. Without it, the suite runs the TypeScript sources through
 * packages/cli/dev/rcllr.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const GIT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
export const BASE_TOML = (remote: string): string => 'schema_version = 1\n[repo]\nremote = "' + remote + '"\n';
export const PLACEHOLDER_REMOTE = "git@example.org:me/brain.git";
const TIMEOUT_MS = 120_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Every test file builds many sandboxes; each registers one exit listener for its cleanup.
process.setMaxListeners(0);

export interface Result {
  code: number;
  out: string;
  err: string;
}

/** The binary under test: RCLLR_BIN, else the development runner next to this suite. */
export function binary(): string {
  return process.env.RCLLR_BIN || path.resolve(HERE, "../../dev/rcllr");
}

/** Python's text mode turned `\r\n` into `\n`; the suite compares output the same way. */
function text(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n");
}

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * One test's world: a temporary folder, its own HOME and Git identity, and no RCLLR_ROOT, so no
 * user configuration leaks in or out. Removed when the test process exits.
 */
export class Sandbox {
  readonly tmp: string;
  readonly home: string;
  readonly env: Record<string, string | undefined>;

  constructor() {
    this.tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rcllr-bb-")));
    this.home = path.join(this.tmp, "home");
    fs.mkdirSync(this.home);
    process.on("exit", () => fs.rmSync(this.tmp, { recursive: true, force: true }));
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.RCLLR_ROOT;
    Object.assign(env, GIT_IDENTITY, {
      HOME: this.home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(this.home, ".gitconfig"),
    });
    const program = binary();
    if (program.includes(path.sep)) env.PATH = path.dirname(program) + path.delimiter + (env.PATH ?? "");
    this.env = env;
  }

  run(args: readonly string[], options: { cwd?: string; stdin?: string; env?: Env } = {}): Result {
    const done = spawnSync(binary(), args, {
      cwd: options.cwd ?? this.tmp, input: options.stdin ?? "", encoding: "utf-8",
      env: { ...this.env, ...options.env }, timeout: TIMEOUT_MS,
    });
    if (done.error) throw done.error;
    return { code: done.status ?? -1, out: text(done.stdout), err: text(done.stderr) };
  }

  /** Run git; throw on a non-zero exit unless `check` is false. Returns trimmed stdout. */
  git(cwd: string, args: readonly string[], check = true): string {
    const done = spawnSync("git", args, { cwd, env: this.env, encoding: "utf-8", timeout: TIMEOUT_MS });
    if (check && done.status !== 0) throw new Error("git " + args.join(" ") + " failed:\n" + done.stderr);
    return text(done.stdout).trim();
  }

  /** A brain folder with a minimal config and an empty sensitive-paths list (the `make` fixture). */
  brain(name = "brain", extra = "", remote = PLACEHOLDER_REMOTE): Brain {
    const root = path.join(this.tmp, name);
    fs.mkdirSync(root, { recursive: true });
    const toml = BASE_TOML(remote) + extra;
    fs.writeFileSync(path.join(root, "rcllr.toml"), toml, "utf-8");
    fs.writeFileSync(path.join(root, ".sensitive-paths"), "# generated\n", "utf-8");
    return new Brain(this, fs.realpathSync(root), toml);
  }

  /** A brain cloned from a local bare remote, with one committed note, `notes/first.md`. */
  synced(): Synced {
    const remote = path.join(this.tmp, "remote.git");
    this.git(this.tmp, ["init", "-q", "--bare", "-b", "main", remote]);
    const target = this.brain("work", "", remote);
    target.gitInit();
    this.git(target.root, ["remote", "add", "origin", remote]);
    target.write("notes/first.md", fullNote({ title: "First" }));
    target.commit("Initial");
    this.git(target.root, ["push", "-q", "-u", "origin", "main"]);
    return new Synced(this, this.tmp, remote, target);
  }
}

export class Brain {
  readonly sandbox: Sandbox;
  readonly root: string;
  toml: string;

  constructor(sandbox: Sandbox, root: string, toml: string) {
    this.sandbox = sandbox;
    this.root = root;
    this.toml = toml;
  }

  write(rel: string, content: string): string {
    const target = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    return target;
  }

  read(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel), "utf-8");
  }

  exists(rel: string): boolean {
    return fs.existsSync(path.join(this.root, rel));
  }

  /** Append TOML to rcllr.toml; start a new section with its header inside `extra`. */
  configure(extra: string): void {
    this.toml += extra;
    fs.writeFileSync(path.join(this.root, "rcllr.toml"), this.toml, "utf-8");
  }

  /** Add a key to the [repo] table; in a Git brain, commit the config so the tree stays clean. */
  repoOption(line: string, commit = true): void {
    this.toml = this.toml.replace("[repo]\n", "[repo]\n" + line + "\n");
    fs.writeFileSync(path.join(this.root, "rcllr.toml"), this.toml, "utf-8");
    if (commit) this.commit("config");
  }

  /** Run the CLI inside the brain in plain tone. */
  run(args: readonly string[], options: { stdin?: string; env?: Env } = {}): Result {
    return this.sandbox.run([...args, "--serious"], { cwd: this.root, ...options });
  }

  cheeky(args: readonly string[], options: { stdin?: string } = {}): Result {
    return this.sandbox.run(args, { cwd: this.root, ...options });
  }

  git(args: readonly string[], check = true): string {
    return this.sandbox.git(this.root, args, check);
  }

  gitInit(): void {
    this.git(["init", "-q", "-b", "main"]);
  }

  commit(message = "add"): void {
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "--no-verify", "-m", message]);
  }

  mode(rel: string): number {
    return fs.statSync(path.join(this.root, rel)).mode & 0o777;
  }
}

export class Synced {
  readonly sandbox: Sandbox;
  readonly base: string;
  readonly remote: string;
  readonly brain: Brain;

  constructor(sandbox: Sandbox, base: string, remote: string, target: Brain) {
    this.sandbox = sandbox;
    this.base = base;
    this.remote = remote;
    this.brain = target;
  }

  remoteLog(): string[] {
    return lines(this.sandbox.git(this.remote, ["log", "--format=%s", "main"]));
  }

  remoteFiles(): string[] {
    return lines(this.sandbox.git(this.remote, ["ls-tree", "-r", "--name-only", "main"]));
  }

  remoteFile(rel: string): string {
    return this.sandbox.git(this.remote, ["show", "main:" + rel]);
  }

  remoteEdit(rel: string, content: string): void {
    const other = path.join(this.base, "other");
    if (fs.existsSync(other)) this.sandbox.git(other, ["pull", "-q"]);
    else this.sandbox.git(this.base, ["clone", "-q", "-b", "main", this.remote, other]);
    const target = path.join(other, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    this.sandbox.git(other, ["add", "-A"]);
    this.sandbox.git(other, ["commit", "-q", "-m", "Remote change"]);
    this.sandbox.git(other, ["push", "-q", "origin", "main"]);
  }
}

/** Python's str.splitlines() for Git output: no empty last line. */
export function lines(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}

/** A note with minimal frontmatter; each line in `fields` shifts the heading down by one line. */
export function note({ title = "Docker", body = "pnpm esbuild fails", fields = "", updated = "2026-10-04" } = {}): string {
  return "---\nupdated: " + updated + "\nstatus: active\n" + fields + "---\n\n# " + title + "\n\n" + body + "\n";
}

/** A complete note: valid frontmatter, so `check` finds no issue. */
export function fullNote({ title = "Test", body = "Proven content.", scope = "" } = {}): string {
  return "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: Proven content.\n"
    + "summary: Proven content.\naliases: [test]\nperiod: []\nentities: []\n"
    + (scope ? "scope: " + scope + "\n" : "") + "---\n\n# " + title + "\n\n" + body + "\n";
}

/** Revision (12 hex chars) from the header line `path | rev=...` of text output. */
export function revOf(out: string, rel: string): string {
  for (const line of out.split("\n")) {
    if (line.startsWith(rel + " | rev=")) return line.split("rev=")[1]!.split(" ")[0]!;
  }
  throw new Error("no header for " + rel + " in:\n" + out);
}

/** Markdown a writer sends: only a key fact in the frontmatter, the rest is completed by rcllr. */
export function md({ body = "Body", fields = "", title = "T" } = {}): string {
  return "---\nkey_fact: A fact.\n" + fields + "---\n\n# " + title + "\n\n" + body + "\n";
}

export type Entry = Record<string, unknown>;

export function packet(...changes: Entry[]): string {
  return JSON.stringify({ changes });
}

/** A package entry that creates a file. */
export function newEntry(rel: string, content: string | null = null, extra: Entry = {}): Entry {
  return { path: rel, expected: null, content: content ?? md(), ...extra };
}

export function ingest(target: Brain, changes: Entry[], args: readonly string[] = []): Result {
  return target.run(["ingest", "--input", "-", ...args], { stdin: packet(...changes) });
}

export function rev(target: Brain, rel: string, ...args: string[]): string {
  return revOf(target.run(["read", rel, ...args]).out, rel);
}

/** The README entry that opens a new topic with a scope. */
export function topic(name: string, scope = "work"): Entry[] {
  return [newEntry("topics/" + name + "/README.md", md({ fields: "scope: " + scope + "\n", title: name }))];
}
