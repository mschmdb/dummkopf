/** `check` warns when a visible note names a sensitive path in plain text (#71). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Access } from "../src/access.ts";
import { check } from "../src/write.ts";
import { brain } from "./helpers.ts";

function setup() {
  const target = brain();
  target.configure('[sensitive]\nalways = ["topics/health/"]\n');
  target.write("topics/health/README.md", "---\nscope: private\n---\n\n# Health\n");
  target.note("topics/health/diet.md");
  target.note("notes/secret.md", { body: "> SENSITIVE\n\nHidden." });
  target.write(".sensitive-paths", "topics/health/\nnotes/secret.md\n");
  return target;
}

test("a plain-text path into a sensitive folder or file warns, naming only the visible note and line", () => {
  const target = setup();
  target.note("notes/holiday.md", { body: "Sport stays optional.\nDetails in `topics/health/diet.md`.\nSee notes/secret.md too." });
  const issues = check(new Access(target.config)).issues.filter((issue) => issue.code === "sensitive-path-mention");
  assert.deepEqual(issues.map((issue) => [issue.path, issue.line, issue.severity]),
    [["notes/holiday.md", 9, "warning"], ["notes/holiday.md", 10, "warning"]]);
  for (const issue of issues) assert.ok(!issue.message.includes("health") && !issue.message.includes("secret"));
});

test("ordinary paths and words do not warn", () => {
  const target = setup();
  target.note("notes/plain.md", { body: "Health matters. See notes/plain.md and topics/healthy-food/x.md." });
  assert.deepEqual(check(new Access(target.config)).issues.filter((issue) => issue.code === "sensitive-path-mention"), []);
});
