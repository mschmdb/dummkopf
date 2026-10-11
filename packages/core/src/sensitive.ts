/**
 * One definition of "sensitive", shared by reading, writing, indexing and the extras.
 *
 * A note is sensitive when its path is listed in the paths file or under a `sensitive.always`
 * prefix, when it carries the marker line, or when a README in one of its folders carries it.
 */

import type { Config } from "./config.ts";
import { iterNoteFiles } from "./files.ts";
import { casefold, ignoreCase, sorted, splitlines, splitWhitespace, strip } from "./py.ts";
import { isFile, join, parent, parts, readText, stripTrailingSlashes } from "./pyos.ts";

/** Horizontal whitespace: Python's `[^\S\r\n]`. */
const HSPACE = "[\\t\\x0b\\f\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";

const patterns = new Map<string, RegExp>();

/**
 * Match the start of one line: `> SENSITIVE`, `>SENSITIVE`, `  >  sensitive`.
 *
 * Leading and inner whitespace may be any horizontal whitespace, Unicode included, because a
 * non-breaking space or an indent renders like the plain marker. Fail closed: over-hiding is safe,
 * under-hiding leaks.
 */
export function markerPattern(marker: string): RegExp {
  let pattern = patterns.get(marker);
  if (pattern === undefined) {
    // ignoreCase matches like Python's re.IGNORECASE; JavaScript's `i` flag misses `İ` and `ı` for `i`.
    const tokens = splitWhitespace(marker).map(ignoreCase);
    pattern = new RegExp("^" + HSPACE + "*" + tokens.join(HSPACE + "*"), "u");
    patterns.set(marker, pattern);
  }
  return pattern;
}

/** Check every line; Unicode line breaks split too. A BOM at the start of a line is ignored. */
export function textHasMarker(text: string, pattern: RegExp): boolean {
  return splitlines(text).some((line) => pattern.test(line.replace(/^\ufeff+/, "")));
}

/** Comparison key for paths: one Unicode form, no case. Disk spelling may be NFD, config NFC. */
export function pathKey(rel: string): string {
  return casefold(rel.normalize("NFC"));
}

function splitEntries(entries: readonly string[]): [Set<string>, Set<string>] {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const raw of entries) {
    const line = strip(raw);
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("/") || !line.endsWith(".md")) dirs.add(stripTrailingSlashes(line));
    else files.add(line);
  }
  return [files, dirs];
}

function folded(entries: ReadonlySet<string>): Set<string> {
  return new Set([...entries].map(pathKey));
}

export class Sensitivity {
  readonly root: string;
  readonly pattern: RegExp;
  readonly readme: string;
  readonly files: ReadonlySet<string>;
  readonly dirs: ReadonlySet<string>;
  readonly alwaysFiles: ReadonlySet<string>;
  readonly alwaysDirs: ReadonlySet<string>;
  /** Case-folded entries: a case-insensitive file system opens `Health/` for `health/`. */
  private readonly foldedFiles: Set<string>;
  private readonly foldedDirs: string[];
  private readonly foldedAlwaysFiles: Set<string>;
  private readonly foldedAlwaysDirs: string[];

  private constructor(config: Config, listed: readonly string[]) {
    const [files, dirs] = splitEntries(listed);
    const [alwaysFiles, alwaysDirs] = splitEntries(config.sensitive.always);
    this.root = config.root;
    this.pattern = markerPattern(config.sensitive.marker);
    this.readme = config.layout.topicReadme;
    this.files = files;
    this.dirs = dirs;
    this.alwaysFiles = alwaysFiles;
    this.alwaysDirs = alwaysDirs;
    this.foldedFiles = folded(files);
    this.foldedDirs = [...folded(dirs)];
    this.foldedAlwaysFiles = folded(alwaysFiles);
    this.foldedAlwaysDirs = [...folded(alwaysDirs)];
  }

  /** Read the paths file. A missing file counts as empty; Access enforces its presence. */
  static load(config: Config, listed?: readonly string[]): Sensitivity {
    if (listed === undefined) {
      const path = join(config.root, config.sensitive.pathsFile);
      listed = isFile(path) ? splitlines(readText(path)) : [];
    }
    return new Sensitivity(config, listed);
  }

  isListed(rel: string): boolean {
    const key = pathKey(rel);
    if (this.foldedFiles.has(key) || this.foldedAlwaysFiles.has(key)) return true;
    return [...this.foldedDirs, ...this.foldedAlwaysDirs].some((dir) => key === dir || key.startsWith(dir + "/"));
  }

  /** Under a `sensitive.always` prefix: sensitive with or without a marker. */
  isAlways(rel: string): boolean {
    const key = pathKey(rel);
    return this.foldedAlwaysFiles.has(key) || this.foldedAlwaysDirs.some((dir) => key.startsWith(dir + "/"));
  }

  hasMarker(text: string): boolean {
    return textHasMarker(text, this.pattern);
  }

  fileMarked(rel: string): boolean {
    const path = join(this.root, rel);
    try {
      return isFile(path) && this.hasMarker(readText(path, "ignore"));
    } catch {
      return false;
    }
  }

  /** Nearest folder (relative path) whose README carries the marker. */
  markedAncestor(rel: string): string | null {
    let folder = parent(rel);
    while (parts(folder).length > 0) {
      if (this.fileMarked(folder + "/" + this.readme)) return folder;
      folder = parent(folder);
    }
    return null;
  }

  isSensitive(rel: string): boolean {
    return this.isListed(rel) || this.fileMarked(rel) || this.markedAncestor(rel) !== null;
  }

  /** Content of the paths file, derived from markers and `sensitive.always`. */
  static generate(config: Config): string {
    const sensitivity = Sensitivity.load(config, []);
    const entries = new Set<string>();
    for (const rel of iterNoteFiles(config)) {
      const folder = sensitivity.markedAncestor(rel);
      if (folder !== null) entries.add(folder + "/");
      else if (sensitivity.fileMarked(rel)) entries.add(rel);
    }
    for (const file of sensitivity.alwaysFiles) entries.add(file);
    for (const dir of sensitivity.alwaysDirs) entries.add(dir + "/");
    const header = [
      "# Generated by dummkopf from sensitivity markers. Do not edit by hand.",
      '# Source: a "' + config.sensitive.marker + '" line in a file or in a README of its folders.',
      '# Usage: rg "<term>" --ignore-file ' + config.sensitive.pathsFile,
    ];
    return [...header, ...sorted(entries)].join("\n") + "\n";
  }
}
