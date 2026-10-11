/** Markdown table and section helpers for generated indexes. */

import { lstrip, rstrip, splitlines, strip } from "./py.ts";

const BACKTICK_RE = /^`([^`]+)`$/;

export function splitRow(line: string): string[] | null {
  let row = strip(line);
  if (!row.startsWith("|")) return null;
  row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => strip(cell).replaceAll("\\|", "|"));
}

export interface Row {
  readonly description: string;
  readonly aliases: string[];
}

/** Table rows whose first cell is a backticked path: path -> (description, aliases). */
export function scrapeRows(text: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const line of text.split("\n")) {
    const cells = splitRow(line);
    if (!cells || cells.length < 2) continue;
    const match = BACKTICK_RE.exec(cells[0]!);
    if (!match) continue;
    const aliases = cells.length > 2 ? cells[2]! : "";
    if (!rows.has(match[1]!)) {
      rows.set(match[1]!, {
        description: strip(cells[1]!),
        aliases: aliases.split(",").filter((alias) => strip(alias)).map((alias) => strip(alias)),
      });
    }
  }
  return rows;
}

export function cell(value: string): string {
  return strip(value.replaceAll("|", "\\|"));
}

export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const out = ["| " + header.join(" | ") + " |", "|" + header.map(() => "---").join("|") + "|"];
  for (const row of rows) out.push("| " + row.map(cell).join(" | ") + " |");
  return out;
}

/** [start, end) of a `## ` section including its heading line, or null. */
export function sectionBounds(lines: readonly string[], heading: string): [number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    if (strip(lines[i]!) === heading) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.startsWith("## ")) return [i, j];
      }
      return [i, lines.length];
    }
  }
  return null;
}

/** Swap only the first table of a section; prose around it stays. Changes `lines` in place. */
export function replaceTable(lines: string[], heading: string, newTable: readonly string[]): void {
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return;
  const [start, end] = bounds;
  let first: number | null = null;
  let last = 0;
  for (let k = start + 1; k < end; k++) {
    if (lstrip(lines[k]!).startsWith("|")) {
      if (first === null) first = k;
      last = k + 1;
    } else if (first !== null) {
      break;
    }
  }
  if (first === null) {
    let insert = end;
    while (insert > start + 1 && !strip(lines[insert - 1]!)) insert--;
    lines.splice(insert, 0, "", ...newTable);
  } else {
    lines.splice(first, last - first, ...newTable);
  }
}

/** Remove a section and a `---` rule right above it. */
export function dropSection(lines: readonly string[], heading: string): string[] {
  const bounds = sectionBounds(lines, heading);
  if (!bounds) return [...lines];
  let [start] = bounds;
  const end = bounds[1];
  let probe = start - 1;
  while (probe >= 0 && !strip(lines[probe]!)) probe--;
  if (probe >= 0 && strip(lines[probe]!) === "---") start = probe;
  const rest = [...lines.slice(0, start), ...lines.slice(end)];
  while (rest.length > 0 && !strip(rest[rest.length - 1]!)) rest.pop();
  return [...rest, ""];
}

/** Text without the generated file table, so regenerated tables never count as edits. */
export function authoredText(text: string, filesHeading: string): string {
  let lines = splitlines(text);
  const bounds = sectionBounds(lines, filesHeading);
  if (!bounds) return rstrip(lines.join("\n"));
  const [start, end] = bounds;
  const content = lines.slice(start + 1, end).filter((line) => !lstrip(line).startsWith("|"));
  if (content.some((line) => strip(line))) lines = [...lines.slice(0, start + 1), ...content, ...lines.slice(end)];
  else lines = [...lines.slice(0, start), ...lines.slice(end)];
  return rstrip(lines.join("\n"));
}
