/** Validate write packets: structure, versions, metadata, paths, scope and sensitivity. */

import type { Access, Note } from "./access.ts";
import type { Config } from "./config.ts";
import { AccessDenied, Rejected } from "./errors.ts";
import { isSource as filesIsSource, iterNoteFiles } from "./files.ts";
import { type Data, dumpFrontmatter, KEY_RE, parseFrontmatter, shorten, type Value } from "./frontmatter.ts";
import { HINTS, type Issue, issue, linkIssues } from "./links.ts";
import { getLocale } from "./locale.ts";
import { text as say } from "./messages.ts";
import { compareTuples, count, rstrip, sorted, splitlines, str, strip } from "./py.ts";
import { PyDate } from "./pydate.ts";
import { isObject, type JsonObject, keys as jsonKeys } from "./pyjson.ts";
import { exists, join, name, parent, parts } from "./pyos.ts";
import { effectiveScope } from "./scopes.ts";
import { authoredText } from "./tables.ts";

const EXPECTED_RE = /^[a-f0-9]{12,64}$/;
const KEBAB_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const ENTRY_KEYS = new Set(["path", "content", "replace", "append", "expected", "metadata"]);
const CONTENT_KEYS = ["content", "replace", "append"];
// Stand-in file name for folder checks; the kebab-case rule keeps real notes from taking it.
const PROBE = "_probe.md";

export interface Change {
  readonly note: Note;
  readonly previous: Note | null;
  readonly expected: string | null;
}

export interface Plan {
  readonly changes: Change[];
  readonly issues: Issue[];
}

/** Metadata from a packet: values are checked by checkMetadata before they reach a note. */
type Metadata = Map<string, unknown>;

export function today(): string {
  return PyDate.today().isoformat();
}

export function isSource(rel: string, config: Config): boolean {
  return filesIsSource(rel, config.layout);
}

/** Python's `==` for the JSON and frontmatter values compared here; a missing value is None. */
function pyEquals(a: unknown, b: unknown): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((item, i) => pyEquals(item, y[i]));
  const numeric = (value: unknown): boolean => typeof value === "number" || typeof value === "boolean";
  if (numeric(x) && numeric(y)) return Number(x) === Number(y);
  return x === y;
}

function has(item: object, key: string): boolean {
  return Object.hasOwn(item, key);
}

export function metadataIssues(note: Note, config: Config): Issue[] {
  const fm = config.frontmatter;
  const { data, body, present } = parseFrontmatter(note.text);
  const problems: Issue[] = [];
  if (!present) problems.push(issue(note.path, "frontmatter", say("missing_frontmatter", "plain")));
  const updated = data.get(fm.updated);
  try {
    PyDate.fromIso(updated === undefined ? "" : str(updated));
  } catch {
    problems.push(issue(note.path, fm.updated, say("bad_updated", "plain", { key: fm.updated })));
  }
  for (const key of [fm.status, fm.keyFact, fm.summary]) {
    const value = data.get(key);
    if (typeof value !== "string" || !strip(value) || strip(value) === fm.todoPlaceholder) {
      problems.push(issue(note.path, key, say("missing_text", "plain", { key })));
    }
  }
  for (const key of fm.listKeys) {
    if (!Array.isArray(data.get(key))) problems.push(issue(note.path, key, say("needs_list", "plain", { key })));
  }
  const hasHeading = splitlines(body).some((line) => line.startsWith("# ") && strip(line.slice(2)));
  if (!strip(body) || (!isSource(note.path, config) && !hasHeading)) {
    problems.push(issue(note.path, "body", say("missing_body", "plain")));
  }
  return problems;
}

export function checkMetadata(data: ReadonlyMap<string, unknown>): void {
  for (const [key, value] of data) {
    const match = typeof key === "string" ? KEY_RE.exec(key + ": x") : null;
    const values = Array.isArray(value) ? value : [value];
    if (match === null || match[1] !== key || !(typeof value === "string" || Array.isArray(value))
        || values.some((item) => typeof item !== "string" || [..."\n\r\0"].some((char) => item.includes(char)))) {
      throw new Rejected("bad_metadata");
    }
  }
}

function merged(...maps: ReadonlyMap<string, unknown>[]): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const map of maps) for (const [key, value] of map) result.set(key, value);
  return result;
}

export function normalize(content: string, metadata: Metadata, previous: Note | null, config: Config): string {
  const fm = config.frontmatter;
  const filesHeading = getLocale(config.ui.locale).filesHeading;
  const { data: incoming, body } = parseFrontmatter(content);
  const old: Data = previous ? parseFrontmatter(previous.text).data : new Map();
  const update = merged(incoming, metadata);
  checkMetadata(update);
  const data = merged(old, update) as Data;
  let bodyChanged: boolean;
  if (previous === null) {
    bodyChanged = true;
  } else if (name(previous.path) === config.layout.topicReadme) {
    bodyChanged = authoredText(body, filesHeading) !== authoredText(previous.body, filesHeading);
  } else {
    bodyChanged = body !== previous.body;
  }
  const metadataChanged = [...update].some(([key, value]) => key !== fm.updated && !pyEquals(old.get(key), value));
  if (!incoming.has(fm.updated) && !metadata.has(fm.updated) && (bodyChanged || metadataChanged)) {
    data.set(fm.updated, today());
  }
  if (!data.has(fm.status)) data.set(fm.status, config.status.active);
  for (const key of fm.listKeys) {
    if (!data.has(key)) data.set(key, []);
  }
  if (data.has(fm.keyFact)) {
    const summary = shorten(str(data.get(fm.keyFact)), fm.summaryMax);
    if (metadata.has(fm.keyFact) && !metadata.has(fm.summary)) data.set(fm.summary, summary);
    else if (!data.has(fm.summary)) data.set(fm.summary, summary);
  }
  return dumpFrontmatter(data) + body;
}

/**
 * Maps a line of the stored note back to the caller's `content`. normalize() and the sensitive marker only
 * rewrite what stands above the body, so body lines shift by a fixed amount. A line above the body has no
 * counterpart in the caller's text and maps to null. Unchanged text, or a stored body that differs, keeps
 * its own lines.
 */
export function contentLine(given: string, stored: string): (line: number) => number | null {
  const body = parseFrontmatter(given).body;
  if (stored === given || !stored.endsWith(body)) return (line) => line;
  const lineCount = (text: string): number => text.split("\n").length;
  const bodyStart = lineCount(stored) - lineCount(body);
  const shift = lineCount(stored) - lineCount(given);
  return (line) => (line > bodyStart ? line - shift : null);
}

/** The issue with its line counted in the caller's content; dropped when the line has no counterpart there. */
function withContentLine(problem: Issue, toContent: (line: number) => number | null): Issue {
  if (problem.line === undefined) return problem;
  const { line, ...rest } = problem;
  const mapped = toContent(line);
  return mapped === null ? rest : { ...rest, line: mapped };
}

export function sameRevision(previous: Note, expected: string | null): boolean {
  return expected !== null && previous.revision.startsWith(expected);
}

export function appendedContent(previous: Note | null, block: unknown, expected: string | null): string {
  if (previous === null || typeof block !== "string" || !strip(block)) throw new Rejected("append_needs");
  const addition = strip(block, "\n") + "\n";
  // A repeated package after a successful write must not append twice.
  if (!sameRevision(previous, expected) && previous.text.endsWith("\n" + addition)) return previous.text;
  return rstrip(previous.text, "\n") + "\n\n" + addition;
}

interface Pair {
  old: string;
  new: string;
}

export function replacedContent(previous: Note | null, pairs: unknown, metadata: Metadata, expected: string | null,
                                limit: number): string {
  if (previous === null || !Array.isArray(pairs) || !(1 <= pairs.length && pairs.length <= limit)) {
    throw new Rejected("replace_needs", { max: limit });
  }
  for (const pair of pairs) {
    const keys = isObject(pair) ? Object.keys(pair) : [];
    if (!isObject(pair) || keys.length !== 2 || !has(pair, "old") || !has(pair, "new")
        || typeof pair.old !== "string" || !pair.old || typeof pair.new !== "string") {
      throw new Rejected("replace_pair");
    }
  }
  const checked = pairs as Pair[];
  const current = parseFrontmatter(previous.text).data;
  const alreadyApplied = !sameRevision(previous, expected)
    && checked.every((pair) => count(previous.text, pair.old) === 0 && (!pair.new || count(previous.text, pair.new) >= 1))
    && [...metadata].every(([key, value]) => pyEquals(current.get(key), value));
  if (alreadyApplied) return previous.text;
  let text = previous.text;
  for (const pair of checked) {
    if (count(text, pair.old) !== 1) throw new Rejected("replace_ambiguous");
    const at = text.indexOf(pair.old);
    text = text.slice(0, at) + pair.new + text.slice(at + pair.old.length);
  }
  return text;
}

export function writePath(access: Access, value: string): string {
  const layout = access.config.layout;
  const rel = access.relative(value);
  const items = parts(rel);
  if (layout.flatRoots.includes(items[0]!) && items.length !== 2) throw new AccessDenied("flat_path", { root: items[0] });
  if (items[0] === layout.topics && items.length < 3) throw new AccessDenied("topic_path", { root: items[0] });
  for (const component of items.slice(1)) {
    const stemmed = component.endsWith(".md") ? component.slice(0, -3) : component;
    if (component !== layout.topicReadme && (stemmed !== stemmed.toLowerCase() || !KEBAB_RE.test(stemmed))) {
      throw new AccessDenied("kebab_case");
    }
  }
  access.resolve(rel, true);
  return rel;
}

export function addMarker(content: string, marker: string): string {
  const { data, body } = parseFrontmatter(content);
  return dumpFrontmatter(data) + "\n" + marker + "\n" + body;
}

export function entryFields(item: unknown): JsonObject {
  if (!isObject(item)) throw new Rejected("entry_shape");
  const keys = Object.keys(item);
  if (!has(item, "path") || !has(item, "expected")
      || keys.filter((key) => CONTENT_KEYS.includes(key)).length !== 1 || keys.some((key) => !ENTRY_KEYS.has(key))
      || typeof item.path !== "string"
      || (has(item, "content") && typeof item.content !== "string")
      || (has(item, "metadata") && !isObject(item.metadata))) {
    throw new Rejected("entry_shape");
  }
  const expected = item.expected;
  if (expected !== null && (typeof expected !== "string" || !EXPECTED_RE.test(expected))) {
    throw new Rejected("expected_format");
  }
  return item;
}

export function rulesError(problems: readonly Issue[]): Rejected {
  // Name the note path and line from the caller's own package; never the link target.
  const errors = problems.filter((problem) => problem.severity === "error");
  const codes = sorted(new Set(errors.map((problem) => problem.code))).join(", ");
  const details: string[] = [];
  const ordered = [...errors].sort((a, b) => compareTuples([a.path, a.line ?? 0], [b.path, b.line ?? 0]));
  for (const problem of ordered) {
    const where = problem.path + (problem.line !== undefined ? ", " + say("issue_line", "plain", { line: problem.line }) : "");
    const hint = problem.code in HINTS ? say(HINTS[problem.code]!, "plain") : "";
    details.push("- " + where + ": " + problem.message + (hint ? " " + hint : ""));
  }
  return new Rejected("packet_rules", { codes, details: details.join("\n") });
}

export function validatePacket(access: Access, packet: unknown): Plan {
  const config = access.config;
  const limit = config.limits.maxChanges;
  if (!isObject(packet) || Object.keys(packet).length !== 1 || !has(packet, "changes")) throw new Rejected("packet_shape");
  const items = packet.changes;
  if (!Array.isArray(items) || !(1 <= items.length && items.length <= limit)) {
    throw new Rejected("changes_count", { max: limit });
  }
  const staged: [string, Note | null, string | null, (line: number) => number | null][] = [];
  const overlay = new Map<string, string>();
  const sensitivity = access.sensitivity;
  const filesHeading = getLocale(config.ui.locale).filesHeading;
  for (const raw of items) {
    const item = entryFields(raw);
    const rel = writePath(access, item.path as string);
    if (overlay.has(rel)) throw new Rejected("duplicate_path");
    const expected = item.expected as string | null;
    const previous = exists(join(access.root, rel)) ? access.read(rel) : null;
    const given = (has(item, "metadata") ? item.metadata : {}) as JsonObject;
    const metadata: Metadata = new Map(jsonKeys(given).map((key) => [key, given[key]]));
    let rawContent: string;
    if (has(item, "content")) rawContent = item.content as string;
    else if (has(item, "append")) rawContent = appendedContent(previous, item.append, expected);
    else rawContent = replacedContent(previous, item.replace, metadata, expected, limit);
    if (!has(item, "content") && previous && rawContent !== previous.text && !metadata.has(config.frontmatter.updated)) {
      metadata.set(config.frontmatter.updated, today());
    }
    let content = normalize(rawContent, metadata, previous, config);
    if (previous && name(rel) === config.layout.topicReadme
        && authoredText(content, filesHeading) === authoredText(previous.text, filesHeading)) {
      content = previous.text;
    }
    if (sensitivity.isAlways(rel) && !sensitivity.hasMarker(content)) content = addMarker(content, config.sensitive.marker);
    if (previous === null && sensitivity.hasMarker(content) && !access.isGranted(rel)) {
      // The marker comes from the caller; naming the flag reveals nothing foreign.
      throw new AccessDenied("new_sensitive", { path: rel });
    }
    if (previous && previous.text !== content) {
      if (!sameRevision(previous, expected)) throw new Rejected("version_conflict", { rev: previous.revision.slice(0, 12) });
      if (isSource(rel, config)) throw new Rejected("sources_readonly", { sources: config.layout.sources });
      if (sensitivity.hasMarker(previous.text) && !sensitivity.hasMarker(content)) throw new Rejected("marker_removal");
    } else if (previous === null && expected !== null) {
      throw new Rejected("expected_missing");
    }
    overlay.set(rel, content);
    // Lines in a rejection count in what the caller sent; append and replace send no whole note.
    const toContent = has(item, "content") ? contentLine(rawContent, content) : (line: number) => line;
    staged.push([rel, previous, expected, toContent]);
  }
  checkScopeShifts(access, overlay);
  const changes: Change[] = [];
  const problems: Issue[] = [];
  for (const [rel, previous, expected, toContent] of staged) {
    let note: Note;
    try {
      note = access.preview(rel, overlay.get(rel)!, overlay);
    } catch (error) {
      // A new file in a hidden topic must look like a new file in a missing topic.
      if (error instanceof AccessDenied && previous === null && parts(rel)[0] === config.layout.topics) {
        throw new AccessDenied("topic_unavailable", { readme: config.layout.topicReadme });
      }
      throw error;
    }
    if (previous && previous.scope !== note.scope) throw new Rejected("scope_change");
    checkNewTopic(access, rel, overlay);
    problems.push(...[...metadataIssues(note, config), ...linkIssues(access, note, overlay, previous)]
      .map((problem) => withContentLine(problem, toContent)));
    changes.push({ note, previous, expected });
  }
  if (problems.some((problem) => problem.severity === "error")) throw rulesError(problems);
  return { changes, issues: problems };
}

/**
 * A new or changed README must not change the effective scope of any existing note below it.
 *
 * Otherwise a work-scope writer could pull private notes into work with one sub-folder README.
 */
export function checkScopeShifts(access: Access, overlay: ReadonlyMap<string, string>): void {
  const config = access.config;
  const readmes = [...overlay.keys()].filter((rel) => name(rel) === config.layout.topicReadme);
  if (readmes.length === 0) return;
  for (const readme of readmes) {
    // Check the folder first: a hidden folder must answer like a missing topic, whether notes sit below or not.
    const ancestors = new Map([...overlay].filter(([rel]) => rel !== readme));
    if (folderHidden(access, parent(readme), ancestors)) {
      throw new AccessDenied("topic_unavailable", { readme: config.layout.topicReadme });
    }
  }
  const existing = iterNoteFiles(config);
  for (const readme of readmes) {
    const folder = parent(readme) + "/";
    for (const rel of existing) {
      if (rel.startsWith(folder) && effectiveScope(config, rel) !== effectiveScope(config, rel, overlay)) {
        throw new Rejected("scope_change");
      }
    }
  }
}

/** Would the read gate deny a new note without its own scope or marker in this folder? */
export function folderHidden(access: Access, folder: string, overlay: ReadonlyMap<string, string>): boolean {
  try {
    access.preview(folder + "/" + PROBE, "# Probe\n", overlay);
  } catch (error) {
    if (error instanceof AccessDenied) return true;
    throw error;
  }
  return false;
}

export function checkNewTopic(access: Access, rel: string, overlay: ReadonlyMap<string, string>): void {
  const config = access.config;
  const items = parts(rel);
  if (items[0] !== config.layout.topics) return;
  const readme = config.layout.topics + "/" + items[1] + "/" + config.layout.topicReadme;
  if (exists(join(access.root, readme))) return;
  if (!overlay.has(readme)) throw new AccessDenied("topic_unavailable", { readme: config.layout.topicReadme });
  const scope: Value | undefined = parseFrontmatter(overlay.get(readme)!).data.get(config.frontmatter.scope);
  if (config.scopes.requireOnNewTopic && !(typeof scope === "string" && config.scopes.values.includes(scope))) {
    throw new Rejected("topic_needs_scope", { choices: config.scopes.values.join(", ") });
  }
}
