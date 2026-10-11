/** Read commands: output budgets (--max-chars) for text and JSON. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox, note } from "./harness.ts";
import type { Brain } from "./harness.ts";

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

function longNote(): Brain {
  const target = brain();
  const body = Array.from({ length: 200 }, (_, index) => "Line " + index + " " + "x".repeat(60)).join("\n");
  target.write("notes/long.md", note({ title: "Long", body }));
  return target;
}

/** Length in characters (code points), as Python's len() counts them. */
function chars(value: string): number {
  return [...value].length;
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

for (const budget of [500, 777, 2000]) {
  test("read text stays within --max-chars " + budget, () => {
    const out = longNote().run(["read", "notes/long.md", "--max-chars", String(budget)]).out;
    assert.ok(chars(out) <= budget, String(chars(out)));
    assert.ok(out.includes("Output truncated; read specific lines or raise --max-chars."), out);
  });
}

for (const budget of [500, 777, 2000]) {
  test("read JSON stays within --max-chars " + budget + " and stays valid", () => {
    const out = longNote().run(["read", "notes/long.md", "--json", "--max-chars", String(budget)]).out;
    assert.ok(chars(out) <= budget, String(chars(out)));
    assert.equal(JSON.parse(out).truncated, true);
  });
}

test("truncated read keeps the first lines", () => {
  const numbered = linesOf(longNote().run(["read", "notes/long.md", "--max-chars", "800"]).out);
  assert.equal(numbered[0]![1], "# Long");
  const first = numbered[0]![0];
  assert.deepEqual(numbered.map(([number]) => number), Array.from({ length: numbered.length }, (_, index) => first + index));
});

test("read within the budget is not truncated", () => {
  assert.equal(JSON.parse(docker().run(["read", "notes/docker.md", "--json"]).out).truncated, false);
});

test("find output stays within --max-chars", () => {
  const target = brain();
  for (let index = 0; index < 6; index++) {
    target.write("notes/n" + index + ".md", note({ title: "N" + index, body: "widget " + "y".repeat(200) }));
  }
  const result = target.run(["find", "widget", "--limit", "6", "--json", "--max-chars", "500"]);
  assert.ok(chars(result.out) <= 500, String(chars(result.out)));
  const packet = JSON.parse(result.out);
  assert.equal(packet.truncated, true);
  assert.ok(packet.hits.length < 6);
  assert.equal(packet.more, true);
});

test("max chars comes from the config when not given", () => {
  const target = longNote();
  target.configure("[limits]\nmax_chars = 600\n");
  assert.ok(chars(target.run(["read", "notes/long.md"]).out) <= 600);
});

for (const value of ["499", "20001", "0"]) {
  test("--max-chars " + value + " (outside 500 to 20000) exits 2", () => {
    const result = docker().run(["find", "docker", "--max-chars", value]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "--max-chars must be between 500 and 20000.\n");
  });
}

test("max chars is checked for read too", () => {
  assert.equal(docker().run(["read", "notes/docker.md", "--max-chars", "10"]).code, 2);
});

test("non-numeric max chars exits 2", () => {
  const result = docker().run(["find", "docker", "--max-chars", "abc"]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("invalid int value"), result.err);
});
