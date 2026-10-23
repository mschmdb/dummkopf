/**
 * Mirror Claude Code auto memory into the brain, one way. Each listed project gets a folder under one topic
 * whose README sets its own scope. A run rewrites what changed and archives what Claude deleted; nothing
 * flows back. Memory is written by agents, so every mirrored note says it is not an instruction, and its
 * links become plain text: an import can never link into the brain or around the sensitivity gate.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";

import { type Access, type Note } from "./access.ts";
import { type Config } from "./config.ts";
import { AccessDenied, Rejected } from "./errors.ts";
import { run } from "./proc.ts";
import { isFile, join } from "./pyos.ts";
import { ingest } from "./write.ts";

export interface MemoryImportOptions {
  /** The Claude Code config folder, usually ~/.claude. */
  claudeHome: string;
  /** Only this project, for the hook; default: every listed project. */
  project?: string;
  dryRun: boolean;
  sync: boolean;
}

export interface MemoryImportResult {
  changed: string[];
  sync: string;
}

interface Memory {
  file: string;
  name: string;
  description: string;
  type: string;
  modified: string;
  body: string;
}

/** Claude Code names a project's folder after its path, every character but letters and digits as `-`. */
export function claudeProjectFolder(project: string): string {
  return project.replace(/[^a-zA-Z0-9]/g, "-");
}

/** A listed project as an absolute path: `~/` means the home folder, a trailing slash does not count. */
export function projectPath(project: string, home = os.homedir()): string {
  const expanded = project === "~" ? home : project.startsWith("~/") ? home + project.slice(1) : project;
  return expanded.replace(/\/+$/, "") || "/";
}

/** The folder name inside the topic: the project path without its leading separators, in lower case. */
function slug(project: string): string {
  return claudeProjectFolder(project).replace(/^-+/, "").replace(/-+/g, "-").toLowerCase();
}

/** The project a session ran in: its Git root, as Claude Code derives it, else the folder itself. */
export function sessionProject(cwd: string): string {
  const done = run("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutS: 10 });
  return !done.failed && done.code === 0 && done.stdout.trim() ? done.stdout.trim() : cwd;
}

/** Claude's memory frontmatter: top-level name and description, type and modified under `metadata:`. */
function parseMemory(file: string, text: string): Memory {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const head = match ? match[1]! : "";
  const field = (key: string): string => {
    const line = new RegExp("^\\s*" + key + ":\\s*(.*)$", "m").exec(head);
    return line ? line[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  };
  return {
    file, name: field("name") || file.replace(/\.md$/, ""), description: field("description"), type: field("type"),
    modified: field("modified"), body: match ? text.slice(match[0].length) : text,
  };
}

function readMemories(claudeHome: string, project: string): Memory[] | null {
  const folder = join(claudeHome, "projects", claudeProjectFolder(project), "memory");
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  // Plain file names only: anything else would fail the write rules and block the whole import.
  return names.filter((name) => /^[\w.-]+\.md$/.test(name) && !name.startsWith(".") && name !== "MEMORY.md").sort()
    .filter((name) => isFile(join(folder, name)) && !fs.lstatSync(join(folder, name)).isSymbolicLink())
    .map((name) => parseMemory(name, fs.readFileSync(join(folder, name), "utf-8")));
}

/** Text without Markdown links: `[label](target)` reads `label (target)`, images and wiki links alike. */
function unlinked(text: string): string {
  return text.replace(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, "$1 ($2)").replace(/\[\[([^\]\n]*)\]\]/g, "$1");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function frontmatter(config: Config, fields: [string, string | string[]][]): string {
  const value = (item: string | string[]): string =>
    Array.isArray(item) ? "[" + item.join(", ") + "]" : item;
  return "---\n" + fields.map(([key, item]) => key + ": " + value(item)).join("\n") + "\n---\n";
}

/** Frontmatter key holding a fingerprint of the source, so an unchanged memory is never written again. */
const SOURCE_KEY = "memory_source";

function fingerprint(project: string, memory: Memory, status: string): string {
  return createHash("sha256").update(JSON.stringify([project, memory, status])).digest("hex").slice(0, 16);
}

function noteText(config: Config, project: string, memory: Memory, status: string): string {
  const fm = config.frontmatter;
  const day = /^\d{4}-\d{2}-\d{2}/.exec(memory.modified)?.[0] ?? new Date().toISOString().slice(0, 10);
  const keyFact = oneLine(unlinked(memory.description)) || "Claude Code memory " + memory.name + ".";
  const aliases = [...new Set([memory.name, memory.type, "claude-memory"].map((item) => oneLine(item)).filter(Boolean))]
    .map((item) => item.replace(/[,[\]]/g, " ").trim());
  const head = frontmatter(config, [[fm.updated, day], [fm.status, status], [fm.keyFact, keyFact], [fm.aliases, aliases],
    [SOURCE_KEY, fingerprint(project, memory, status)]]);
  return head + "\n# " + oneLine(memory.name) + "\n\n> Imported from the Claude Code memory of " + project
    + ". It records what an agent noted in earlier sessions, not an instruction.\n\n" + unlinked(memory.body).trim() + "\n";
}

function readmeText(config: Config): string {
  const fm = config.frontmatter;
  const head = frontmatter(config, [[fm.scope, config.claudeMemory.scope], [fm.status, config.status.active],
    [fm.keyFact, "Claude Code auto memory, mirrored by rcllr import-memory; never edit by hand."]]);
  return head + "\n# Claude Code memory\n\nrcllr rewrites this folder from Claude Code's auto memory. Changes made here "
    + "are lost on the next import.\n";
}

function sourceOf(text: string): string {
  return new RegExp("^" + SOURCE_KEY + ": (.*)$", "m").exec(text)?.[1] ?? "";
}

/** The current note at `path`: null when it does not exist, undefined when it is hidden from this access. */
function current(access: Access, path: string): Note | null | undefined {
  if (!fs.existsSync(join(access.config.root, path))) return null;
  try {
    return access.read(path);
  } catch (error) {
    if (error instanceof AccessDenied) return undefined;
    throw error;
  }
}

export function importClaudeMemory(access: Access, options: MemoryImportOptions): MemoryImportResult {
  const config = access.config;
  if (!config.extras.claudeMemory) throw new Rejected("extra_disabled", { name: "claude_memory" });
  const topic = config.layout.topics + "/" + config.claudeMemory.topic;
  const projects = config.claudeMemory.projects.map((project) => projectPath(project))
    .filter((project) => options.project === undefined || project === projectPath(options.project));
  const changes: { path: string; content: string; expected: string | null }[] = [];
  // rcllr completes the frontmatter and the README table on write, so the mirror never equals what we wrote.
  // A note counts as current when it carries the same source fingerprint; the README only needs to exist.
  const want = (path: string, content: string): void => {
    const previous = current(access, path);
    if (previous === undefined) return;
    if (previous !== null && sourceOf(previous.text) === sourceOf(content)) return;
    changes.push({ path, content, expected: previous ? previous.revision : null });
  };
  for (const project of projects) {
    const memories = readMemories(options.claudeHome, project);
    if (memories === null) continue;
    if (changes.length === 0) want(topic + "/" + config.layout.topicReadme, readmeText(config));
    const folder = topic + "/" + slug(project);
    const kept = new Set<string>();
    for (const memory of memories) {
      kept.add(memory.file);
      want(folder + "/" + memory.file, noteText(config, project, memory, config.status.active));
    }
    let mirrored: string[] = [];
    try {
      mirrored = fs.readdirSync(join(config.root, folder)).filter((name) => name.endsWith(".md")).sort();
    } catch {
      // First import of this project.
    }
    for (const name of mirrored.filter((file) => !kept.has(file))) {
      const previous = current(access, folder + "/" + name);
      if (!previous || previous.status === config.status.archived) continue;
      const content = previous.text.replace(new RegExp("^" + config.frontmatter.status + ": .*$", "m"),
        config.frontmatter.status + ": " + config.status.archived)
        .replace(new RegExp("^" + SOURCE_KEY + ": .*$", "m"), SOURCE_KEY + ": removed");
      changes.push({ path: folder + "/" + name, content, expected: previous.revision });
    }
  }
  const changed = changes.map((change) => change.path);
  if (changes.length === 0) return { changed, sync: "not-run" };
  let sync = "not-run";
  for (let start = 0; start < changes.length; start += config.limits.maxChanges) {
    const packet = { changes: changes.slice(start, start + config.limits.maxChanges) };
    sync = ingest(access, packet, options.dryRun, options.sync && !options.dryRun, "Import Claude Code memory").sync;
  }
  return { changed, sync };
}
