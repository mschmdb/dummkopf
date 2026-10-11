/** Effective scope of a note, computed without the read gate, for write and index checks. */

import type { Config } from "./config.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { isFile, isSymlink, join, parents, readText } from "./pyos.ts";

/** File text, or null if missing, a symlink or unreadable. */
export function readRaw(path: string): string | null {
  try {
    if (isSymlink(path) || !isFile(path)) return null;
    return readText(path);
  } catch {
    return null;
  }
}

/** The note's own scope, else the nearest README's. An empty string means mixed. */
export function effectiveScope(config: Config, rel: string, overlay: ReadonlyMap<string, string> = new Map()): string {
  const keys = [rel, ...parents(rel).filter((up) => up !== "." && up !== "/").map((up) => up + "/" + config.layout.topicReadme)];
  for (const key of new Set(keys)) {
    const text = overlay.has(key) ? overlay.get(key)! : readRaw(join(config.root, key));
    if (text === null) continue;
    const value = parseFrontmatter(text).data.get(config.frontmatter.scope);
    if (typeof value === "string" && value) return value;
  }
  return "";
}
