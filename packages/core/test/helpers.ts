/** Test helpers: temporary brains and Git repositories. */

import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_NAME, type Config, loadConfig } from "../src/config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");
export const GERMAN_CONFIG = path.join(REPO, "examples", "config-german-hub.toml");
export const DEV_BIN = path.join(REPO, "packages", "cli", "dev", "rcllr");
/** Run the development CLI. Windows ignores shebangs, so bash starts the shell script there. */
export function spawnDev(args: readonly string[], options: SpawnSyncOptionsWithStringEncoding) {
  return process.platform === "win32"
    ? spawnSync("bash", [DEV_BIN, ...args], options)
    : spawnSync(DEV_BIN, args, options);
}
export const BASE_CONFIG = (remote: string): string => 'schema_version = 1\n[repo]\nremote = \'' + remote + '\'\n';
export const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** A fresh temporary folder, removed when the process exits. */
export function tempDir(prefix = "rcllr-test-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function runGit(cwd: string, args: readonly string[], date?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const done = spawnSync("git", args, { cwd, env, encoding: "utf-8" });
  if (done.status !== 0) throw new Error("git " + args.join(" ") + " failed: " + done.stderr);
  return done.stdout;
}

export class Brain {
  readonly root: string;
  toml: string;

  constructor(root: string, toml: string) {
    this.root = root;
    this.toml = toml;
  }

  get config(): Config {
    return loadConfig(this.root);
  }

  configure(extra: string): Config {
    this.toml += extra;
    fs.writeFileSync(path.join(this.root, CONFIG_NAME), this.toml, "utf-8");
    return this.config;
  }

  write(rel: string, text: string): string {
    const target = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf-8");
    return target;
  }

  read(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel), "utf-8");
  }

  exists(rel: string): boolean {
    return fs.existsSync(path.join(this.root, rel));
  }

  note(rel: string, { title = "Docker", body = "pnpm esbuild fails", fields = "", updated = "2026-10-04" } = {}): string {
    return this.write(rel, "---\nupdated: " + updated + "\nstatus: active\n" + fields
      + "---\n\n# " + title + "\n\n" + body + "\n");
  }

  gitInit(): void {
    runGit(this.root, ["init", "-q", "-b", "main"]);
    runGit(this.root, ["config", "user.email", "test@example.com"]);
    runGit(this.root, ["config", "user.name", "Test"]);
  }

  commit(message = "add", date = "2026-01-02T10:00:00"): void {
    runGit(this.root, ["add", "-A"]);
    runGit(this.root, ["commit", "-q", "--no-verify", "-m", message], date);
  }
}

export function makeBrain(root: string, toml: string): Brain {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, CONFIG_NAME), toml, "utf-8");
  fs.writeFileSync(path.join(root, ".sensitive-paths"), "# generated\n", "utf-8");
  return new Brain(fs.realpathSync(root), toml);
}

export function brain(): Brain {
  return makeBrain(path.join(tempDir(), "brain"), BASE_CONFIG("git@example.org:me/brain.git"));
}

export function german(): Brain {
  return makeBrain(path.join(tempDir(), "hub"), fs.readFileSync(GERMAN_CONFIG, "utf-8"));
}

/** A complete English note; without a scope its body heading sits on line 11. */
export function documentText({ title = "Test", body = "Proven content.", scope = "" } = {}): string {
  return "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: Proven content.\n"
    + "summary: Proven content.\naliases: [test]\nperiod: []\nentities: []\n"
    + (scope ? "scope: " + scope + "\n" : "")
    + "---\n\n# " + title + "\n\n" + body + "\n";
}

export interface Invoked {
  code: number;
  out: string;
  err: string;
}

/** Run the CLI from its sources against a brain, like main(args, root=brain.root) in Python. */
export function invoke(target: Brain, args: readonly string[], stdin = ""): Invoked {
  const done = spawnSync(DEV_BIN, [...args, "--root", target.root], {
    cwd: target.root, input: stdin, encoding: "utf-8", env: { ...process.env, ...GIT_ENV },
  });
  return { code: done.status ?? -1, out: done.stdout, err: done.stderr };
}

export function revision(target: Brain, rel: string): string {
  return createHash("sha256").update(fs.readFileSync(path.join(target.root, rel))).digest("hex");
}

/** A brain cloned from a bare remote, with one committed note. */
export class Synced {
  readonly base: string;
  readonly remote: string;
  readonly brain: Brain;

  constructor(base: string, remote: string, target: Brain) {
    this.base = base;
    this.remote = remote;
    this.brain = target;
  }

  git(args: readonly string[], cwd?: string): string {
    return runGit(cwd ?? this.brain.root, args).trim();
  }

  remoteEdit(rel: string, content: string): string {
    const other = path.join(this.base, "other");
    if (!fs.existsSync(other)) runGit(this.base, ["clone", "-q", "-b", "main", this.remote, other]);
    else runGit(other, ["pull", "-q"]);
    const target = path.join(other, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    runGit(other, ["add", "-A"]);
    runGit(other, ["commit", "-q", "-m", "Remote change"]);
    runGit(other, ["push", "-q", "origin", "main"]);
    return other;
  }
}

export function synced(): Synced {
  const base = tempDir();
  const remote = path.join(base, "remote.git");
  runGit(base, ["init", "-q", "--bare", "-b", "main", remote]);
  const target = makeBrain(path.join(base, "brain"), BASE_CONFIG(remote));
  target.gitInit();
  runGit(target.root, ["remote", "add", "origin", remote]);
  target.write("notes/first.md", documentText());
  target.commit("Initial");
  runGit(target.root, ["push", "-q", "-u", "origin", "main"]);
  return new Synced(base, remote, target);
}
