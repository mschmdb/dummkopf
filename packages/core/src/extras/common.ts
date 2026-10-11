/** Shared helpers for the extras: readable notes, ages and sensitivity counts. Port of extras/common.py. */

import { Access } from "../access.ts";
import type { Config } from "../config.ts";
import { AccessDenied, Rejected } from "../errors.ts";
import { gitLastDate, iterNoteFiles } from "../files.ts";
import { type Data, parseFrontmatter } from "../frontmatter.ts";
import { getLocale } from "../locale.ts";
import { sorted, strip } from "../py.ts";
import { PyDate } from "../pydate.ts";
import { isDir, isSymlink, join, listdir, readText } from "../pyos.ts";

export type ExtraName = "links" | "curator";

export function require(config: Config, name: ExtraName): void {
  if (!config.extras[name]) throw new Rejected("extra_disabled", { name });
}

export interface Scan {
  readonly files: string[];
  readonly sensitiveFiles: number;
  readonly sensitiveTopics: number;
}

/** Notes the read gate releases for this scope (default: scopes.query_default), plus sensitive counts. */
export function openNotes(config: Config, scope: string | null = null): Scan {
  const access = new Access(config, scope);
  const sensitivity = access.sensitivity;
  const visible: string[] = [];
  let hidden = 0;
  for (const rel of iterNoteFiles(config)) {
    if (sensitivity.isSensitive(rel)) {
      hidden++;
      continue;
    }
    try {
      access.read(rel);
    } catch (error) {
      if (error instanceof AccessDenied) continue;
      throw error;
    }
    visible.push(rel);
  }
  const topics = topicFolders(config)
    .filter((topic) => sensitivity.isSensitive(topic + "/" + config.layout.topicReadme)).length;
  return { files: visible, sensitiveFiles: hidden, sensitiveTopics: topics };
}

/** `<topics>/<name>` for every real (non-symlinked) topic folder, sorted. */
export function topicFolders(config: Config): string[] {
  const base = join(config.root, config.layout.topics);
  const found: string[] = [];
  if (isDir(base) && !isSymlink(base)) {
    for (const entry of sorted(listdir(base))) {
      const path = join(base, entry);
      if (isDir(path) && !isSymlink(path)) found.push(config.layout.topics + "/" + entry);
    }
  }
  return found;
}

export function readNote(config: Config, rel: string): [Data, string, string] {
  const text = readText(join(config.root, rel), "ignore");
  const { data, body } = parseFrontmatter(text);
  return [data, body, text];
}

export function parseDate(value: string, config: Config): PyDate | null {
  for (const pattern of getLocale(config.ui.locale).dateFormats) {
    try {
      return PyDate.strptime(strip(value), pattern);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Frontmatter date if valid, else the Git date.
 *
 * A bulk commit (such as a frontmatter migration) would otherwise make every
 * file look fresh.
 */
export function age(config: Config, rel: string, data: Data): [PyDate, string] | null {
  const updated = data.get(config.frontmatter.updated);
  if (typeof updated === "string" && updated) {
    const parsed = parseDate(updated, config);
    if (parsed !== null) return [parsed, updated];
  }
  const commit = gitLastDate(config.root, rel);
  const parsed = commit ? parseDate(commit, config) : null;
  return parsed ? [parsed, commit] : null;
}

/**
 * json.dumps(value, ensure_ascii=False, indent=2). Maps print as objects in insertion order, so keys
 * from user data keep their order even when they look like numbers.
 */
export function dumpJson(value: unknown, indent = ""): string {
  const inner = indent + "  ";
  if (value instanceof Map) {
    if (value.size === 0) return "{}";
    const items = [...value].map(([key, item]) => inner + JSON.stringify(String(key)) + ": " + dumpJson(item, inner));
    return "{\n" + items.join(",\n") + "\n" + indent + "}";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((item) => inner + dumpJson(item, inner)).join(",\n") + "\n" + indent + "]";
  }
  if (value !== null && typeof value === "object") return dumpJson(new Map(Object.entries(value)), indent);
  return JSON.stringify(value);
}
