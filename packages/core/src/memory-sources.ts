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

export interface ProjectMemory {
  /** The project as shown in each note: its path where known, else Claude's folder name. */
  label: string;
  /** Folder name inside the topic. */
  slug: string;
  memories: Memory[];
  /** True when a configured project folder means this project, e.g. for `scope_by_project`. */
  matches: (project: string) => boolean;
}

export interface Selection {
  /** Listed projects; `*` means every project. */
  projects: readonly string[];
  exclude: readonly string[];
  /** Only this project, for the hook. */
  only?: string;
}

/** The folder name inside the topic: the project path without its leading separators, in lower case. */
export function slug(project: string): string {
  return claudeProjectFolder(project).replace(/^-+/, "").replace(/-+/g, "-").toLowerCase();
}

function inside(folder: string, project: string): boolean {
  return folder === project || folder.startsWith(project === "/" ? "/" : project + "/");
}

/** The folder a Claude project ran in, read from one of its session logs; Claude's folder name if none says. */
function claudeLabel(projectFolder: string): string {
  try {
    const log = fs.readdirSync(projectFolder).find((name) => name.endsWith(".jsonl"));
    if (log) {
      const handle = fs.openSync(join(projectFolder, log), "r");
      const buffer = Buffer.alloc(65536);
      const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
      fs.closeSync(handle);
      const cwd = /"cwd":"([^"\\]+)"/.exec(buffer.toString("utf-8", 0, read))?.[1];
      if (cwd && claudeProjectFolder(cwd) === projectFolder.split("/").at(-1)) return cwd;
    }
  } catch {
    // No readable log: the folder name has to do. Turning it back into a path is ambiguous.
  }
  return projectFolder.split("/").at(-1)!;
}

/** Every listed project of a source with its memory. A project without memory is left out. */
export function projectMemories(source: SourceKey, home: string, selection: Selection): ProjectMemory[] {
  const all = selection.projects.includes("*");
  const listed = selection.projects.filter((project) => project !== "*").map((project) => projectPath(project));
  const excluded = selection.exclude.map((project) => projectPath(project));
  const only = selection.only === undefined ? undefined : projectPath(selection.only);
  if (source === "claude") {
    const root = join(home, "projects");
    let folders: string[] = [];
    try {
      folders = fs.readdirSync(root).filter((name) => !name.startsWith(".")).sort();
    } catch {
      return [];
    }
    const wanted = all ? folders : listed.map((project) => claudeProjectFolder(project));
    const skip = new Set(excluded.map((project) => claudeProjectFolder(project)));
    return wanted.filter((folder) => folders.includes(folder) && !skip.has(folder)
      && (only === undefined || folder === claudeProjectFolder(only)))
      .flatMap((folder) => {
        const memoryFolder = join(root, folder, "memory");
        const names = markdownFiles(memoryFolder, ["MEMORY.md"]);
        if (!names) return [];
        const memories = names.map((name) => parseClaude(name, fs.readFileSync(join(memoryFolder, name), "utf-8")));
        const known = listed.find((project) => claudeProjectFolder(project) === folder);
        const matches = (project: string): boolean => claudeProjectFolder(projectPath(project)) === folder;
        return [{ label: known ?? claudeLabel(join(root, folder)), slug: slug(folder), memories, matches }];
      });
  }
  const folder = join(home, "memories", "rollout_summaries");
  const summaries = (markdownFiles(folder) ?? [])
    .map((name) => parseCodex(name, fs.readFileSync(join(folder, name), "utf-8")))
    .filter((memory) => memory.cwd && !excluded.some((project) => inside(memory.cwd, project))
      && (only === undefined || inside(memory.cwd, only)));
  const groups = new Map<string, Memory[]>();
  for (const { cwd, ...memory } of summaries) {
    const project = all ? cwd : listed.find((item) => inside(cwd, item));
    if (project === undefined) continue;
    groups.set(project, [...(groups.get(project) ?? []), memory]);
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([project, memories]) => ({
      label: project, slug: slug(project), memories,
      matches: (folder: string): boolean => inside(project, projectPath(folder)),
    }));
}
