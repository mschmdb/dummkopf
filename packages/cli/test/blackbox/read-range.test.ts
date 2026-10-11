/** Read commands: `read --section`, line ranges, path rules, and the top-level help. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox } from "./harness.ts";
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

function readLines(target: Brain, ...args: string[]): [number, string][] {
  return linesOf(target.run(["read", "notes/docker.md", ...args]).out);
}

// --- sections ------------------------------------------------------------------------------------------------------

test("section returns the heading through the line before the next equal or higher heading", () => {
  assert.deepEqual(readLines(docker(), "--section", "Open questions"),
    [[11, "## Open questions"], [12, ""], [13, "One"], [14, ""]]);
});

test("section matches the start of the heading ignoring case", () => {
  assert.deepEqual(readLines(docker(), "--section", "open")[0], [11, "## Open questions"]);
});

test("section includes nested headings", () => {
  const target = brain();
  target.write("notes/nest.md", "# Top\n\n## Parent\n\ntext\n\n### Child\n\ndeep\n\n## Sibling\n\nlast\n");
  const out = target.run(["read", "notes/nest.md", "--section", "parent"]).out;
  assert.deepEqual(linesOf(out).map(([, text]) => text), ["## Parent", "", "text", "", "### Child", "", "deep", ""]);
});

test("last section runs to the end of the file", () => {
  assert.deepEqual(readLines(docker(), "--section", "Other").at(-1), [17, "Two"]);
});

test("section JSON has the section lines", () => {
  const out = docker().run(["read", "notes/docker.md", "--section", "Other", "--json"]).out;
  const lines: { n: number }[] = JSON.parse(out).hits[0].lines;
  assert.deepEqual(lines.map((line) => line.n), [15, 16, 17]);
});

test("section ignores headings inside code fences", () => {
  const target = brain();
  target.write("notes/fence.md", "# Top\n\n```\n## Fake\n```\n\n## Real\n\nbody\n");
  assert.equal(target.run(["read", "notes/fence.md", "--section", "fake"]).code, 2);
});

test("missing section exits 2", () => {
  const result = docker().run(["read", "notes/docker.md", "--section", "Nope"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "The section is missing or ambiguous. Give a more precise heading.\n");
});

test("ambiguous section exits 2", () => {
  const target = brain();
  target.write("notes/dup.md", "# Top\n\n## Same\n\na\n\n## Same\n\nb\n");
  assert.equal(target.run(["read", "notes/dup.md", "--section", "same"]).code, 2);
});

test("section without words exits 2", () => {
  const result = docker().run(["read", "notes/docker.md", "--section", "!!"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "A section needs a heading.\n");
});

test("section with a line range exits 2", () => {
  const result = docker().run(["read", "notes/docker.md", "--section", "Other", "--start", "3"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Do not combine --section with a line range.\n");
});

// --- line ranges ---------------------------------------------------------------------------------------------------

test("start and end select an inclusive range", () => {
  assert.deepEqual(readLines(docker(), "--start", "9", "--end", "11"),
    [[9, "pnpm esbuild fails"], [10, ""], [11, "## Open questions"]]);
});

test("start 1 shows the frontmatter", () => {
  assert.deepEqual(readLines(docker(), "--start", "1", "--end", "5").map(([, text]) => text),
    ["---", "updated: 2026-10-04", "status: active", "key_fact: Fact here.", "---"]);
});

test("end before the first body line starts at line 1", () => {
  assert.deepEqual(readLines(docker(), "--end", "2"), [[1, "---"], [2, "updated: 2026-10-04"]]);
});

test("end at or after the first body line still skips the frontmatter", () => {
  assert.deepEqual(readLines(docker(), "--end", "8"), [[7, "# Docker"], [8, ""]]);
});

test("start alone reads to the end", () => {
  const numbered = readLines(docker(), "--start", "15");
  assert.equal(numbered[0]![0], 15);
  assert.deepEqual(numbered.at(-1), [17, "Two"]);
});

test("start beyond the file returns no lines", () => {
  const result = docker().run(["read", "notes/docker.md", "--start", "99"]);
  assert.equal(result.code, 0);
  assert.deepEqual(linesOf(result.out), []);
});

for (const args of [["--start", "0"], ["--start", "-3"], ["--start", "5", "--end", "3"], ["--end", "0"]]) {
  test("invalid line range " + args.join(" ") + " exits 2", () => {
    const result = docker().run(["read", "notes/docker.md", ...args]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "Invalid line range.\n");
  });
}

// --- paths and commands --------------------------------------------------------------------------------------------

test("read without a path exits 2 with usage", () => {
  const result = docker().run(["read"]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("usage: dummkopf read"), result.err);
});

test("read accepts only md files inside note folders", () => {
  const target = docker();
  target.write("dummkopf-notes.txt", "x");
  target.write("other/file.md", "# x\n");
  for (const rel of ["dummkopf-notes.txt", "other/file.md", "dummkopf.toml", "notes", "notes/"]) {
    assert.equal(target.run(["read", rel]).code, 2, rel);
  }
});

test("unknown command exits 2", () => {
  assert.equal(docker().run(["bogus"]).code, 2);
});

test("help exits 0 and lists the commands", () => {
  const result = docker().run(["--help"]);
  assert.equal(result.code, 0);
  for (const command of ["context", "find", "read", "ingest", "write", "check", "sync", "init", "install", "hook",
    "meta", "links", "curator"]) {
    assert.ok(result.out.includes(command), command);
  }
});

test("help mentions root and serious", () => {
  const out = docker().run(["--help"]).out;
  assert.ok(out.includes("--root"));
  assert.ok(out.includes("--serious"));
});
