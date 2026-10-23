/**
 * The small YAML subset rcllr reads and writes: scalars, inline lists, block lists.
 *
 * No YAML library. Values are strings or lists of strings. Data is a Map, so key order survives
 * exactly as written, numeric keys included.
 */

import { len, rstrip, slice, str, strip, WS } from "./py.ts";

export const SUMMARY_MAX = 160;
export const KEY_RE = new RegExp("^([A-Za-z0-9_.\\-]+)" + WS + "*:" + WS + "*([^\\n]*)$", "u");
const ITEM_RE = new RegExp("^" + WS + "*-" + WS + "+([^\\n]*)$", "u");

export type Value = string | string[];
export type Data = Map<string, Value>;

function unescape(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      const next = text[i + 1]!;
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 2;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function unquote(raw: string): string {
  const value = strip(raw);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return unescape(value.slice(1, -1));
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function splitInline(raw: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  let i = 0;
  while (i < raw.length) {
    const char = raw[i]!;
    if (quote) {
      if (char === "\\" && quote === '"' && i + 1 < raw.length) {
        current += char + raw[i + 1];
        i += 2;
        continue;
      }
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
    i++;
  }
  items.push(current);
  return items.filter((item) => strip(item) !== "").map(unquote);
}

function needsQuotes(value: string, inline: boolean): boolean {
  if (value === "" || value !== strip(value)) return true;
  if ("-?:,[]{}#&*!|>%@`'\"".includes(value[0]!)) return true;
  const triggers = [":", "#", '"', "'", "\n", "\\", ...(inline ? [",", "[", "]", "{", "}"] : [])];
  return triggers.some((char) => value.includes(char));
}

/** inline=true: the value sits in a `[a, b]` list, where a comma separates items. */
export function dumpScalar(value: string, inline = false): string {
  if (needsQuotes(value, inline)) {
    const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\t", "\\t");
    return '"' + escaped + '"';
  }
  return value;
}

export function dumpFrontmatter(data: Data): string {
  const lines = ["---"];
  for (const [key, value] of data) {
    if (Array.isArray(value)) lines.push(key + ": [" + value.map((item) => dumpScalar(item, true)).join(", ") + "]");
    else lines.push(key + ": " + dumpScalar(value));
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function parseBlock(lines: string[]): Data {
  const data: Data = new Map();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!strip(line) || line.replace(new RegExp("^" + WS + "+", "u"), "").startsWith("#")) {
      i++;
      continue;
    }
    const match = KEY_RE.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1]!;
    const raw = strip(match[2]!);
    if (raw === "") {
      const items: string[] = [];
      let j = i + 1;
      let item: RegExpExecArray | null;
      while (j < lines.length && (item = ITEM_RE.exec(lines[j]!))) {
        items.push(unquote(item[1]!));
        j++;
      }
      if (items.length > 0) {
        data.set(key, items);
        i = j;
        continue;
      }
      data.set(key, "");
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      data.set(key, splitInline(raw.slice(1, -1)));
    } else {
      data.set(key, unquote(raw));
    }
    i++;
  }
  return data;
}

export interface Parsed {
  data: Data;
  /** The text after the closing `---`, byte-identical. */
  body: string;
  present: boolean;
}

export function parseFrontmatter(text: string): Parsed {
  const lines = text.split("\n");
  if (strip(lines[0]!) !== "---") return { data: new Map(), body: text, present: false };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const value = strip(lines[i]!);
    if (value === "---" || value === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: new Map(), body: text, present: false };
  return { data: parseBlock(lines.slice(1, end)), body: lines.slice(end + 1).join("\n"), present: true };
}

export function shorten(text: string, limit: number = SUMMARY_MAX): string {
  if (len(text) <= limit) return text;
  let cut = slice(text, 0, limit - 1);
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  return rstrip(cut) + "…";
}

/**
 * Python's `str(value or fallback)` for a frontmatter value: a missing value, an empty string and an
 * empty list fall back; a list prints like a Python list, `['a', 'b']`.
 */
export function textOr(value: Value | undefined, fallback = ""): string {
  if (value === undefined || value.length === 0) return fallback;
  return Array.isArray(value) ? str(value) : value;
}
