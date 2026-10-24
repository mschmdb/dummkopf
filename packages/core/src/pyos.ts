/**
 * File-system and path helpers with the semantics of Python's pathlib: `exists()` and `isFile()`
 * follow symlinks, `isSymlink()` does not, and errors read as "no".
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function stat(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target);
  } catch {
    return undefined;
  }
}

function lstat(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch {
    return undefined;
  }
}

export function exists(target: string): boolean {
  return stat(target) !== undefined;
}

export function isFile(target: string): boolean {
  return stat(target)?.isFile() ?? false;
}

export function isDir(target: string): boolean {
  return stat(target)?.isDirectory() ?? false;
}

export function isSymlink(target: string): boolean {
  return lstat(target)?.isSymbolicLink() ?? false;
}

/**
 * Paths inside rcllr are POSIX text. On Windows, absolute paths keep their drive letter (`C:/Users/...`)
 * and use forward slashes, which every Windows file API accepts.
 */
const WINDOWS = process.platform === "win32";

/** Backslashes become slashes on Windows; elsewhere a backslash is an ordinary file name character. */
export function posixSeparators(value: string, windows = WINDOWS): string {
  return windows ? value.replaceAll("\\", "/") : value;
}

/**
 * `/` for an absolute POSIX path; on Windows also `C:/` for a drive path and `//server/share/` for a
 * network path. Empty for a relative path.
 */
export function anchor(value: string, windows = WINDOWS): string {
  if (windows) {
    const found = /^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+(?:\/|$))/.exec(value);
    if (found) return found[0].endsWith("/") ? found[0] : found[0] + "/";
  }
  return value.startsWith("/") ? "/" : "";
}

const isAnchor = (part: string | undefined): boolean => part !== undefined && part.endsWith("/");

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/iu;
const WINDOWS_BAD_CHAR = /[<>:"|?*\u0000-\u001f]/u;

/**
 * True if a relative path has a component Windows would read differently from how it is spelled: an
 * alternate data stream (`a.md:x`), a device name (`CON`, `nul.md`), a trailing dot or space that Win32
 * strips, or a character Windows forbids. Always false off Windows.
 */
export function windowsUnsafe(value: string, windows = WINDOWS): boolean {
  if (!windows) return false;
  return value.split("/").some((part) => part !== "." && part !== ".." && (
    WINDOWS_BAD_CHAR.test(part) || part.endsWith(".") || part.endsWith(" ")
    || WINDOWS_DEVICE.test(part.split(".")[0]!.trimEnd())));
}

/** Path components like PurePosixPath(value).parts: `//` and `.` collapse, `..` stays. */
export function parts(value: string, windows = WINDOWS): string[] {
  const root = anchor(value, windows);
  const out = root ? [root] : [];
  for (const part of value.slice(root.length).split("/")) {
    if (part !== "" && part !== ".") out.push(part);
  }
  return out;
}

/** PurePosixPath(value).as_posix(). */
export function asPosix(value: string, windows = WINDOWS): string {
  const items = parts(value, windows);
  if (items.length === 0) return ".";
  if (isAnchor(items[0])) return items[0] + items.slice(1).join("/");
  return items.join("/");
}

/** `value` without trailing slashes. A loop, because /\/+$/ backtracks quadratically on long runs of "/". */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export function isAbsolute(value: string, windows = WINDOWS): boolean {
  return anchor(value, windows) !== "";
}

/** root / a / b without collapsing `..`, like pathlib. */
export function join(root: string, ...rest: string[]): string {
  let out = root;
  for (const part of rest) {
    if (isAbsolute(part)) out = part;
    else if (part !== "") out = out.endsWith("/") ? out + part : out + "/" + part;
  }
  return asPosix(out);
}

/** PurePosixPath(value).name. */
export function name(value: string, windows = WINDOWS): string {
  const items = parts(value, windows);
  const last = items[items.length - 1];
  return last === undefined || isAnchor(last) ? "" : last;
}

/** PurePosixPath(value).suffix: `.md` for `a.md`, empty for `.md` and `a.`. */
export function suffix(value: string): string {
  const base = name(value);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot);
}

/** PurePosixPath(value).stem. */
export function stem(value: string): string {
  const base = name(value);
  const ext = suffix(value);
  return ext ? base.slice(0, -ext.length) : base;
}

/** PurePosixPath(value).parent. */
export function parent(value: string, windows = WINDOWS): string {
  const items = parts(value, windows);
  const root = isAnchor(items[0]) ? items[0]! : "";
  if (items.length <= 1) return root || ".";
  return asPosix(root + items.slice(root ? 1 : 0, -1).join("/"), windows);
}

/** PurePosixPath(value).parents, nearest first; a relative path ends with `.`. */
export function parents(value: string, windows = WINDOWS): string[] {
  const out: string[] = [];
  let current = asPosix(value, windows);
  for (;;) {
    const up = parent(current, windows);
    if (up === current) break;
    out.push(up);
    current = up;
  }
  return out;
}

/** Path.resolve(): absolute, symlinks resolved as far as the path exists. POSIX separators on Windows. */
export function resolve(value: string): string {
  return posixSeparators(resolveNative(value));
}

function resolveNative(value: string): string {
  const absolute = path.resolve(value);
  try {
    // The native call on Windows expands 8.3 short names (RUNNER~1), so one folder has one spelling.
    return WINDOWS ? fs.realpathSync.native(absolute) : fs.realpathSync(absolute);
  } catch {
    const up = path.dirname(absolute);
    if (up === absolute) return absolute;
    return path.join(resolveNative(up), path.basename(absolute));
  }
}

/** True if child equals root or lies below it (both resolved, absolute). */
export function isRelativeTo(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith("/") ? root : root + "/");
}

/** child relative to root, as posix text. */
export function relativeTo(child: string, root: string): string {
  return asPosix(posixSeparators(path.relative(root, child)));
}

/** UTF-8 text, strict. Throws on invalid bytes, like read_bytes().decode("utf-8"). */
export function readBytesText(target: string): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(target));
}

/** Path.read_text(): strict UTF-8 with universal newlines (`\r\n` and `\r` become `\n`). */
export function readText(target: string, errors: "strict" | "ignore" = "strict"): string {
  const data = fs.readFileSync(target);
  const text = errors === "strict"
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data)
    : decodeIgnoringErrors(data);
  return universalNewlines(text);
}

export function universalNewlines(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** bytes.decode("utf-8", errors="ignore"): invalid sequences disappear. */
export function decodeIgnoringErrors(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    let out = "";
    let start = 0;
    let i = 0;
    const flush = (end: number): void => {
      if (end > start) out += new TextDecoder("utf-8", { ignoreBOM: true }).decode(data.subarray(start, end));
    };
    while (i < data.length) {
      const size = sequenceLength(data, i);
      if (size === 0) {
        flush(i);
        i++;
        start = i;
      } else {
        i += size;
      }
    }
    flush(i);
    return out;
  }
}

function sequenceLength(data: Uint8Array, i: number): number {
  const b0 = data[i]!;
  if (b0 < 0x80) return 1;
  const cont = (k: number, low = 0x80, high = 0xbf): boolean =>
    i + k < data.length && data[i + k]! >= low && data[i + k]! <= high;
  if (b0 >= 0xc2 && b0 <= 0xdf) return cont(1) ? 2 : 0;
  if (b0 === 0xe0) return cont(1, 0xa0) && cont(2) ? 3 : 0;
  if ((b0 >= 0xe1 && b0 <= 0xec) || b0 === 0xee || b0 === 0xef) return cont(1) && cont(2) ? 3 : 0;
  if (b0 === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0;
  if (b0 === 0xf0) return cont(1, 0x90) && cont(2) && cont(3) ? 4 : 0;
  if (b0 >= 0xf1 && b0 <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0;
  if (b0 === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0;
  return 0;
}

/** Path.write_text(): UTF-8, no newline translation on POSIX. */
export function writeText(target: string, text: string): void {
  fs.writeFileSync(target, text, "utf-8");
}

export function listdir(target: string): string[] {
  return fs.readdirSync(target);
}

/**
 * fnmatch.fnmatchcase(name, pattern) as a regular expression, ported from Python 3.13's
 * fnmatch._translate: an unclosed `[` is literal, reversed ranges like `[z-a]` match nothing, and an
 * empty set never matches.
 */
export function fnmatchRegExp(pattern: string): RegExp {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
  let out = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const char = pattern[i]!;
    i++;
    if (char === "*") {
      out += "[\\s\\S]*";
    } else if (char === "?") {
      out += "[\\s\\S]";
    } else if (char === "[") {
      let j = i;
      if (j < n && pattern[j] === "!") j++;
      if (j < n && pattern[j] === "]") j++;
      while (j < n && pattern[j] !== "]") j++;
      if (j >= n) {
        out += "\\[";
        continue;
      }
      let stuff = pattern.slice(i, j);
      if (!stuff.includes("-")) {
        stuff = stuff.replaceAll("\\", "\\\\");
      } else {
        const chunks: string[] = [];
        let start = i;
        let k = pattern[i] === "!" ? i + 2 : i + 1;
        for (;;) {
          k = pattern.indexOf("-", k);
          if (k < 0 || k >= j) break;
          chunks.push(pattern.slice(start, k));
          start = k + 1;
          k = k + 3;
        }
        const chunk = pattern.slice(start, j);
        if (chunk) chunks.push(chunk);
        else chunks[chunks.length - 1] += "-";
        // Remove empty ranges: they are invalid in a regular expression.
        for (let m = chunks.length - 1; m > 0; m--) {
          if (chunks[m - 1]!.slice(-1) > chunks[m]!.slice(0, 1)) {
            chunks[m - 1] = chunks[m - 1]!.slice(0, -1) + chunks[m]!.slice(1);
            chunks.splice(m, 1);
          }
        }
        stuff = chunks.map((part) => part.replaceAll("\\", "\\\\").replaceAll("-", "\\-")).join("-");
      }
      i = j + 1;
      if (!stuff) {
        out += "(?!)";
      } else if (stuff === "!") {
        out += "[\\s\\S]";
      } else {
        // Inside a `u` class only these need escaping; `&` and `~` are plain characters there.
        stuff = stuff.replace(/[|\]\[/{}()]/g, "\\$&");
        if (stuff.startsWith("!")) stuff = "^" + stuff.slice(1);
        else if (stuff.startsWith("^")) stuff = "\\" + stuff;
        out += "[" + stuff + "]";
      }
    } else {
      out += escape(char);
    }
  }
  return new RegExp("^(?:" + out + ")$", "u");
}

/** Path.rglob(name pattern) below root: no descent into symlinked folders, dot files included. */
export function rglob(root: string, pattern: string): string[] {
  const matcher = fnmatchRegExp(pattern);
  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = directory + "/" + entry.name;
      if (matcher.test(entry.name)) found.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}

/** Path(root).glob(pattern) for patterns with wildcards only in the last component. */
export function glob(root: string, pattern: string): string[] {
  const items = parts(pattern);
  const last = items.pop();
  if (last === undefined) return [];
  let directory = root;
  for (const part of items) {
    directory = join(directory, part);
    if (!isDir(directory)) return [];
  }
  if (!/[*?[]/.test(last)) {
    const target = join(directory, last);
    return exists(target) ? [target] : [];
  }
  const matcher = fnmatchRegExp(last);
  try {
    return fs.readdirSync(directory).filter((entry) => matcher.test(entry)).map((entry) => join(directory, entry));
  } catch {
    return [];
  }
}
