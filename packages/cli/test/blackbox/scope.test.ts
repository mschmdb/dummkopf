/** Scope: inheritance from the topic README, file override, filtering and the mixed label. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Sandbox, note } from "./harness.ts";
import type { Brain } from "./harness.ts";

const DENIED = "Path unavailable or access excluded.\n";
const CUSTOM_SCOPES = '[scopes]\nvalues = ["home", "office"]\nall = "any"\nquery_default = "any"\nlink_barriers = []\n';

function paths(target: Brain, args: string[] = [], command = "find"): string[] {
  const limit = command === "find" ? ["--limit", "10"] : [];
  const result = target.run([command, "widget", "--json", ...limit, ...args]);
  assert.equal(result.code, 0, result.err);
  return JSON.parse(result.out).hits.map((hit: { path: string }) => hit.path);
}

function scopeOf(target: Brain, rel: string, ...args: string[]): string {
  const header = target.run(["read", rel, ...args]).out.split("\n")[0]!;
  return header.slice(header.lastIndexOf("scope=") + "scope=".length);
}

function scoped(): Brain {
  const target = new Sandbox().brain();
  target.write("topics/job/README.md", "---\nscope: work\n---\n\n# Job\n");
  target.write("topics/job/a.md", note({ title: "Alpha", body: "widget" }));
  target.write("topics/job/b.md", note({ title: "Beta", body: "widget", fields: "scope: private\n" }));
  target.write("topics/home/README.md", "---\nscope: private\n---\n\n# Home\n");
  target.write("topics/home/c.md", note({ title: "Gamma", body: "widget" }));
  target.write("topics/loose/d.md", note({ title: "Delta", body: "widget" }));
  target.write("notes/flat.md", note({ title: "Flat", body: "widget" }));
  return target;
}

test("file inherits the scope of its topic README", () => {
  const target = scoped();
  assert.equal(scopeOf(target, "topics/job/a.md"), "work");
  assert.equal(scopeOf(target, "topics/home/c.md"), "private");
});

test("file scope overrides the topic scope", () => {
  assert.equal(scopeOf(scoped(), "topics/job/b.md"), "private");
});

test("notes without any scope are labelled mixed", () => {
  const target = scoped();
  assert.equal(scopeOf(target, "notes/flat.md"), "mixed");
  assert.equal(scopeOf(target, "topics/loose/d.md"), "mixed");
});

test("mixed label comes from the config", () => {
  const target = scoped();
  target.configure('[scopes]\nmixed_label = "unfiled"\n');
  assert.equal(scopeOf(target, "notes/flat.md"), "unfiled");
  assert.equal(JSON.parse(target.run(["read", "notes/flat.md", "--json"]).out).hits[0].scope, "unfiled");
});

test("README scope applies to nested folders", () => {
  const target = scoped();
  target.write("topics/job/deep/er/e.md", note({ title: "Epsilon", body: "widget" }));
  assert.equal(scopeOf(target, "topics/job/deep/er/e.md"), "work");
});

test("nearest README scope wins over a far one", () => {
  const target = scoped();
  target.write("topics/job/inner/README.md", "---\nscope: private\n---\n\n# Inner\n");
  target.write("topics/job/inner/f.md", note({ title: "Phi", body: "widget" }));
  assert.equal(scopeOf(target, "topics/job/inner/f.md"), "private");
});

test("default scope both shows every scope", () => {
  assert.deepEqual(paths(scoped()), ["notes/flat.md", "topics/home/c.md", "topics/job/a.md", "topics/job/b.md",
    "topics/loose/d.md"]);
});

test("scope work hides private notes and keeps mixed ones", () => {
  assert.deepEqual(paths(scoped(), ["--scope", "work"]), ["notes/flat.md", "topics/job/a.md", "topics/loose/d.md"]);
});

test("scope private hides work notes and keeps mixed ones", () => {
  assert.deepEqual(paths(scoped(), ["--scope", "private"]), ["notes/flat.md", "topics/home/c.md", "topics/job/b.md",
    "topics/loose/d.md"]);
});

test("explicit scope both equals the default", () => {
  const target = scoped();
  assert.deepEqual(paths(target, ["--scope", "both"]), paths(target));
});

test("context filters by scope too", () => {
  const target = scoped();
  assert.ok(!paths(target, ["--scope", "work"], "context").includes("topics/home/c.md"));
  assert.ok(!paths(target, ["--scope", "private"], "context").includes("topics/job/a.md"));
});

test("read outside the scope is denied like a missing file", () => {
  const target = scoped();
  const denied = target.run(["read", "topics/home/c.md", "--scope", "work"]);
  const missing = target.run(["read", "topics/home/absent.md", "--scope", "work"]);
  assert.deepEqual([denied.code, denied.err], [2, DENIED]);
  assert.deepEqual(denied, missing);
});

test("read inside the scope works", () => {
  assert.equal(scoped().run(["read", "topics/job/a.md", "--scope", "work"]).code, 0);
});

test("query_default scope applies when no option is given", () => {
  const target = scoped();
  target.configure('[scopes]\nquery_default = "work"\n');
  assert.deepEqual(paths(target), ["notes/flat.md", "topics/job/a.md", "topics/loose/d.md"]);
});

test("scope option beats the configured default", () => {
  const target = scoped();
  target.configure('[scopes]\nquery_default = "work"\n');
  assert.ok(paths(target, ["--scope", "both"]).includes("topics/home/c.md"));
});

test("invalid scope exits 2 and lists the choices", () => {
  const result = scoped().run(["find", "widget", "--scope", "nowhere"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Invalid scope. Use one of: both, private, work.\n");
});

for (const command of [["read", "notes/flat.md"], ["context", "widget"], ["check"], ["meta", "report"], ["links"],
  ["curator"]]) {
  test("every scoped command rejects an invalid scope: " + command.join(" "), () => {
    const result = scoped().run([...command, "--scope", "nowhere"]);
    assert.equal(result.code, 2);
    assert.ok(result.err.includes("Use one of: both, private, work.") || result.err.toLowerCase().includes("invalid"),
      result.err);
  });
}

test("scope choices follow the configured scopes", () => {
  const target = scoped();
  target.configure(CUSTOM_SCOPES);
  const result = target.run(["find", "widget", "--scope", "both"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Invalid scope. Use one of: any, home, office.\n");
});

test("note with a scope outside the configured values is denied", () => {
  const target = scoped();
  target.write("notes/odd.md", note({ title: "Odd", body: "widget", fields: "scope: weird\n" }));
  assert.equal(target.run(["read", "notes/odd.md"]).err, DENIED);
  assert.ok(!paths(target).includes("notes/odd.md"));
});

test("custom scopes filter like the defaults", () => {
  const target = scoped();
  target.configure(CUSTOM_SCOPES);
  target.write("topics/hq/README.md", "---\nscope: office\n---\n\n# Hq\n");
  target.write("topics/hq/g.md", note({ title: "Gee", body: "widget" }));
  target.write("topics/den/README.md", "---\nscope: home\n---\n\n# Den\n");
  target.write("topics/den/h.md", note({ title: "Aitch", body: "widget" }));
  const found = paths(target, ["--scope", "office"]);
  assert.ok(found.includes("topics/hq/g.md"));
  assert.ok(!found.includes("topics/den/h.md"));
});

test("topic option and scope option combine", () => {
  const target = scoped();
  assert.deepEqual(paths(target, ["--topic", "job", "--scope", "work"]), ["topics/job/a.md"]);
  assert.deepEqual(paths(target, ["--topic", "job", "--scope", "private"]), ["topics/job/b.md"]);
});

test("changing a README scope on disk moves the notes below it", () => {
  const target = scoped();
  target.write("topics/job/README.md", "---\nscope: private\n---\n\n# Job\n");
  assert.equal(scopeOf(target, "topics/job/a.md"), "private");
});
