/**
 * Where agents keep their own memory, read as plain items. Claude Code: one Markdown file per memory under
 * <claude home>/projects/<project folder>/memory/. Codex: one rollout summary per session under
 * <codex home>/memories/rollout_summaries/, each naming the folder it ran in (`cwd:`). Codex calls these
 * files generated state without a schema, so the reader stays tolerant.
 */

import * as fs from "node:fs";
import * as os from "node:os";

import { run } from "./proc.ts";
import { isFile, join } from "./pyos.ts";

export interface Memory {
  file: string;
  name: string;
  description: string;
  type: string;
  modified: string;
  body: string;
}

export type SourceKey = "claude" | "codex";

/** Claude Code names a project's folder after its path, every character but letters and digits as `-`. */
export function claudeProjectFolder(project: string): string {
  return project.replace(/[^a-zA-Z0-9]/g, "-");
}

/** A listed project as an absolute path: `~/` means the home folder, a trailing slash does not count. */
export function projectPath(project: string, home = os.homedir()): string {
  let expanded = project === "~" ? home : project.startsWith("~/") ? home + project.slice(1) : project;
  // A loop, not a regex: a pattern like /\/+$/ backtracks badly on a long run of slashes.
  while (expanded.length > 1 && expanded.endsWith("/")) expanded = expanded.slice(0, -1);
  return expanded;
}

/** The project a session ran in: its Git root, as Claude Code derives it, else the folder itself. */
export function sessionProject(cwd: string): string {
  const done = run("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutS: 10 });
  return !done.failed && done.code === 0 && done.stdout.trim() ? done.stdout.trim() : cwd;
}

/** Plain Markdown files of a folder, sorted; odd names and symlinks are skipped, so they never block a write. */
function markdownFiles(folder: string, skip: readonly string[] = []): string[] | null {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  return names.filter((name) => /^[\w.-]+\.md$/.test(name) && !name.startsWith(".") && !skip.includes(name)).sort()
    .filter((name) => isFile(join(folder, name)) && !fs.lstatSync(join(folder, name)).isSymbolicLink());
}

/** The value of `key:` in a block of `key: value` lines, unquoted. */
function field(block: string, key: string): string {
  const line = new RegExp("^[ \\t]*" + key + ":[ \\t]*(.*)$", "m").exec(block);
  return line ? line[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") : "";
}

/** Claude's memory frontmatter: top-level name and description, type and modified under `metadata:`. */
function parseClaude(file: string, text: string): Memory {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const head = match ? match[1]! : "";
  return {
    file, name: field(head, "name") || file.replace(/\.md$/, ""), description: field(head, "description"),
    type: field(head, "type"), modified: field(head, "modified"), body: match ? text.slice(match[0].length) : text,
  };
}

/** A Codex rollout summary: `key: value` lines up to the first blank line, then Markdown with a `#` title. */
function parseCodex(file: string, text: string): Memory & { cwd: string } {
  const cut = text.indexOf("\n\n");
  const head = cut === -1 ? text : text.slice(0, cut);
  const body = cut === -1 ? "" : text.slice(cut + 2);
  const title = /^# (.+)$/m.exec(body)?.[1]?.trim() ?? file.replace(/\.md$/, "");
  const context = /^Rollout context:[ \t]*(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  return {
    file, name: title, description: context || title, type: "codex", modified: field(head, "updated_at"),
    body: body.replace(/^# .+\n+/, ""), cwd: field(head, "cwd"),
  };
}

/** The memory of one project, or null when that source has none for it. */
export function readMemories(source: SourceKey, home: string, project: string): Memory[] | null {
  if (source === "claude") {
    const folder = join(home, "projects", claudeProjectFolder(project), "memory");
    return markdownFiles(folder, ["MEMORY.md"])?.map((name) => parseClaude(name, fs.readFileSync(join(folder, name), "utf-8")))
      ?? null;
  }
  const folder = join(home, "memories", "rollout_summaries");
  const inside = (cwd: string): boolean => cwd === project || cwd.startsWith(project === "/" ? "/" : project + "/");
  const memories = markdownFiles(folder)?.map((name) => parseCodex(name, fs.readFileSync(join(folder, name), "utf-8")))
    .filter((memory) => inside(memory.cwd));
  return memories ? memories.map(({ cwd: _cwd, ...memory }) => memory) : null;
}
