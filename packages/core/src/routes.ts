/**
 * Routes: a named query ("meal plan") opens exactly the matching dated-plan files.
 *
 * A route releases only the files it selects, never the whole folder, so a sensitive plan folder
 * stays closed for every other question.
 */

import type { Access, Note } from "./access.ts";
import type { Config } from "./config.ts";
import { AccessDenied } from "./errors.ts";
import { getLocale, type Locale } from "./locale.ts";
import { compareTuples, DIGIT, escapeRegExp, len, lstrip, pyInt, sorted, splitlines } from "./py.ts";
import { isObject, type Json, loads } from "./pyjson.ts";
import { PyDate } from "./pydate.ts";
import { asPosix, exists, glob, isAbsolute, isSymlink, join, parts, readText, relativeTo, windowsUnsafe } from "./pyos.ts";
import { words } from "./text.ts";

/** First and last day, both included. */
export type Period = readonly [PyDate, PyDate];
export type Normalize = (value: string) => string[];

export const ROUTE_KEYS: ReadonlySet<string> = new Set(["aliases", "sources", "scope", "kind", "allow_sensitive"]);

/** One validated entry of the routes file; keys as in the JSON file. */
export interface Route {
  readonly aliases: readonly string[];
  readonly sources: string;
  readonly scope: string;
  readonly kind: string;
  readonly allow_sensitive?: boolean;
}

export interface Selection {
  readonly notes: Note[];
  readonly period: Period | null;
}

export function week(terms: readonly string[], today: PyDate, locale: Locale): Period | null {
  const text = terms.join(" ");
  let monday = today.addDays(-today.weekday());
  if (locale.nextWeek.test(text)) monday = monday.addDays(7);
  else if (!locale.thisWeek.test(text)) return null;
  return [monday, monday.addDays(6)];
}

/** `plan-2026-10-02-to-09.md` or `plan-2026-10-02-to-2026-10-09.md` -> both dates. */
export function filePeriod(path: string, locale: Locale): Period | null {
  const date = DIGIT + "{4}-" + DIGIT + "{2}-" + DIGIT + "{2}";
  // Python's `$` also matches before a final newline.
  const pattern = new RegExp("-(" + date + ")-" + escapeRegExp(locale.periodConnector)
    + "-(" + date + "|" + DIGIT + "{2})\\.md(?=\\n?$)", "u");
  const match = pattern.exec(path);
  if (!match) return null;
  try {
    const start = PyDate.fromIso(match[1]!);
    let end: PyDate;
    if (len(match[2]!) === 10) {
      end = PyDate.fromIso(match[2]!);
    } else {
      const day = pyInt(match[2]!);
      if (day >= start.day) {
        end = start.withDay(day);
      } else {
        const nextMonth = start.withDay(28).addDays(4).withDay(1);
        end = nextMonth.withDay(day);
      }
    }
    return end.compare(start) >= 0 ? [start, end] : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export const MIN_ALIAS_WORD = 3;

/** An alias releases sensitive plans, so it must name something: not only filler words. */
export function specific(alias: string, locale: Locale): boolean {
  return words(alias).some((token) => len(token) >= MIN_ALIAS_WORD && !locale.stopwords.has(token));
}

/** What is wrong with one route entry, or null. Routes fail closed, so the message must be precise. */
export function routeProblem(route: Json, config: Config): string | null {
  if (!isObject(route)) return "must be an object";
  const unknown = sorted(Object.keys(route).filter((key) => !ROUTE_KEYS.has(key)));
  if (unknown.length > 0) return "unknown key '" + unknown[0] + "'";
  if ("allow_sensitive" in route && typeof route.allow_sensitive !== "boolean") {
    return "allow_sensitive must be true or false";
  }
  const aliases = route.aliases;
  const source = route.sources;
  if (!Array.isArray(aliases) || aliases.length === 0 || aliases.some((alias) => typeof alias !== "string")) {
    return "aliases must be a non-empty list of strings";
  }
  const locale = getLocale(config.ui.locale);
  for (const alias of aliases as string[]) {
    if (!specific(alias, locale)) return "alias '" + alias + "' needs a real word (3+ letters, not a filler word)";
  }
  if (typeof source !== "string") return "sources must be a string";
  const items = parts(source);
  if (isAbsolute(source) || items.includes("..") || source.includes("\\") || windowsUnsafe(source.replace(/[*?]/g, "x")) || items.length < 3
      || !config.layout.roots.includes(items[0]!) || /[*?[]/.test(items.slice(0, -1).join("/"))
      || !source.endsWith(".md") || source.includes("**")) {
    return "sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name";
  }
  if (!config.scopes.values.includes(route.scope as string)) return "scope must be one of " + config.scopes.values.join(", ");
  if (route.kind !== "dated-plan") return "kind must be dated-plan";
  return null;
}

export function routes(config: Config): Route[] {
  const name = config.context.routesFile;
  const path = join(config.root, name);
  if (!exists(path) && !isSymlink(path)) return [];
  if (isSymlink(path)) throw new AccessDenied("routes_invalid", { file: name, problem: "must not be a symlink" });
  let data: Json;
  try {
    data = loads(readText(path));
  } catch {
    throw new AccessDenied("routes_invalid", { file: name, problem: "not readable as JSON" });
  }
  const result = isObject(data) ? data.routes : undefined;
  if (!Array.isArray(result)) {
    throw new AccessDenied("routes_invalid", { file: name, problem: 'needs a top-level "routes" list' });
  }
  result.forEach((route, index) => {
    const problem = routeProblem(route, config);
    if (problem) throw new AccessDenied("routes_invalid", { file: name, problem: "route " + (index + 1) + ": " + problem });
  });
  return result as unknown as Route[];
}

/** Sensitive plans open only for a route the owner marked with `allow_sensitive: true`. */
export function opener(access: Access, route: Route, rel: string): Access {
  return (route.allow_sensitive ?? false) ? access.withGrants([rel]) : access;
}

export function readable(access: Access, rel: string): boolean {
  try {
    access.read(rel);
  } catch (error) {
    if (error instanceof AccessDenied) return false;
    throw error;
  }
  return true;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function select(access: Access, query: string, normalize: Normalize, today: PyDate): Selection | null {
  const config = access.config;
  const locale = getLocale(config.ui.locale);
  const terms = normalize(query);

  const requested = (alias: string): boolean => {
    const tokens = normalize(alias);
    if (tokens.length === 0) return false;
    // Exclusions apply within one sentence, not to the user's other instructions.
    for (const clause of query.split(/[.!?;\n]/)) {
      const clauseTerms = normalize(clause);
      for (let index = 0; index < clauseTerms.length - tokens.length + 1; index++) {
        if (!sameList(clauseTerms.slice(index, index + tokens.length), tokens)) continue;
        const excluded = clauseTerms.some((term) => locale.negations.has(term));
        const prefix = clauseTerms.slice(Math.max(0, index - 3), index);
        if (!excluded && !prefix.some((term) => locale.without.has(term))) return true;
      }
    }
    return false;
  };

  const matched = routes(config).filter((route) => route.aliases.some((alias) => requested(alias)));
  if (matched.length === 0) return null;
  const period = week(terms, today, locale);
  const selected = new Map<string, Access>();
  const topicPrefix = access.topic ? config.layout.topics + "/" + access.topic + "/" : "";
  for (const route of matched) {
    if (access.scope !== config.scopes.all && access.scope !== route.scope) continue;
    const candidates: [Period, string][] = [];
    for (const path of glob(access.root, route.sources)) {
      const rel = asPosix(relativeTo(path, access.root));
      if (!rel.startsWith(topicPrefix)) continue;
      const dates = filePeriod(rel, locale);
      // Only plans this call may read compete for "latest", so a hidden newer plan reveals nothing.
      if (dates && readable(opener(access, route, rel), rel)) candidates.push([dates, rel]);
    }
    let chosen: string[];
    if (period) {
      chosen = candidates.filter(([dates]) => dates[0].compare(period[1]) <= 0 && dates[1].compare(period[0]) >= 0)
        .map(([, rel]) => rel);
    } else {
      const current = candidates.filter(([dates]) => dates[0].compare(today) <= 0 && today.compare(dates[1]) <= 0);
      const past = candidates.filter(([dates]) => dates[0].compare(today) <= 0);
      const pool = current.length > 0 ? current : past;
      chosen = pool.length > 0 ? [latest(pool)] : [];
    }
    // Release only the chosen files, never the whole topic folder.
    for (const rel of chosen) selected.set(rel, opener(access, route, rel));
  }
  const notes: Note[] = [];
  for (const rel of sorted(selected.keys())) {
    try {
      notes.push(selected.get(rel)!.read(rel));
    } catch (error) {
      if (error instanceof AccessDenied) continue;
      throw error;
    }
  }
  return { notes, period };
}

/** max() over (period, path) tuples: latest start, then latest end, then the last path. */
function latest(pool: readonly [Period, string][]): string {
  const key = ([dates, rel]: readonly [Period, string]): (number | string)[] =>
    [dates[0].ordinal(), dates[1].ordinal(), rel];
  let best = pool[0]!;
  for (const item of pool.slice(1)) {
    if (compareTuples(key(item), key(best)) > 0) best = item;
  }
  return best[1];
}

/** The first table cell of a row, like line.split("|")[1]. */
function firstCell(line: string): string {
  return line.split("|")[1] ?? "";
}

export function rowDate(line: string, period: Period, locale: Locale): PyDate | null {
  if (!lstrip(line).startsWith("|")) return null;
  const match = locale.rowDate.exec(firstCell(line));
  if (!match?.groups) return null;
  const year = match.groups.year;
  const years: number[] = [];
  if (year) years.push(pyInt(year));
  else for (let value = period[0].year; value <= period[1].year; value++) years.push(value);
  for (const candidate of years) {
    let date: PyDate;
    try {
      date = new PyDate(candidate, pyInt(match.groups.month!), pyInt(match.groups.day!));
    } catch (error) {
      if (error instanceof RangeError) continue;
      throw error;
    }
    if (period[0].compare(date) <= 0 && date.compare(period[1]) <= 0) return date;
  }
  return null;
}

/** Line numbers of the H1, matching table rows and their header; plus the dates covered. */
export function planLines(note: Note, requested: Period, config: Config): [number[], PyDate[]] {
  const locale = getLocale(config.ui.locale);
  const sourcePeriod = filePeriod(note.path, locale);
  if (!sourcePeriod) return [[], []];
  const kept: number[] = [];
  const covered: PyDate[] = [];
  let header: number[] = [];
  let headerEmitted = false;
  splitlines(note.text).forEach((line, index) => {
    const number = index + 1;
    if (line.startsWith("# ")) kept.push(number);
    if (!lstrip(line).startsWith("|")) {
      headerEmitted = false;
      header = [];
      return;
    }
    const date = rowDate(line, sourcePeriod, locale);
    if (date) {
      if (requested[0].compare(date) <= 0 && date.compare(requested[1]) <= 0) {
        if (!headerEmitted) {
          kept.push(...header);
          headerEmitted = true;
        }
        kept.push(number);
        covered.push(date);
      }
    } else if (!locale.rowDate.test(firstCell(line))) {
      header.push(number);
    }
  });
  return [kept, covered];
}

