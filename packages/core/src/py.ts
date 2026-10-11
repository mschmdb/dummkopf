/**
 * Python-compatible string helpers. The Python release defined the output byte for byte, and the
 * black-box suite checks it, so lengths count code points and whitespace follows str.isspace().
 */

/** Characters Python's str.isspace() accepts; also what `\s` matches in a Python str pattern. */
export const WS_CHARS = "\\t\\n\\x0b\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** `\s` of a Python str pattern, for building regular expressions. */
export const WS = "[" + WS_CHARS + "]";
/** `\w` of a Python str pattern: letters, numbers and the underscore. */
export const WORD = "[\\p{L}\\p{N}_]";
/** `\b` of a Python str pattern; JavaScript's `\b` knows only ASCII. */
export const BOUNDARY = "(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))";

const WS_RE = new RegExp("^" + WS + "$", "u");
const LINE_BREAK = /\r\n|[\n\r\x0b\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const ASCII = /^[\x00-\x7f]*$/;

export function isSpace(char: string): boolean {
  return WS_RE.test(char);
}

/** Number of code points, like Python's len(). */
export function len(value: string): number {
  if (ASCII.test(value)) return value.length;
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** value[start:end] in code points; negative indexes count from the end, like Python. */
export function slice(value: string, start: number, end?: number): string {
  if (ASCII.test(value)) return value.slice(start, end);
  return Array.from(value).slice(start, end).join("");
}

/** str.strip() without arguments, or with a set of characters. */
export function strip(value: string, chars?: string): string {
  return rstrip(lstrip(value, chars), chars);
}

export function lstrip(value: string, chars?: string): string {
  const points = Array.from(value);
  let start = 0;
  while (start < points.length && stripped(points[start]!, chars)) start++;
  return start === 0 ? value : points.slice(start).join("");
}

export function rstrip(value: string, chars?: string): string {
  const points = Array.from(value);
  let end = points.length;
  while (end > 0 && stripped(points[end - 1]!, chars)) end--;
  return end === points.length ? value : points.slice(0, end).join("");
}

function stripped(char: string, chars: string | undefined): boolean {
  return chars === undefined ? isSpace(char) : chars.includes(char);
}

/** str.splitlines(): every Unicode line break, no empty last element. */
export function splitlines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split(LINE_BREAK);
  if (LINE_BREAK.test(value.slice(-1))) lines.pop();
  return lines;
}

/** str.split() without arguments: runs of whitespace, no empty items. */
export function splitWhitespace(value: string): string[] {
  return value.split(new RegExp(WS + "+", "u")).filter((part) => part !== "");
}

/** str.casefold(), close enough for search: ß becomes ss, Σ becomes σ, ligatures split. */
export function casefold(value: string): string {
  const lower = value.toLowerCase();
  if (ASCII.test(lower)) return lower;
  return lower.replace(/[^\x00-\x7f]/gu, (char) => char.toUpperCase().toLowerCase());
}

/** str.count(sub) for a non-empty sub: non-overlapping occurrences. */
export function count(value: string, sub: string): number {
  if (sub === "") return len(value) + 1;
  let found = 0;
  let index = value.indexOf(sub);
  while (index !== -1) {
    found++;
    index = value.indexOf(sub, index + sub.length);
  }
  return found;
}

/** Python's str() for the values dummkopf formats into messages. */
export function str(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (Array.isArray(value)) return "[" + value.map(repr).join(", ") + "]";
  return String(value);
}

/** Python's repr() for strings and simple values. */
export function repr(value: unknown): string {
  if (typeof value !== "string") return str(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\") out += "\\\\";
    else if (char === quote) out += "\\" + quote;
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += char;
  }
  return out + quote;
}

/** str.format() with named fields only: `{name}`, `{{` and `}}`. */
export function format(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    if (!(name! in params)) throw new Error("missing format field " + name);
    return str(params[name!]);
  });
}

/** Unique items in first-seen order, like list(dict.fromkeys(items)). */
export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** Python's sort order for strings: by code point, not by UTF-16 unit. */
export function compare(a: string, b: string): number {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    if (x.value !== y.value) return x.value.codePointAt(0)! - y.value.codePointAt(0)!;
  }
}

export function sorted(items: Iterable<string>): string[] {
  return [...items].sort(compare);
}

/** Compare tuples of numbers, strings and booleans the way Python orders tuples. */
export function compareTuples(a: readonly (number | string | boolean)[], b: readonly (number | string | boolean)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (typeof x === "string" && typeof y === "string") return compare(x, y);
    return Number(x) < Number(y) ? -1 : 1;
  }
  return a.length - b.length;
}

/** Regex escaping like re.escape, valid in `u` mode patterns (outside character classes). */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}
