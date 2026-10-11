/** Link checks for write packets: no dead links, no links across sensitivity or scope barriers. */

import type { Access, Note } from "./access.ts";
import { AccessDenied } from "./errors.ts";
import { insideWithoutSymlinks } from "./files.ts";
import { text as say } from "./messages.ts";
import { len, rstrip, splitlines, strip, WS, WS_CHARS } from "./py.ts";
import { isDir, isFile, join, parts, stem, suffix } from "./pyos.ts";
import { dirname, isabs, joinPosix, normpath, unquote, UrlError, urlsplit } from "./pyurl.ts";

export const ALLOWED_SCHEMES: readonly string[] = ["http", "https", "mailto"];
/** Longer lines are skipped: link regexes are cheap per line, but a line of 80 000 `[` would make them crawl. */
export const MAX_LINK_LINE = 10_000;

export interface Issue {
  path: string;
  code: string;
  severity: string;
  message: string;
  line?: number;
}

export function issue(path: string, code: string, message: string, severity = "error",
                      line: number | null = null): Issue {
  const result: Issue = { path, code, severity, message };
  if (line) result.line = line;
  return result;
}

const MARKDOWN_LINK = new RegExp("!?\\[[^\\]\\n]{0,500}\\]\\((<[^>\\n]{1,1000}>|[^" + WS_CHARS + ")]{1,2000})(?:"
  + WS + "+[\"'][^)\\n]{0,500})?\\)", "gu");
const WIKI_LINK = /\[\[([^\]\n]{1,500})\]\]/gu;
/** `(?ms)^```.*?^```[^\n]*` with Python's `^`, which only follows `\n`. */
const CODE_BLOCK = /(?:^|(?<=\n))```[\s\S]*?(?:^|(?<=\n))```[^\n]*/gu;
const INLINE_CODE = /`[^`\n]*`/gu;

export function references(text: string): string[] {
  // Code samples are not links of the note.
  const cleaned = text.replace(CODE_BLOCK, "");
  const lines = cleaned.split("\n").filter((line) => len(line) <= MAX_LINK_LINE)
    .map((line) => line.replace(INLINE_CODE, ""));
  const markdown = lines.flatMap((line) => [...line.matchAll(MARKDOWN_LINK)].map((match) => match[1]!));
  const wiki = lines.flatMap((line) => [...line.matchAll(WIKI_LINK)].map((match) => "wiki:" + match[1]!.split("|")[0]!));
  return [...markdown.map((value) => strip(value, "<>")), ...wiki];
}

export function referenceLine(text: string, reference: string): number | null {
  const needle = reference.startsWith("wiki:") ? "[[" + reference.slice(5) : "](" + reference;
  const lines = splitlines(text);
  for (let number = 1; number <= lines.length; number++) {
    const line = lines[number - 1]!;
    if (line.includes(needle) || line.includes("(<" + reference + ">")) return number;
  }
  return null;
}

export const HINTS: Readonly<Record<string, string>> = {
  "link-unavailable": "hint_link_unavailable",
  "link-scope": "hint_link_scope",
};

/**
 * An existing file, no symlink on the way, under a folder listed in links.allow_outside.
 *
 * The owner declared these folders public, so a link there reveals nothing hidden.
 */
export function allowedOutside(access: Access, rel: string): boolean {
  const folders = access.config.links.allowOutside.map((folder) => rstrip(folder, "/"));
  if (!folders.some((folder) => rel.startsWith(folder + "/"))) return false;
  const path = join(access.root, rel);
  return isFile(path) && insideWithoutSymlinks(access.root, path);
}

export function readable(access: Access, rel: string, overlay: ReadonlyMap<string, string>): boolean {
  try {
    if (overlay.has(rel)) access.preview(rel, overlay.get(rel)!, overlay);
    else access.read(rel);
  } catch (error) {
    if (error instanceof AccessDenied) return false;
    throw error;
  }
  return true;
}

/** `work>private` in scopes.link_barriers: a work note must not link to a private one. */
export function crossesBarrier(barriers: readonly string[], note: Note, source: Note): boolean {
  return barriers.includes(note.scope + ">" + source.scope);
}

/**
 * Security problems are always errors; other problems only for links new in this write.
 *
 * A missing target and a hidden target give the same issue, so a link check never reveals
 * that a sensitive or out-of-scope note exists.
 */
export function linkIssues(access: Access, note: Note, overlay: ReadonlyMap<string, string>,
                           previous: Note | null = null): Issue[] {
  const layout = access.config.layout;
  const problems: Issue[] = [];
  const old = new Set(previous ? references(previous.text) : []);
  for (const reference of references(note.text)) {
    const problem = (code: string, key: string, security = false): void => {
      const severity = security || !old.has(reference) ? "error" : "warning";
      problems.push(issue(note.path, code, say(key, "plain"), severity, referenceLine(note.text, reference)));
    };

    if (reference.startsWith("#")) continue;
    let rel: string;
    if (reference.startsWith("wiki:")) {
      const name = reference.slice(5).split("#")[0]!;
      let candidates = new Set([...new Set([...access.paths(), ...overlay.keys()])]
        .filter((path) => stem(path) === name || path === name || path === name + ".md"));
      for (const candidate of [layout.topics + "/" + name + "/" + layout.topicReadme,
        layout.notes + "/" + name + ".md", layout.bookmarks + "/" + name + ".md"]) {
        if (overlay.has(candidate) || isFile(join(access.root, candidate))) candidates.add(candidate);
      }
      candidates = new Set([...candidates].filter((path) => readable(access, path, overlay)));
      if (candidates.size !== 1) {
        problem("link-unavailable", "link_unavailable");
        continue;
      }
      rel = [...candidates][0]!;
    } else {
      let parsed;
      try {
        parsed = urlsplit(reference);
      } catch (error) {
        if (!(error instanceof UrlError)) throw error;
        problem("link-invalid", "link_scheme", true);
        continue;
      }
      if (ALLOWED_SCHEMES.includes(parsed.scheme)) continue;
      if (parsed.scheme || parsed.netloc) {
        problem("link-invalid", "link_scheme", true);
        continue;
      }
      const target = unquote(parsed.path);
      if (!target) continue;
      // Normalize without following symlinks: a symlink must look like any other unavailable target.
      const joined = normpath(joinPosix(dirname(note.path), target));
      if (joined === ".." || joined.startsWith("../") || isabs(joined)) {
        problem("link-invalid", "link_escapes", true);
        continue;
      }
      rel = joined;
    }
    // Anything that is not a readable note answers like a missing file: folders of hidden topics,
    // files outside the note folders, .git. Otherwise a link check would map the repository.
    let targetPath = join(access.root, rel);
    if (!overlay.has(rel)) {
      const items = parts(rel);
      if (items.length === 0 || !layout.roots.includes(items[0]!)) {
        if (!allowedOutside(access, rel)) problem("link-unavailable", "link_unavailable");
        continue;
      }
      if (isDir(targetPath)) {
        rel = rel + "/" + layout.topicReadme;
        targetPath = join(access.root, rel);
      }
      if (!overlay.has(rel) && !isFile(targetPath)) {
        problem("link-unavailable", "link_unavailable");
        continue;
      }
    }
    try {
      let source: Note;
      if (overlay.has(rel)) source = access.preview(rel, overlay.get(rel)!, overlay);
      else if (suffix(targetPath) === ".md") source = access.read(rel);
      else source = access.preview(rel + ".md", "# Link\n", overlay);
      if ((source.sensitive && !note.sensitive) || crossesBarrier(access.config.scopes.linkBarriers, note, source)) {
        problem("link-scope", "link_scope", true);
      }
    } catch (error) {
      if (!(error instanceof AccessDenied)) throw error;
      problem("link-unavailable", "link_unavailable");
    }
  }
  return problems;
}
