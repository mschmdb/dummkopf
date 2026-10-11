/** Which Markdown files count as notes, and small Git date helpers. */

import * as fs from "node:fs";

import type { Config, LayoutConfig } from "./config.ts";
import { sorted } from "./py.ts";
import { isDir, isFile, isSymlink, join, parent, parts, relativeTo, rglob, writeText } from "./pyos.ts";
import { run } from "./proc.ts";

export const SKILL_FILE = "SKILL.md";

/** Folders holding a SKILL.md ship agent skills; dummkopf never touches them. */
export function skillDirs(config: Config): ReadonlySet<string> {
  const found = new Set<string>();
  for (const base of config.layout.roots) {
    const directory = join(config.root, base);
    if (isDir(directory) && !isSymlink(directory)) {
      for (const skill of rglob(directory, SKILL_FILE)) found.add(relativeTo(parent(skill), config.root) + "/");
    }
  }
  return found;
}

/** True if neither the path nor a folder between it and root is a symlink. */
export function insideWithoutSymlinks(root: string, path: string): boolean {
  let current = path;
  while (current !== root) {
    if (isSymlink(current)) return false;
    const up = parent(current);
    if (up === current) return true;
    current = up;
  }
  return true;
}

/** Note files under the note folders. Symlinks never count: a cloned brain may point anywhere. */
export function iterNoteFiles(config: Config): string[] {
  const skills = [...skillDirs(config)];
  const found: string[] = [];
  for (const base of config.layout.roots) {
    const directory = join(config.root, base);
    if (isDir(directory) && !isSymlink(directory)) {
      for (const path of rglob(directory, "*.md")) {
        if (isFile(path) && insideWithoutSymlinks(config.root, path)) found.push(relativeTo(path, config.root));
      }
    }
  }
  return sorted(found.filter((rel) => !skills.some((skill) => rel.startsWith(skill))));
}

/** Originals under a sources folder stay byte-identical; nothing in dummkopf writes them. */
export function isSource(rel: string, layout: LayoutConfig): boolean {
  return parts(rel).includes(layout.sources);
}

/** Write a generated file unless it is a symlink. Returns true if written. */
export function writeGenerated(path: string, text: string, mode?: number): boolean {
  if (isSymlink(path)) return false;
  writeText(path, text);
  if (mode !== undefined) fs.chmodSync(path, mode);
  return true;
}

/** `<topics>/<name>` for topic files, the full path for flat notes and bookmarks. */
export function topicOf(rel: string, layout: LayoutConfig): string {
  const items = rel.split("/");
  if (items[0] === layout.topics && items.length >= 2) return items[0] + "/" + items[1];
  return rel;
}

export function isTopicReadme(rel: string, layout: LayoutConfig): boolean {
  const items = rel.split("/");
  return items.length === 3 && items[0] === layout.topics && items[2] === layout.topicReadme;
}

/** Committer date (YYYY-MM-DD) of the last commit touching rel, or "" if unknown. */
export function gitLastDate(root: string, rel: string, timeoutS = 30): string {
  const done = run("git", ["log", "-1", "--format=%cs", "--", rel], { cwd: root, timeoutS });
  if (done.failed) return "";
  const lines = done.stdout.trim().split("\n").filter((line) => line !== "");
  return done.code === 0 && lines.length > 0 ? lines[0]! : "";
}
