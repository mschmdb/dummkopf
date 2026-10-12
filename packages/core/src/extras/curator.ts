/**
 * Curator extra: a deterministic scan for an LLM-written weekly report.
 *
 * Finds open loops, topics without movement, conflicting "as of" dates and stale active
 * notes. Read-only, no network. Sensitive notes are left out and only counted.
 * Port of extras/curator.py.
 */

import type { Config } from "../config.ts";
import { getLocale } from "../locale.ts";
import { text as say } from "../messages.ts";
import { BOUNDARY, compare, ignoreCase, len, rstrip, slice, splitlines, strip } from "../py.ts";
import { PyDate } from "../pydate.ts";
import { template } from "../scaffold.ts";
import { age, openNotes, parseDate, readNote, require, topicFolders } from "./common.ts";

export const MAX_LINES = 3;
export const LINE_WIDTH = 120;

export interface OpenLoop {
  path: string;
  updated: string;
  lines: string[];
}

export interface Dated {
  path: string;
  updated: string;
}

/** A note whose text names a newer as-of date than its own date (`updated`, else the Git date). */
export interface Conflict {
  path: string;
  updated: string;
  /** The as-of dates in the text, one per calendar day, as first written. */
  dates: string[];
}

export interface CuratorScan {
  open_loops: OpenLoop[];
  stale_topics: Dated[];
  conflicting_dates: Conflict[];
  stale_active: Dated[];
  sensitive_files: number;
  sensitive_topics: number;
}

export function openPattern(config: Config): RegExp {
  const words = getLocale(config.ui.locale).openWords;
  return new RegExp(BOUNDARY + "(?:" + words.map(ignoreCase).join("|") + ")" + BOUNDARY, "u");
}

/**
 * The as-of dates in a body, one per calendar day. Only the body: the frontmatter date field would
 * otherwise count as an as-of date.
 */
function asOfDates(config: Config, body: string, labels: RegExp): [PyDate, string][] {
  const days = new Map<string, [PyDate, string]>();
  for (const match of body.matchAll(labels)) {
    const parsed = parseDate(match[1]!, config);
    if (parsed !== null && !days.has(parsed.isoformat())) days.set(parsed.isoformat(), [parsed, match[1]!]);
  }
  return [...days.values()];
}

/** A "keep" verdict: the note's keep date is today or later. */
function kept(config: Config, data: ReadonlyMap<string, unknown>, today: PyDate): boolean {
  const value = data.get(config.curator.keepKey);
  const until = typeof value === "string" ? parseDate(value, config) : null;
  return until !== null && until.compare(today) >= 0;
}

function byPath<T extends { path: string }>(items: T[]): T[] {
  return items.sort((a, b) => compare(a.path, b.path));
}

export function scan(config: Config, openDays: number | null = null, staleDays: number | null = null,
                     scope: string | null = null): CuratorScan {
  require(config, "curator");
  const today = PyDate.today();
  const openLimit = today.addDays(-(openDays === null ? config.curator.openDays : openDays));
  const staleLimit = today.addDays(-(staleDays === null ? config.curator.staleDays : staleDays));
  const pattern = openPattern(config);
  const label = getLocale(config.ui.locale).updatedLabel;
  const labels = new RegExp(label.source, label.flags.includes("g") ? label.flags : label.flags + "g");
  const notes = openNotes(config, scope);
  const loops: OpenLoop[] = [];
  const conflicts: Conflict[] = [];
  const staleActive: Dated[] = [];
  const newest = new Map<string, [PyDate, string]>();
  const keptTopics = new Set<string>();
  const topicReadme = (rel: string): string => rel.split("/").slice(0, 2).join("/") + "/" + config.layout.topicReadme;
  for (const rel of notes.files) {
    const [data, body] = readNote(config, rel);
    const resolved = age(config, rel, data);
    if (rel.startsWith(config.layout.topics + "/") && resolved) {
      const topic = rel.split("/").slice(0, 2).join("/");
      const seen = newest.get(topic);
      if (seen === undefined || resolved[0].compare(seen[0]) > 0) newest.set(topic, resolved);
    }
    if (kept(config, data, today)) {
      if (rel === topicReadme(rel)) keptTopics.add(rel.split("/").slice(0, 2).join("/"));
      continue;
    }
    if (pattern.test(body) && resolved && resolved[0].compare(openLimit) < 0) {
      const lines: string[] = [];
      for (const line of splitlines(body)) {
        const stripped = strip(line);
        if (stripped && !lines.includes(stripped) && pattern.test(line)) {
          lines.push(len(stripped) > LINE_WIDTH ? slice(stripped, 0, LINE_WIDTH) : stripped);
        }
        if (lines.length >= MAX_LINES) break;
      }
      loops.push({ path: rel, updated: resolved[1], lines });
    }
    // A history of as-of dates up to the note's date is normal; a newer one means the date lags behind.
    const dates = asOfDates(config, body, labels);
    if (resolved && dates.some(([day]) => day.compare(resolved[0]) > 0)) {
      conflicts.push({ path: rel, updated: resolved[1], dates: dates.map(([, written]) => written) });
    }
    const updated = data.get(config.frontmatter.updated);
    if (data.get(config.frontmatter.status) === config.status.active && typeof updated === "string"
        && resolved && resolved[1] === updated && resolved[0].compare(staleLimit) < 0) {
      staleActive.push({ path: rel, updated });
    }
  }
  const staleTopics = topicFolders(config)
    .filter((topic) => !keptTopics.has(topic) && newest.has(topic) && newest.get(topic)![0].compare(staleLimit) < 0)
    .map((topic) => ({ path: topic + "/", updated: newest.get(topic)![1] }));
  return {
    open_loops: byPath(loops), stale_topics: staleTopics, conflicting_dates: byPath(conflicts),
    stale_active: byPath(staleActive), sensitive_files: notes.sensitiveFiles, sensitive_topics: notes.sensitiveTopics,
  };
}

interface Section {
  title: string;
  entries: { path: string; head: string; details: string[] }[];
}

/** Each note appears once, under its first finding; its later findings are named on that line. */
export function renderMarkdown(result: CuratorScan): string {
  const sections: Section[] = [
    { title: say("curator_open_loops", "plain"), entries: result.open_loops.map((loop) => ({
      path: loop.path, head: "- `" + loop.path + "` (" + loop.updated + ")", details: loop.lines.map((line) => "  - " + line),
    })) },
    { title: say("curator_stale_topics", "plain"), entries: result.stale_topics.map((item) => ({
      path: item.path, head: "- `" + item.path + "` (" + item.updated + ")", details: [],
    })) },
    { title: say("curator_conflicts", "plain"), entries: result.conflicting_dates.map((item) => ({
      path: item.path, head: "- `" + item.path + "` (" + item.updated + "): " + item.dates.join(", "), details: [],
    })) },
    { title: say("curator_stale_active", "plain"), entries: result.stale_active.map((item) => ({
      path: item.path, head: "- `" + item.path + "` (" + item.updated + ")", details: [],
    })) },
  ];
  const listed = new Set<string>();
  const lines = ["# " + say("curator_title", "plain")];
  sections.forEach((section, index) => {
    lines.push("", "## " + section.title, "");
    const shown = section.entries.filter((entry) => !listed.has(entry.path));
    for (const entry of shown) {
      listed.add(entry.path);
      const later = sections.slice(index + 1)
        .filter((other) => other.entries.some((item) => item.path === entry.path)).map((other) => other.title);
      lines.push(entry.head + (later.length > 0 ? ". " + say("curator_also", "plain", { sections: later.join(", ") }) : ""));
      lines.push(...entry.details);
    }
    if (shown.length === 0) lines.push(say("curator_none", "plain"));
  });
  lines.push("", say("curator_skipped", "plain", { files: result.sensitive_files, topics: result.sensitive_topics }));
  return lines.join("\n") + "\n";
}

/** The weekly LLM prompt, filled with this brain's folders, keys and marker. */
export function prompt(config: Config): string {
  let text = template("curator-prompt.md");
  const fm = config.frontmatter;
  const locale = getLocale(config.ui.locale);
  const heading = (value: string): string => value.replace(/^#+\s*/u, "");
  const values: [string, string][] = [
    ["report_dir", rstrip(config.curator.reportDir, "/") + "/"],
    ["links_file", config.links.output],
    ["updated", fm.updated], ["status", fm.status], ["key_fact", fm.keyFact], ["summary", fm.summary],
    ["aliases", fm.aliases], ["period", fm.period], ["entities", fm.entities],
    ["active", config.status.active], ["marker", config.sensitive.marker],
    ["paths_file", config.sensitive.pathsFile],
    ["readme", config.layout.topicReadme], ["scope_key", fm.scope],
    ["links_entities", heading(locale.linksEntities)], ["links_collisions", heading(locale.linksCollisions)],
    ["links_time", heading(locale.linksTime)],
  ];
  for (const [key, value] of values) text = text.replaceAll("{" + key + "}", () => value);
  return text;
}
