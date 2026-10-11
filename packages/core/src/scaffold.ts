/** `dummkopf init`: create a new brain repository from the packaged templates. Port of scaffold.py. */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

import { CONFIG_NAME, type Config, loadConfig } from "./config.ts";
import { Rejected } from "./errors.ts";
import { getLocale } from "./locale.ts";
import { run } from "./proc.ts";
import { format } from "./py.ts";
import { exists, isDir, join, listdir, resolve, writeText } from "./pyos.ts";
import { Sensitivity } from "./sensitive.ts";

export const PLACEHOLDER_REMOTE = "git@github.com:you/your-brain.git";

/** dummkopf.toml of a local brain: the remote stays commented out until the owner wants sync. */
const LOCAL_REMOTE_HINT = "# No remote: this brain stays on this machine. dummkopf commits, but never pushes.\n"
  + "# To sync, set a private repository: remote = \"" + PLACEHOLDER_REMOTE + "\"\n";

/** What dummkopf commits, and how a save gets its own commit subject. */
const COMMIT_RULES = "- dummkopf commits only the note folders and generated files. Changes to `dummkopf.toml`, `AGENTS.md`,\n"
  + "  `CLAUDE.md`, `.claude/`, `.codex/` and other tooling stay uncommitted; leave them for the user to commit.\n"
  + "- Give each save its own commit subject: `write ... --message \"Add pnpm build fix\"`, one line, at most\n"
  + "  200 characters. Without it the commit uses `repo.commit_message`.\n";

/** The sync rules in AGENTS.md: with a remote, and for a local brain. */
const SYNC_REMOTE = "- The hooks installed by `dummkopf install` commit and push note changes after each edit and at session end.\n"
  + "  `ingest`, `write`, the Claude Code hook and the Codex hook share one sync path and one process lock.\n"
  + COMMIT_RULES
  + "- Before changes dummkopf fetches and rebases onto the remote. Never merge from or write to `FETCH_HEAD`;\n"
  + "  parallel fetches share it.\n"
  + "- If histories diverge, dummkopf stops and keeps local commits. Check before you resolve anything.";
const SYNC_LOCAL = "- This brain is local: it has no remote, and nothing leaves this machine. Never add a remote or push.\n"
  + "- The hooks installed by `dummkopf install` commit note changes after each edit and at session end.\n"
  + "  `ingest`, `write`, the Claude Code hook and the Codex hook share one commit path and one process lock.\n"
  + COMMIT_RULES.trimEnd();

/** A packaged template; resolved next to the module, so it works from src and dist alike. */
export function template(name: string): string {
  return fs.readFileSync(new URL("../templates/" + name, import.meta.url), "utf-8");
}

export function codeList(values: readonly string[]): string {
  return values.map((value) => "`" + value + "`").join(", ");
}

/** str.partition(">"). */
function partition(value: string, separator: string): [string, string, string] {
  const cut = value.indexOf(separator);
  return cut === -1 ? [value, "", ""] : [value.slice(0, cut), separator, value.slice(cut + separator.length)];
}

/** AGENTS.md with this brain's folders, keys, scopes and marker filled in. */
export function renderAgents(config: Config): string {
  const fm = config.frontmatter;
  const layout = config.layout;
  const barriers = config.scopes.linkBarriers.map((barrier) => partition(barrier, ">"));
  const barrierText = barriers.length > 0
    ? "Links respect scope barriers: " + barriers.map(([left, , right]) =>
      "a `" + left + "` note must not link to a `" + right + "` note").join("; ") + "."
    : "Links may cross scopes.";
  let always = "";
  if (config.sensitive.always.length > 0) {
    always = " These paths are always sensitive, marker or not: " + codeList(config.sensitive.always)
      + ". New files there get the marker automatically.";
  }
  return format(template("AGENTS.md"), {
    sync: config.repo.local ? SYNC_LOCAL : SYNC_REMOTE,
    topics: layout.topics, notes: layout.notes, bookmarks: layout.bookmarks, sources: layout.sources,
    readme: layout.topicReadme, index: layout.index, scope_key: fm.scope, scopes: codeList(config.scopes.values),
    all: config.scopes.all, barriers: barrierText, marker: config.sensitive.marker,
    paths_file: config.sensitive.pathsFile, always, key_fact: fm.keyFact, updated: fm.updated,
    status: fm.status, summary: fm.summary, aliases: fm.aliases, period: fm.period, entities: fm.entities,
  });
}

export function indexText(localeName: string): string {
  const locale = getLocale(localeName);
  return "# Index\n\nThe tables below are generated from frontmatter. Prose around them stays.\n\n"
    + locale.indexTopics + "\n\n" + locale.indexNotes + "\n\n" + locale.indexBookmarks + "\n";
}

export function insideGitRepo(path: string): boolean {
  return run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: path }).code === 0;
}

export function hasRemote(path: string, name: string): boolean {
  return run("git", ["remote", "get-url", name], { cwd: path }).code === 0;
}

/** subprocess.run(..., check=True): output passes through, a failure raises. */
function checkedGit(cwd: string, args: readonly string[]): void {
  const done = spawnSync("git", args, { cwd, stdio: "inherit" });
  if (done.error) throw done.error;
  if (done.status !== 0) {
    throw new Error("Command '" + JSON.stringify(["git", ...args]) + "' returned non-zero exit status " + done.status + ".");
  }
}

/** Path.mkdir(exist_ok=True): an existing folder is fine, an existing file is not. */
function mkdirExistOk(path: string): void {
  try {
    fs.mkdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !isDir(path)) throw error;
  }
}

export function init(targetPath: string, remote: string | null, locale: string): string {
  const target = resolve(targetPath);
  if (exists(join(target, CONFIG_NAME))) throw new Rejected("brain_exists", { path: target });
  fs.mkdirSync(target, { recursive: true });
  // Without --remote the brain stays local: the remote line is only a commented hint.
  const settings = remote
    ? template("dummkopf.toml").replaceAll("{remote}", () => remote)
    : template("dummkopf.toml").replace('remote = "{remote}"\n', () => LOCAL_REMOTE_HINT);
  writeText(join(target, CONFIG_NAME), settings.replaceAll("{locale}", () => locale));
  const config = loadConfig(target);
  const filesToWrite = new Map<string, string>([
    ["AGENTS.md", renderAgents(config)],
    ["CLAUDE.md", template("CLAUDE.md")],
    [".gitignore", template("gitignore")],
    [config.layout.index, indexText(locale)],
  ]);
  for (const [name, text] of filesToWrite) {
    const path = join(target, name);
    if (!exists(path)) writeText(path, text);
  }
  const layout = config.layout;
  for (const folder of [layout.topics, layout.notes, layout.bookmarks, layout.sources, layout.archive]) {
    mkdirExistOk(join(target, folder));
    const keep = join(target, folder, ".gitkeep");
    if (listdir(join(target, folder)).length === 0) fs.closeSync(fs.openSync(keep, "a"));
  }
  const pathsFile = join(target, config.sensitive.pathsFile);
  writeText(pathsFile, Sensitivity.generate(config));
  fs.chmodSync(pathsFile, 0o600);
  if (!insideGitRepo(target)) checkedGit(target, ["init", "-q", "-b", config.repo.branch]);
  if (remote && !hasRemote(target, config.repo.remoteName)) {
    checkedGit(target, ["remote", "add", config.repo.remoteName, remote]);
  }
  return target;
}
