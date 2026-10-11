/** Read commands: `find` matching, ranking, limits and topics, and `context` filler words. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox, note } from "./harness.ts";
import type { Brain } from "./harness.ts";

const HEADER = /^(?<path>\S+) \| rev=(?<rev>[0-9a-f]{12}) \| updated=(?<updated>\S+) \| status=(?<status>\S+) \| scope=(?<scope>\S+)$/;
const DOC = "---\nupdated: 2026-10-04\nstatus: active\nkey_fact: Fact here.\n---\n\n# Docker\n\npnpm esbuild fails\n\n"
  + "## Open questions\n\nOne\n\n## Other\n\nTwo\n";

function brain(): Brain {
  return new Sandbox().brain();
}

function docker(): Brain {
  const target = brain();
  target.write("notes/docker.md", DOC);
  return target;
}

/** Python's str.splitlines(): no empty last line after a final newline. */
function splitlines(value: string): string[] {
  if (value === "") return [];
  return (value.endsWith("\n") ? value.slice(0, -1) : value).split("\n");
}

function linesOf(output: string): [number, string][] {
  const found: [number, string][] = [];
  for (const line of splitlines(output)) {
    const match = /^(\d+): ?(.*)$/.exec(line);
    if (match) found.push([Number(match[1]), match[2]!]);
  }
  return found;
}

// --- find ----------------------------------------------------------------------------------------------------------

test("find matches title, alias, key fact, path and body", () => {
  const target = brain();
  target.write("notes/by-title.md", note({ title: "Zebra" }));
  target.write("notes/other.md", note({ title: "Other", fields: "aliases: [giraffe]\n" }));
  target.write("notes/third.md", note({ title: "Third", fields: "key_fact: Contains okapi trivia.\n" }));
  target.write("notes/lion-facts.md", note({ title: "Fourth" }));
  target.write("notes/fifth.md", note({ title: "Fifth", body: "A mention of tapir in the body." }));
  for (const [term, rel] of [["zebra", "notes/by-title.md"], ["giraffe", "notes/other.md"],
    ["okapi", "notes/third.md"], ["lion", "notes/lion-facts.md"], ["tapir", "notes/fifth.md"]] as const) {
    assert.ok(target.run(["find", term]).out.includes(rel), term);
  }
});

test("find is case insensitive", () => {
  assert.ok(docker().run(["find", "DOCKER"]).out.includes("notes/docker.md"));
});

test("find header lists each hit and a blank line separates hits", () => {
  const target = brain();
  target.write("notes/one.md", note({ title: "One", body: "widget" }));
  target.write("notes/two.md", note({ title: "Two", body: "widget" }));
  const lines = splitlines(target.run(["find", "widget"]).out);
  assert.deepEqual(lines.filter((line) => HEADER.test(line)).map((line) => line.split(" ")[0]),
    ["notes/one.md", "notes/two.md"]);
  assert.ok(lines.includes(""));
});

test("find ranks notes with all keywords first", () => {
  const target = brain();
  target.write("notes/a-one.md", note({ title: "One", body: "alpha" }));
  target.write("notes/b-both.md", note({ title: "Both", body: "alpha beta" }));
  const hits: { path: string }[] = JSON.parse(target.run(["find", "alpha beta", "--json"]).out).hits;
  assert.deepEqual(hits.map((hit) => hit.path), ["notes/b-both.md"]);
  assert.equal(JSON.parse(target.run(["find", "alpha beta", "--json"]).out).match, "all");
});

function widgets(count: number): Brain {
  const target = brain();
  for (let index = 0; index < count; index++) {
    target.write("notes/n" + index + ".md", note({ title: "N" + index, body: "widget" }));
  }
  return target;
}

test("find --limit caps hits and sets more", () => {
  const packet = JSON.parse(widgets(5).run(["find", "widget", "--json", "--limit", "2"]).out);
  assert.equal(packet.hits.length, 2);
  assert.equal(packet.more, true);
});

test("find default limit is 3", () => {
  assert.equal(JSON.parse(widgets(5).run(["find", "widget", "--json"]).out).hits.length, 3);
});

test("find limit from the config applies", () => {
  const target = brain();
  target.configure("[limits]\nfind_limit = 1\n");
  for (let index = 0; index < 3; index++) {
    target.write("notes/n" + index + ".md", note({ title: "N" + index, body: "widget" }));
  }
  assert.equal(JSON.parse(target.run(["find", "widget", "--json"]).out).hits.length, 1);
});

test("find text announces more hits", () => {
  assert.ok(widgets(5).run(["find", "widget"]).out.includes("More hits available; narrow the search or raise --limit."));
});

test("find text announces partial match and missing terms", () => {
  const out = docker().run(["find", "docker pnpm zzz"]).out;
  assert.deepEqual(splitlines(out).slice(0, 2), ["Partial match: not all keywords match.", "Not found: zzz"]);
});

test("find excerpt lines exist in the file", () => {
  const fileLines = splitlines(DOC);
  for (const [number, text] of linesOf(docker().run(["find", "esbuild"]).out)) {
    assert.equal(fileLines[number - 1], text);
  }
});

for (const value of ["0", "11", "-1"]) {
  test("find --limit " + value + " (outside 1 to 10) exits 2", () => {
    const result = docker().run(["find", "docker", "--limit", value]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "--limit must be between 1 and 10.\n");
  });
}

test("find with an empty query exits 2", () => {
  const result = docker().run(["find", ""]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "The search needs at least one keyword.\n");
});

test("find with only punctuation exits 2", () => {
  assert.equal(docker().run(["find", "?!"]).code, 2);
});

test("find without results exits 0", () => {
  const result = docker().run(["find", "zzz"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "Nothing found in released sources.\nNot found: zzz\n");
});

test("find --topic limits the search to one topic folder", () => {
  const target = brain();
  target.write("topics/a/README.md", "---\nscope: work\n---\n\n# A\n\nwidget\n");
  target.write("topics/b/README.md", "---\nscope: work\n---\n\n# B\n\nwidget\n");
  const hits: { path: string }[] = JSON.parse(target.run(["find", "widget", "--topic", "a", "--json"]).out).hits;
  assert.deepEqual(hits.map((hit) => hit.path), ["topics/a/README.md"]);
});

test("find --topic rejects a bad topic name", () => {
  const result = docker().run(["find", "docker", "--topic", "a b"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Invalid topic name. Use letters, digits and hyphens.\n");
});

test("topic option denies reads outside the topic", () => {
  assert.equal(docker().run(["read", "notes/docker.md", "--topic", "elsewhere"]).code, 2);
});

// --- context -------------------------------------------------------------------------------------------------------

test("context names the ignored filler words", () => {
  const out = docker().run(["context", "What is the docker thing?"]).out;
  assert.ok(out.includes("Ignored: what, is, the"), out);
  assert.ok(out.includes("Not found: thing"), out);
});

test("context with only filler words finds nothing and exits 0", () => {
  const result = docker().run(["context", "the"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "Nothing found in released sources.\n");
});

test("context with an empty query exits 2", () => {
  const result = docker().run(["context", ""]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "The query needs at least one word.\n");
});

test("find keeps filler words as search terms", () => {
  assert.ok(!docker().run(["find", "what is docker"]).out.includes("Ignored:"));
});
