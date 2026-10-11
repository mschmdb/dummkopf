/** The suite stays black-box: it never imports the implementation and each file stays small. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SUITE = path.dirname(fileURLToPath(import.meta.url));
const FILES = fs.readdirSync(SUITE).filter((name) => name.endsWith(".ts")).sort();
const IMPORT = /^\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']|^\s*import\s*\(\s*["']([^"']+)["']/gm;
const MAX_LINES = 500;

test("the suite has test files to scan", () => {
  assert.ok(FILES.filter((name) => name.endsWith(".test.ts")).length > 5);
});

for (const name of FILES) {
  const source = fs.readFileSync(path.join(SUITE, name), "utf-8");

  test(name + " imports only Node built-ins and the harness", () => {
    const targets = [...source.matchAll(IMPORT)].map((match) => match[1] ?? match[2]!);
    const foreign = targets.filter((target) => !target.startsWith("node:") && target !== "./harness.ts");
    assert.deepEqual(foreign, []);
  });

  test(name + " stays under " + MAX_LINES + " lines", () => {
    assert.ok(source.split("\n").length < MAX_LINES);
  });
}
