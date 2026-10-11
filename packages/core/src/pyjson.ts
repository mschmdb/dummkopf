/**
 * JSON with Python's json module behavior: the same error messages with line and column, NaN and
 * Infinity accepted, and objects without a prototype. Tests and agents rely on these messages.
 */

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export class JsonDecodeError extends Error {
  readonly msg: string;
  readonly lineno: number;
  readonly colno: number;

  constructor(msg: string, doc: string, pos: number) {
    const before = doc.slice(0, pos);
    const lineno = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    // Python counts columns in code points.
    const colno = Array.from(doc.slice(lineStart, pos)).length + 1;
    super(msg + ": line " + lineno + " column " + colno);
    this.msg = msg;
    this.lineno = lineno;
    this.colno = colno;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
const WHITESPACE = /[ \t\n\r]*/y;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * Key order of a parsed object as Python's dict keeps it: first appearance in the source. JavaScript
 * objects list integer-like keys first, so code that must keep the order reads it from `keys()`.
 */
const KEY_ORDER = Symbol("keyOrder");

/** Keys in source order for objects from `loads`, else Object.keys. */
export function keys(value: JsonObject): string[] {
  const order = (value as { [KEY_ORDER]?: string[] })[KEY_ORDER];
  return order ? [...order] : Object.keys(value);
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** json.loads(text). */
export function loads(text: string): Json {
  if (text.startsWith("\ufeff")) throw new JsonDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", text, 0);
  const decoder = new Decoder(text);
  const start = decoder.skip(0);
  const [value, end] = decoder.value(start);
  const after = decoder.skip(end);
  if (after !== text.length) throw new JsonDecodeError("Extra data", text, after);
  return value;
}

class Decoder {
  private readonly s: string;

  constructor(s: string) {
    this.s = s;
  }

  skip(pos: number): number {
    WHITESPACE.lastIndex = pos;
    WHITESPACE.exec(this.s);
    return WHITESPACE.lastIndex;
  }

  private fail(msg: string, pos: number): never {
    throw new JsonDecodeError(msg, this.s, pos);
  }

  value(pos: number): [Json, number] {
    const s = this.s;
    const char = s[pos];
    if (char === '"') return this.string(pos + 1);
    if (char === "{") return this.object(pos + 1);
    if (char === "[") return this.array(pos + 1);
    if (char === "n" && s.startsWith("null", pos)) return [null, pos + 4];
    if (char === "t" && s.startsWith("true", pos)) return [true, pos + 4];
    if (char === "f" && s.startsWith("false", pos)) return [false, pos + 5];
    if (char === "N" && s.startsWith("NaN", pos)) return [NaN, pos + 3];
    if (char === "I" && s.startsWith("Infinity", pos)) return [Infinity, pos + 8];
    if (char === "-" && s.startsWith("-Infinity", pos)) return [-Infinity, pos + 9];
    NUMBER.lastIndex = pos;
    const match = NUMBER.exec(s);
    if (match) return [Number(match[0]), pos + match[0].length];
    return this.fail("Expecting value", pos);
  }

  private string(pos: number): [string, number] {
    const s = this.s;
    const begin = pos - 1;
    let out = "";
    let i = pos;
    for (;;) {
      if (i >= s.length) this.fail("Unterminated string starting at", begin);
      const char = s[i]!;
      if (char === '"') return [out, i + 1];
      if (char === "\\") {
        if (i + 1 >= s.length) this.fail("Unterminated string starting at", begin);
        const esc = s[i + 1]!;
        if (esc === "u") {
          const code = this.hex(i + 2, i);
          i += 6;
          if (code >= 0xd800 && code <= 0xdbff && s[i] === "\\" && s[i + 1] === "u") {
            const low = this.hex(i + 2, i);
            if (low >= 0xdc00 && low <= 0xdfff) {
              out += String.fromCharCode(code, low);
              i += 6;
              continue;
            }
          }
          out += String.fromCharCode(code);
          continue;
        }
        const mapped = ESCAPES[esc];
        if (mapped === undefined) this.fail("Invalid \\escape", i);
        out += mapped;
        i += 2;
        continue;
      }
      if (char.charCodeAt(0) < 0x20) this.fail("Invalid control character at", i);
      out += char;
      i++;
    }
  }

  private hex(pos: number, backslash: number): number {
    const digits = this.s.slice(pos, pos + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(digits)) this.fail("Invalid \\uXXXX escape", backslash);
    return parseInt(digits, 16);
  }

  private object(pos: number): [JsonObject, number] {
    const s = this.s;
    const result = Object.create(null) as JsonObject;
    const order: string[] = [];
    Object.defineProperty(result, KEY_ORDER, { value: order, enumerable: false });
    let i = this.skip(pos);
    if (s[i] === "}") return [result, i + 1];
    if (s[i] !== '"') this.fail("Expecting property name enclosed in double quotes", i);
    for (;;) {
      const [key, afterKey] = this.string(i + 1);
      i = this.skip(afterKey);
      if (s[i] !== ":") this.fail("Expecting ':' delimiter", i);
      i = this.skip(i + 1);
      const [value, afterValue] = this.value(i);
      if (!(key in result)) order.push(key);
      result[key] = value;
      i = this.skip(afterValue);
      if (s[i] === "}") return [result, i + 1];
      if (s[i] !== ",") this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skip(i + 1);
      if (s[i] === '"') continue;
      if (s[i] === "}") this.fail("Illegal trailing comma before end of object", comma);
      this.fail("Expecting property name enclosed in double quotes", i);
    }
  }

  private array(pos: number): [Json[], number] {
    const s = this.s;
    const result: Json[] = [];
    let i = this.skip(pos);
    if (s[i] === "]") return [result, i + 1];
    for (;;) {
      const [value, afterValue] = this.value(i);
      result.push(value);
      i = this.skip(afterValue);
      if (s[i] === "]") return [result, i + 1];
      if (s[i] !== ",") this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skip(i + 1);
      if (s[i] === "]") this.fail("Illegal trailing comma before end of array", comma);
    }
  }
}

/** json.dumps(value, ensure_ascii=False, separators=(",", ":")). */
export function dumpsCompact(value: unknown): string {
  return JSON.stringify(value);
}

/** json.dumps(value, ensure_ascii=False, indent=2). */
export function dumpsIndented(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
