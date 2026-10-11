/** Process output and input for the CLI. */

import * as fs from "node:fs";

import { Rejected } from "@dummkopf/core";

export function out(text: string): void {
  writeAll(1, text);
}

export function err(text: string): void {
  writeAll(2, text);
}

/** Write synchronously, so output is complete when the exit code is set, even on a pipe. */
function writeAll(fd: number, text: string): void {
  const data = Buffer.from(text, "utf-8");
  let offset = 0;
  while (offset < data.length) {
    try {
      offset += fs.writeSync(fd, data, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
    }
  }
}

/** All of stdin as strict UTF-8 with universal newlines, like Python's sys.stdin.read(). */
export function readStdin(): string {
  return decode(fs.readFileSync(0));
}

export function decode(data: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/**
 * Text from a file or stdin (`-` or no path), at most `limit` code points.
 * Throws `input_unreadable` or `input_too_large`.
 */
export function readInput(path: string | null, limit: number): string {
  let text: string;
  try {
    text = path === null || path === "-" ? readStdin() : decode(fs.readFileSync(path));
  } catch {
    throw new Rejected("input_unreadable");
  }
  let count = 0;
  for (const _ of text) {
    if (++count > limit) throw new Rejected("input_too_large");
  }
  return text;
}
