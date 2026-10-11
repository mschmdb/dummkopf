/** Text and JSON output for read packets, always within the --max-chars budget. */

import { text as say } from "./messages.ts";
import { len, rstrip, slice } from "./py.ts";
import { dumpsCompact } from "./pyjson.ts";
import type { Packet, SourceLine } from "./search.ts";

export const SEARCH_LINE_BUDGET = 900;

export function render(packet: Packet, asJson: boolean, tone: string): string {
  if (asJson) return dumpsCompact(packet) + "\n";
  const output: string[] = [];
  if (packet.period) output.push(say("out_period", tone, { start: packet.period.start, end: packet.period.end }));
  if (packet.hits.length === 0) output.push(say("no_results", tone));
  if (packet.match === "partial") output.push(say("out_partial", tone));
  if (packet.ignored?.length) output.push(say("out_ignored", tone, { terms: packet.ignored.join(", ") }));
  if (packet.missing?.length) output.push(say("out_not_found", tone, { terms: packet.missing.join(", ") }));
  for (const hit of packet.hits) {
    output.push(hit.path + " | rev=" + slice(hit.revision, 0, 12) + " | updated=" + (hit.updated || "?") + " | "
      + "status=" + (hit.status || "?") + " | scope=" + hit.scope);
    if (hit.key_fact) output.push(say("out_key_fact", tone, { text: hit.key_fact }));
    for (const line of hit.lines) output.push(line.n + ": " + line.text);
    output.push("");
  }
  if (packet.more) output.push(say("out_more", tone));
  if (packet.truncated) output.push(say("out_truncated", tone));
  if (packet.missing_dates?.length) output.push(say("out_missing_dates", tone, { dates: packet.missing_dates.join(", ") }));
  return rstrip(output.join("\n")) + "\n";
}

export function bounded(original: Packet, maxChars: number, asJson: boolean, tone: string): string {
  const packet = structuredClone(original);
  for (const hit of packet.hits) {
    // Search hits stay short; direct reads use the whole requested budget.
    let remaining = packet.match === "direct" || packet.match === "routed" ? maxChars : SEARCH_LINE_BUDGET;
    const kept: SourceLine[] = [];
    for (const line of hit.lines) {
      if (remaining <= 0) {
        packet.truncated = true;
        break;
      }
      let text = line.text;
      if (len(text) > remaining) {
        text = slice(text, 0, Math.max(0, remaining - 1)) + "…";
        packet.truncated = true;
      }
      kept.push({ n: line.n, text });
      remaining -= len(text);
    }
    hit.lines = kept;
  }
  while (len(render(packet, asJson, tone)) > maxChars) {
    packet.truncated = true;
    // Trim search hints before sources; the first term (or its start) stays visible.
    const ignored = packet.ignored ?? [];
    const missing = packet.missing ?? [];
    if (ignored.length > 1) {
      ignored.pop();
      continue;
    }
    if (missing.length > 1) {
      missing.pop();
      continue;
    }
    if (ignored.length > 0 && len(ignored[0]!) > 32) {
      ignored[0] = slice(ignored[0]!, 0, 31) + "…";
      continue;
    }
    if (missing.length > 0 && len(missing[0]!) > 32) {
      missing[0] = slice(missing[0]!, 0, 31) + "…";
      continue;
    }
    if (packet.hits.length > 1) {
      packet.hits.pop();
      packet.more = true;
      continue;
    }
    if (packet.hits.length === 0) break;
    const hit = packet.hits[0]!;
    if (hit.lines.length > 1) {
      hit.lines.pop();
    } else if (hit.lines.length > 0 && len(hit.lines[0]!.text) > 30) {
      const text = hit.lines[0]!.text;
      const excess = len(render(packet, asJson, tone)) - maxChars;
      hit.lines[0]!.text = slice(text, 0, Math.max(20, len(text) - Math.max(excess, 10) - 1)) + "…";
    } else if (hit.key_fact) {
      hit.key_fact = "";
    } else if (hit.title) {
      hit.title = "";
    } else {
      packet.hits = [];
      break;
    }
  }
  return render(packet, asJson, tone);
}
