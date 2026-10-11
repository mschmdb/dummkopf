/** Cases where an early port differed from Python; found by a Codex review of the port. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Access } from "../src/access.ts";
import { casefold } from "../src/py.ts";
import { fnmatchRegExp, glob } from "../src/pyos.ts";
import { markerPattern, pathKey } from "../src/sensitive.ts";
import { PyDate } from "../src/pydate.ts";
import { contextPacket } from "../src/search.ts";
import { brain, invoke } from "./helpers.ts";

process.setMaxListeners(0);

test("a marker with a dotted or dotless I hides the note, as Python's IGNORECASE does", () => {
  for (const marker of ["> SENSİTIVE", "> SENSıTIVE", "> ſensitive", "> SENSITİVE"]) {
    const target = brain();
    target.write("notes/secret.md", "# Secret\n" + marker + "\nuniquesecret\n");
    const found = invoke(target, ["find", "uniquesecret", "--json", "--serious"]);
    assert.equal(JSON.parse(found.out).hits.length, 0, marker);
  }
});

test("a marked README with a dotted I protects the notes below it", () => {
  const target = brain();
  target.write("topics/x/README.md", "---\nscope: private\n---\n# X\n> SENSİTIVE\n");
  target.write("topics/x/child.md", "# Child\nuniquesecret\n");
  const found = invoke(target, ["find", "uniquesecret", "--json", "--serious"]);
  assert.equal(JSON.parse(found.out).hits.length, 0);
});

test("the marker pattern still rejects text that only resembles the marker", () => {
  const pattern = markerPattern("> SENSITIVE");
  assert.ok(pattern.test("> sensitive"));
  assert.ok(!pattern.test("> SENSITIVX"));
  assert.ok(!pattern.test("text > SENSITIVE"));
});

test("casefold keeps the dotless i apart from i, like Python", () => {
  assert.equal(casefold("ı"), "ı");
  assert.equal(casefold("İ"), "i̇");
  assert.equal(casefold("Straße"), "strasse");
  assert.equal(casefold("ς"), "σ");
  assert.equal(casefold("ﬁ"), "fi");
  assert.notEqual(pathKey("notes/ı.md"), pathKey("notes/i.md"));
});

test("a listed notes/i.md does not hide a public notes/ı.md", () => {
  const target = brain();
  target.write(".sensitive-paths", "notes/i.md\n");
  target.write("notes/ı.md", "# Public\nopen\n");
  const read = invoke(target, ["read", "notes/ı.md", "--serious"]);
  assert.equal(read.code, 0, read.err);
});

test("a reversed range in a route glob matches nothing instead of crashing", () => {
  assert.ok(!fnmatchRegExp("plan-[z-a]*.md").test("plan-x.md"));
  assert.ok(fnmatchRegExp("plan-[a-c]*.md").test("plan-b1.md"));
  assert.ok(fnmatchRegExp("plan-[!a-c].md").test("plan-z.md"));
  assert.ok(fnmatchRegExp("a[&~|]b").test("a&b"));
  const target = brain();
  target.write("topics/meals/plan-x.md", "# X\n");
  assert.deepEqual(glob(target.root, "topics/meals/plan-[z-a]*.md"), []);
});

test("table rows with Unicode digits count as dated rows, like Python's \\d", () => {
  const target = brain();
  target.write("routes.json", JSON.stringify({
    routes: [{ aliases: ["meal plan"], sources: "topics/meals/plan-*.md", scope: "private", kind: "dated-plan",
      allow_sensitive: true }],
  }));
  target.write("topics/meals/README.md", "---\nscope: private\n---\n# Meals\n> SENSITIVE\n");
  target.write("topics/meals/plan-2026-10-01-to-11.md",
    "# Plan\n\n| Date | Meal |\n|---|---|\n| ١٠-٠٢ | OUTSIDE-WEEK-SECRET |\n| 10-06 | SOUP |\n");
  const packet = contextPacket(new Access(target.config, "private"), "meal plan this week", new PyDate(2026, 10, 6));
  const text = packet.hits.flatMap((hit) => hit.lines.map((line) => line.text)).join("\n");
  assert.ok(text.includes("SOUP"));
  assert.ok(!text.includes("OUTSIDE-WEEK-SECRET"));
});
