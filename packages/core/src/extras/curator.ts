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
import { BOUNDARY, compare, ignoreCase, len, rstrip, slice, splitlines, strip, unique } from "../py.ts";
import { PyDate } from "../pydate.ts";
import { template } from "../scaffold.ts";
import { age, openNotes, readNote, require, topicFolders } from "./common.ts";

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

export interface Conflict {
  path: string;
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
  for (const rel of notes.files) {
    const [data, body] = readNote(config, rel);
    const resolved = age(config, rel, data);
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
    // Only the body: the frontmatter date field would otherwise count as a second "as of" date.
    const dates = unique([...body.matchAll(labels)].map((match) => match[1]!));
    if (dates.length >= 2) conflicts.push({ path: rel, dates });
    const updated = data.get(config.frontmatter.updated);
    if (data.get(config.frontmatter.status) === config.status.active && typeof updated === "string"
        && resolved && resolved[1] === updated && resolved[0].compare(staleLimit) < 0) {
      staleActive.push({ path: rel, updated });
    }
    if (rel.startsWith(config.layout.topics + "/") && resolved) {
      const topic = rel.split("/").slice(0, 2).join("/");
      const seen = newest.get(topic);
      if (seen === undefined || resolved[0].compare(seen[0]) > 0) newest.set(topic, resolved);
    }
  }
  const staleTopics = topicFolders(config)
    .filter((topic) => newest.has(topic) && newest.get(topic)![0].compare(staleLimit) < 0)
    .map((topic) => ({ path: topic + "/", updated: newest.get(topic)![1] }));
  return {
    open_loops: byPath(loops), stale_topics: staleTopics, conflicting_dates: byPath(conflicts),
    stale_active: byPath(staleActive), sensitive_files: notes.sensitiveFiles, sensitive_topics: notes.sensitiveTopics,
  };
}

export function renderMarkdown(result: CuratorScan): string {
  const none = say("curator_none", "plain");
  const orNone = (lines: string[]): string[] => (lines.length > 0 ? lines : [none]);
  const lines = ["# " + say("curator_title", "plain"), "", "## " + say("curator_open_loops", "plain"), ""];
  for (const loop of result.open_loops) {
    lines.push("- `" + loop.path + "` (" + loop.updated + ")");
    lines.push(...loop.lines.map((line) => "  - " + line));
  }
  if (result.open_loops.length === 0) lines.push(none);
  lines.push("", "## " + say("curator_stale_topics", "plain"), "");
  lines.push(...orNone(result.stale_topics.map((item) => "- `" + item.path + "` (" + item.updated + ")")));
  lines.push("", "## " + say("curator_conflicts", "plain"), "");
  lines.push(...orNone(result.conflicting_dates.map((item) => "- `" + item.path + "`: " + item.dates.join(", "))));
  lines.push("", "## " + say("curator_stale_active", "plain"), "");
  lines.push(...orNone(result.stale_active.map((item) => "- `" + item.path + "` (" + item.updated + ")")));
  lines.push("", say("curator_skipped", "plain", { files: result.sensitive_files, topics: result.sensitive_topics }));
  return lines.join("\n") + "\n";
}

/** The weekly LLM prompt, filled with this brain's folders, keys and marker. */
export function prompt(config: Config): string {
  let text = template("curator-prompt.md");
  const fm = config.frontmatter;
  const values: [string, string][] = [
    ["report_dir", rstrip(config.curator.reportDir, "/") + "/"],
    ["links_file", config.links.output],
    ["updated", fm.updated], ["status", fm.status], ["key_fact", fm.keyFact], ["summary", fm.summary],
    ["aliases", fm.aliases], ["period", fm.period], ["entities", fm.entities],
    ["active", config.status.active], ["marker", config.sensitive.marker],
    ["paths_file", config.sensitive.pathsFile],
    ["readme", config.layout.topicReadme], ["scope_key", fm.scope],
  ];
  for (const [key, value] of values) text = text.replaceAll("{" + key + "}", () => value);
  return text;
}
