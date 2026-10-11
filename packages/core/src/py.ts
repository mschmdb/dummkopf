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

/** `\\d` of a Python str pattern: any Unicode decimal digit, not only 0-9. */
export const DIGIT = "\\p{Nd}";

const WS_RE = new RegExp("^" + WS + "$", "u");
const LINE_BREAK = /\r\n|[\n\r\x0b\f\x1c\x1d\x1e\x85\u2028\u2029]/;
const ASCII = /^[\x00-\x7f]*$/;

export function isSpace(char: string): boolean {
  return WS_RE.test(char);
}

const DIGIT_RE = new RegExp("^" + DIGIT + "$", "u");

/** int() of a run of decimal digits, which may be non-ASCII: `١٠` is 10, like in Python. */
export function pyInt(digits: string): number {
  let value = 0;
  for (const char of digits) {
    const code = char.codePointAt(0)!;
    // Unicode decimal digits come in runs of ten, and runs can touch (U+1D7CE to U+1D7FF): find the
    // start of the whole block, then count in tens from there.
    let start = code;
    while (DIGIT_RE.test(String.fromCodePoint(start - 1))) start--;
    value = value * 10 + ((code - start) % 10);
  }
  return value;
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

/**
 * str.casefold(): ß becomes ss, Σ becomes σ, ligatures split. Upper-then-lower per character gives
 * the full case folding except where Python differs: the dotless ı stays itself, and Cherokee folds
 * to its capital letters.
 */
export function casefold(value: string): string {
  const lower = value.toLowerCase();
  if (ASCII.test(lower)) return lower;
  return lower.replace(/[^\x00-\x7f]/gu, (char) => {
    const code = char.codePointAt(0)!;
    if (code === 0x131) return char;
    if (code >= 0xab70 && code <= 0xabbf) return String.fromCodePoint(code - 0xab70 + 0x13a0);
    if (code >= 0x13f8 && code <= 0x13fd) return String.fromCodePoint(code - 8);
    return char.toUpperCase().toLowerCase();
  });
}

/** Python's re case fixes (re._casefix): characters that share an uppercase form, not a lowercase one. */
const CASE_FIXES: Readonly<Record<number, readonly number[]>> = {
  0x69: [0x131], 0x73: [0x17f], 0xb5: [0x3bc], 0x131: [0x69], 0x17f: [0x73], 0x345: [0x3b9, 0x1fbe],
  0x390: [0x1fd3], 0x3b0: [0x1fe3], 0x3b2: [0x3d0], 0x3b5: [0x3f5], 0x3b8: [0x3d1], 0x3b9: [0x345, 0x1fbe],
  0x3ba: [0x3f0], 0x3bc: [0xb5], 0x3c0: [0x3d6], 0x3c1: [0x3f1], 0x3c2: [0x3c3], 0x3c3: [0x3c2],
  0x3c6: [0x3d5], 0x3d0: [0x3b2], 0x3d1: [0x3b8], 0x3d5: [0x3c6], 0x3d6: [0x3c0], 0x3f0: [0x3ba],
  0x3f1: [0x3c1], 0x3f5: [0x3b5], 0x432: [0x1c80], 0x434: [0x1c81], 0x43e: [0x1c82], 0x441: [0x1c83],
  0x442: [0x1c84, 0x1c85], 0x44a: [0x1c86], 0x463: [0x1c87], 0x1c80: [0x432], 0x1c81: [0x434],
  0x1c82: [0x43e], 0x1c83: [0x441], 0x1c84: [0x442, 0x1c85], 0x1c85: [0x442, 0x1c84], 0x1c86: [0x44a],
  0x1c87: [0x463], 0x1c88: [0xa64b], 0x1e61: [0x1e9b], 0x1e9b: [0x1e61], 0x1fbe: [0x345, 0x3b9],
  0x1fd3: [0x390], 0x1fe3: [0x3b0], 0xa64b: [0x1c88], 0xfb05: [0xfb06], 0xfb06: [0xfb05],
};

/** Non-ASCII characters whose simple lowercase is an ASCII letter. */
const ASCII_LOWER_EXTRAS: Readonly<Record<string, readonly string[]>> = { i: ["\u0130"], k: ["\u212a"] };

/** The simple lowercase mapping Python's re uses: one character in, one out. */
function simpleLower(char: string): string {
  if (char === "\u0130") return "i";
  const lower = char.toLowerCase();
  return Array.from(lower).length === 1 ? lower : char;
}

let lowerSources: Map<string, string[]> | null = null;

/** Every character whose simple lowercase is `target`. */
function charsLoweringTo(target: string): string[] {
  if (target.length === 1 && target < "\x80") {
    const found = new Set([target, target.toUpperCase(), ...(ASCII_LOWER_EXTRAS[target] ?? [])]);
    return [...found].filter((char) => simpleLower(char) === target);
  }
  if (lowerSources === null) {
    lowerSources = new Map();
    for (let code = 0; code <= 0x2ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      const lower = simpleLower(char);
      const list = lowerSources.get(lower);
      if (list) list.push(char);
      else lowerSources.set(lower, [char]);
    }
  }
  return lowerSources.get(target) ?? [target];
}

/**
 * Regex source that matches `text` literally the way a Python pattern with re.IGNORECASE does.
 * JavaScript's `i` flag uses Unicode case folding and misses pairs Python accepts, such as `İ`
 * and `ı` for `i`, or `ſ` for `s`. Use it with the `u` flag and without `i`.
 */
export function ignoreCase(text: string): string {
  let out = "";
  for (const char of text) {
    const lower = simpleLower(char);
    const targets = [lower, ...(CASE_FIXES[lower.codePointAt(0)!] ?? []).map((code) => String.fromCodePoint(code))];
    const members = new Set(targets.flatMap(charsLoweringTo));
    if (members.size <= 1) {
      out += escapeRegExp(char);
    } else {
      out += "[" + [...members].map((member) => member.replace(/[\\\]\[^-]/g, "\\$&")).join("") + "]";
    }
  }
  return out;
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
