/**
 * Python's urllib.parse.urlsplit/unquote and posixpath helpers, as far as link checks use them.
 *
 * Link checks must classify a reference exactly like the Python release did, so these follow
 * CPython 3.13 step by step, including the ValueError cases of urlsplit.
 */

const C0_CONTROL_OR_SPACE = /^[\x00-\x20]+/;
const SCHEME_CHARS = /^[A-Za-z0-9+\-.]+$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}/;

/** urlsplit raised ValueError. */
export class UrlError extends Error {}

export interface SplitResult {
  scheme: string;
  netloc: string;
  path: string;
  query: string;
  fragment: string;
}

/** str.partition(sep). */
function partition(value: string, sep: string): [string, string, string] {
  const at = value.indexOf(sep);
  return at === -1 ? [value, "", ""] : [value.slice(0, at), sep, value.slice(at + sep.length)];
}

function splitNetloc(url: string, start: number): [string, string] {
  let delim = url.length;
  for (const char of "/?#") {
    const found = url.indexOf(char, start);
    if (found >= 0) delim = Math.min(delim, found);
  }
  return [url.slice(start, delim), url.slice(delim)];
}

function isAsciiText(value: string): boolean {
  return /^[\x00-\x7f]*$/.test(value);
}

function checkNetloc(netloc: string): void {
  if (!netloc || isAsciiText(netloc)) return;
  // Characters like U+2100 expand to `a/c` under NFKC, which IDNA applies.
  const n = netloc.replaceAll("@", "").replaceAll(":", "").replaceAll("#", "").replaceAll("?", "");
  const normalized = n.normalize("NFKC");
  if (n === normalized) return;
  for (const char of "/?#@:") {
    if (normalized.includes(char)) throw new UrlError("netloc contains invalid characters under NFKC normalization");
  }
}

/** ipaddress.IPv4Address(value) succeeds. */
export function isIPv4(value: string): boolean {
  if (!value || value.includes("/")) return false;
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => /^[0-9]{1,3}$/.test(octet) && (octet === "0" || octet[0] !== "0")
    && Number(octet) <= 255);
}

function hextet(value: string): boolean {
  return /^[0-9A-Fa-f]{1,4}$/.test(value);
}

/** ipaddress.IPv6Address(value) succeeds, scope id included. */
export function isIPv6(value: string): boolean {
  if (value.includes("/")) return false;
  const [address, sep, scope] = partition(value, "%");
  if (sep && (!scope || scope.includes("%"))) return false;
  if (!address || Array.from(address).length > 45) return false;
  const pieces = address.split(":");
  // split(":", maxsplit=9)
  const parts = pieces.length > 10 ? [...pieces.slice(0, 9), pieces.slice(9).join(":")] : pieces;
  if (parts.length < 3) return false;
  if (parts[parts.length - 1]!.includes(".")) {
    if (!isIPv4(parts.pop()!)) return false;
    parts.push("0", "0");
  }
  if (parts.length > 9) return false;
  let skip: number | null = null;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parts[i]) {
      if (skip !== null) return false;
      skip = i;
    }
  }
  let hi: number;
  let lo: number;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0]) {
      hi -= 1;
      if (hi) return false;
    }
    if (!parts[parts.length - 1]) {
      lo -= 1;
      if (lo) return false;
    }
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
    hi = parts.length;
    lo = 0;
  }
  return parts.slice(0, hi).every(hextet) && parts.slice(parts.length - lo).every((part) => lo === 0 || hextet(part));
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = netloc.slice(netloc.lastIndexOf("@") + 1);
  const [before, open, bracketed] = partition(hostAndPort, "[");
  let hostname: string;
  if (open) {
    if (before) throw new UrlError("Invalid IPv6 URL");
    const [host, , port] = partition(bracketed, "]");
    if (port && !port.startsWith(":")) throw new UrlError("Invalid IPv6 URL");
    hostname = host;
  } else {
    hostname = partition(hostAndPort, ":")[0];
  }
  if (hostname.startsWith("v") || hostname.startsWith("V")) {
    if (!/^[vV][a-fA-F0-9]+\.[^\n]+$/u.test(hostname)) throw new UrlError("IPvFuture address is invalid");
  } else if (!isIPv6(hostname)) {
    throw new UrlError("Invalid IPv6 URL");
  }
}

/** urllib.parse.urlsplit(url); throws UrlError where Python raises ValueError. */
export function urlsplit(input: string): SplitResult {
  let url = input.replace(C0_CONTROL_OR_SPACE, "").replace(/[\t\r\n]/g, "");
  let scheme = "";
  let netloc = "";
  let query = "";
  let fragment = "";
  const colon = url.indexOf(":");
  if (colon > 0 && /^[A-Za-z]/.test(url) && SCHEME_CHARS.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  if (url.startsWith("//")) {
    [netloc, url] = splitNetloc(url, 2);
    const open = netloc.includes("[");
    const close = netloc.includes("]");
    if (open !== close) throw new UrlError("Invalid IPv6 URL");
    if (open && close) checkBracketedNetloc(netloc);
  }
  if (url.includes("#")) [url, , fragment] = partition(url, "#");
  if (url.includes("?")) [url, , query] = partition(url, "?");
  checkNetloc(netloc);
  return { scheme, netloc, path: url, query, fragment };
}

/** urllib.parse.unquote(text): %XX escapes decoded as UTF-8, invalid bytes replaced. */
export function unquote(text: string): string {
  if (!text.includes("%")) return text;
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  let out = "";
  let bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length > 0) out += decoder.decode(new Uint8Array(bytes));
    bytes = [];
  };
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code >= 0x80) {
      // Python decodes each ASCII run on its own; non-ASCII text passes through unchanged.
      flush();
      const char = String.fromCodePoint(text.codePointAt(i)!);
      out += char;
      i += char.length;
    } else if (text[i] === "%" && HEX_PAIR.test(text.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      bytes.push(code);
      i += 1;
    }
  }
  flush();
  return out;
}

/** posixpath.normpath(path). */
export function normpath(path: string): string {
  if (path === "") return ".";
  let initial = path.startsWith("/") ? 1 : 0;
  if (initial && path.startsWith("//") && !path.startsWith("///")) initial = 2;
  const comps: string[] = [];
  for (const comp of path.split("/")) {
    if (comp === "" || comp === ".") continue;
    if (comp !== ".." || (!initial && comps.length === 0) || (comps.length > 0 && comps[comps.length - 1] === "..")) {
      comps.push(comp);
    } else if (comps.length > 0) {
      comps.pop();
    }
  }
  const result = "/".repeat(initial) + comps.join("/");
  return result || ".";
}

/** posixpath.join(a, b). */
export function joinPosix(a: string, b: string): string {
  if (b.startsWith("/")) return b;
  if (a === "" || a.endsWith("/")) return a + b;
  return a + "/" + b;
}

/** posixpath.dirname(path). */
export function dirname(path: string): string {
  const head = path.slice(0, path.lastIndexOf("/") + 1);
  if (head && !/^\/+$/.test(head)) return head.replace(/\/+$/, "");
  return head;
}

/** posixpath.isabs(path). */
export function isabs(path: string): boolean {
  return path.startsWith("/");
}
