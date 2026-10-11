/** Read gate: every note read passes scope, sensitivity and path checks here. */

import * as fs from "node:fs";

import type { Config } from "./config.ts";
import { AccessDenied } from "./errors.ts";
import { iterNoteFiles, SKILL_FILE } from "./files.ts";
import { parseFrontmatter, textOr } from "./frontmatter.ts";
import { lstrip, splitlines, strip } from "./py.ts";
import {
  asPosix, exists, isAbsolute, isDir, isFile, isRelativeTo, isSymlink, join, listdir, name, parents, parts,
  readBytesText, relativeTo, resolve as resolvePath, sha256, stem, suffix,
} from "./pyos.ts";
import { Sensitivity } from "./sensitive.ts";

const TOPIC_RE = /^[\p{L}\p{N}_-]+$/u;

export interface Note {
  readonly path: string;
  readonly text: string;
  readonly body: string;
  readonly title: string;
  readonly updated: string;
  readonly status: string;
  readonly scope: string;
  readonly keyFact: string;
  readonly aliases: readonly string[];
  /** SHA-256 of the UTF-8 text, 64 hex characters. */
  readonly revision: string;
  readonly sensitive: boolean;
}

/** On case-insensitive file systems `Topics/X.md` opens `topics/x.md`; insist on the on-disk spelling. */
export function exactSpelling(root: string, rel: string): boolean {
  let current = root;
  for (const part of parts(rel)) {
    const candidate = join(current, part);
    if (!exists(candidate)) return true;
    try {
      if (!listdir(current).includes(part)) return false;
    } catch {
      return false;
    }
    current = candidate;
  }
  return true;
}

/** One message for missing, sensitive and out-of-scope paths, so nothing leaks. */
export function denied(): AccessDenied {
  return new AccessDenied("path_denied");
}

export class Access {
  readonly config: Config;
  readonly root: string;
  readonly scope: string;
  readonly topic: string | null;
  readonly allowed: readonly string[];
  readonly sensitivity: Sensitivity;
  private readonly texts = new Map<string, [bigint, bigint, string]>();

  constructor(config: Config, scope: string | null = null, topic: string | null = null,
              allowSensitive: readonly string[] = []) {
    this.config = config;
    this.root = config.root;
    this.scope = scope ?? config.scopes.queryDefault;
    if (!config.scopes.choices.includes(this.scope)) {
      throw new AccessDenied("invalid_scope", { choices: config.scopes.choices.join(", ") });
    }
    if (topic !== null && !TOPIC_RE.test(topic)) throw new AccessDenied("invalid_topic");
    this.topic = topic;
    this.allowed = allowSensitive.map((value) => this.grant(value));
    const pathsFile = join(this.root, config.sensitive.pathsFile);
    if (!isFile(pathsFile) || isSymlink(pathsFile)) {
      throw new AccessDenied("sensitive_list_missing", { file: config.sensitive.pathsFile });
    }
    try {
      this.sensitivity = Sensitivity.load(config);
    } catch {
      throw new AccessDenied("sensitive_list_missing", { file: config.sensitive.pathsFile });
    }
  }

  withGrants(grants: readonly string[]): Access {
    return new Access(this.config, this.scope, this.topic, grants);
  }

  /** A note path relative to the brain, inside a note folder; anything else is denied. */
  relative(value: string): string {
    const items = parts(value);
    if (isAbsolute(value) || items.includes("..") || value.includes("\\")) throw denied();
    if (items.length < 2 || !this.config.layout.roots.includes(items[0]!)) throw denied();
    return asPosix(value).replace(/\/+$/, "");
  }

  private grant(value: string): string {
    const rel = this.relative(value);
    if (parts(rel)[0] !== this.config.layout.topics && !rel.endsWith(".md")) throw new AccessDenied("grant_needs_path");
    return rel;
  }

  isGranted(rel: string): boolean {
    return this.allowed.some((grant) => rel === grant || rel.startsWith(grant + "/"));
  }

  private text(path: string): string {
    const stat = fs.statSync(path, { bigint: true });
    const cached = this.texts.get(path);
    if (cached && cached[0] === stat.mtimeNs && cached[1] === stat.size) return cached[2];
    const text = readBytesText(path);
    this.texts.set(path, [stat.mtimeNs, stat.size, text]);
    return text;
  }

  /** Absolute path for a relative note path; rejects symlinks, skill folders and escapes. */
  resolve(rel: string, allowNew = false): string {
    const path = join(this.root, rel);
    if (!exactSpelling(this.root, rel)) throw denied();
    if (suffix(path) !== ".md" || (!allowNew && !isFile(path)) || isDir(path)) throw denied();
    for (const candidate of [path, ...parents(path)]) {
      if (candidate === this.root) break;
      if (candidate !== path && exists(candidate) && !isDir(candidate)) throw denied();
      if (isSymlink(candidate) || (isDir(candidate) && exists(join(candidate, SKILL_FILE)))) throw denied();
    }
    if (name(path) === SKILL_FILE || !isRelativeTo(resolvePath(path), this.root)) throw denied();
    return path;
  }

  read(value: string): Note {
    return this.readWith(value, new Map());
  }

  /** Read a note as it would look after a write package, without touching disk. */
  preview(value: string, text: string, overlay: ReadonlyMap<string, string>): Note {
    return this.readWith(value, new Map([...overlay, [value, text]]));
  }

  private readWith(value: string, overlay: ReadonlyMap<string, string>): Note {
    const config = this.config;
    const fm = config.frontmatter;
    const rel = this.relative(value);
    if (this.topic && !rel.startsWith(config.layout.topics + "/" + this.topic + "/")) throw denied();
    const path = this.resolve(rel, overlay.has(rel));
    const listed = this.sensitivity.isListed(rel);
    const granted = this.isGranted(rel);
    if (listed && !granted) throw denied();
    let text: string;
    let data: ReturnType<typeof parseFrontmatter>["data"];
    let body: string;
    let scope: string;
    let sensitive: boolean;
    try {
      text = overlay.has(rel) ? overlay.get(rel)! : this.text(path);
      ({ data, body } = parseFrontmatter(text));
      scope = textOr(data.get(fm.scope));
      sensitive = this.sensitivity.hasMarker(text);
      for (const folder of parents(path)) {
        if (folder === this.root) break;
        const readme = join(folder, config.layout.topicReadme);
        const key = relativeTo(readme, this.root);
        if (readme === path || (!overlay.has(key) && !exists(readme))) continue;
        if (isSymlink(readme)) throw denied();
        const parentText = overlay.has(key) ? overlay.get(key)! : this.text(readme);
        sensitive = sensitive || this.sensitivity.hasMarker(parentText);
        scope = scope || textOr(parseFrontmatter(parentText).data.get(fm.scope));
      }
    } catch (error) {
      if (error instanceof AccessDenied) throw error;
      throw denied();
    }
    if (sensitive && !granted) throw denied();
    if (scope && !config.scopes.values.includes(scope)) throw denied();
    if (this.scope !== config.scopes.all && scope && scope !== this.scope) throw denied();
    const aliases = data.get(fm.aliases);
    const aliasList = aliases === undefined || aliases.length === 0 ? [] : Array.isArray(aliases) ? aliases : [aliases];
    const heading = splitlines(body).find((line) => line.startsWith("# "));
    const title = heading === undefined ? stem(path) : strip(lstrip(heading, "# "));
    return {
      path: rel,
      text,
      body,
      title,
      updated: textOr(data.get(fm.updated)),
      status: textOr(data.get(fm.status)),
      scope: scope || config.scopes.mixedLabel,
      keyFact: textOr(data.get(fm.keyFact)),
      aliases: aliasList,
      revision: sha256(text),
      sensitive: listed || sensitive,
    };
  }

  /** Candidate note paths; listed sensitive paths are dropped unless something was granted. */
  paths(): string[] {
    const layout = this.config.layout;
    const prefix = this.topic ? layout.topics + "/" + this.topic + "/" : "";
    const found = iterNoteFiles(this.config).filter((rel) => rel.startsWith(prefix));
    if (this.allowed.length > 0) return found;
    return found.filter((rel) => !this.sensitivity.isListed(rel));
  }
}
