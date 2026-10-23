/** `write`: one file from Markdown on stdin. Revisions, append, dry runs, file mode and input limits. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { md, revOf, Sandbox } from "./harness.ts";
import type { Brain, Result, Synced } from "./harness.ts";

const SAVED = "Write status: saved; sync: ok\n";

function repo(): Brain {
  return new Sandbox().synced().brain;
}

function synced(): Synced {
  return new Sandbox().synced();
}

function currentRev(target: Brain, rel: string, ...args: string[]): string {
  return revOf(target.run(["read", rel, ...args]).out, rel);
}

function writeNew(target: Brain, rel: string, content: string, ...args: string[]): Result {
  return target.run(["write", rel, "--expected", "new", ...args], { stdin: content });
}

test("write creates a new file and reports it", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/fresh.md", md());
  assert.equal(result.code, 0);
  assert.equal(result.out, SAVED + "Changed: notes/fresh.md\n");
  assert.equal(result.err, "");
  assert.ok(brain.exists("notes/fresh.md"));
});

test("write completes missing frontmatter", () => {
  const brain = repo();
  writeNew(brain, "notes/fresh.md", md({ fields: "aliases: [fresh]\n" }));
  const text = brain.read("notes/fresh.md");
  const rest = text.startsWith("---\n") ? text.slice(4) : text;
  const cut = rest.indexOf("\n---\n");
  const frontmatter = cut < 0 ? rest : rest.slice(0, cut);
  const body = cut < 0 ? "" : rest.slice(cut + 5);
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const at = line.indexOf(": ");
    assert.ok(at >= 0, line);
    fields[line.slice(0, at)] = line.slice(at + 2);
  }
  assert.deepEqual(new Set(Object.keys(fields)),
    new Set(["key_fact", "aliases", "updated", "status", "period", "entities", "summary"]));
  assert.match(fields.updated!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fields.status, "active");
  assert.equal(fields.summary, "A fact.");
  assert.equal(fields.key_fact, "A fact.");
  assert.equal(fields.aliases, "[fresh]");
  assert.equal(fields.period, "[]");
  assert.equal(fields.entities, "[]");
  assert.equal(body, "\n# T\n\nBody\n");
});

test("write keeps a given updated date", () => {
  const brain = repo();
  writeNew(brain, "notes/dated.md", md({ fields: "updated: 2025-01-02\n" }));
  assert.ok(brain.read("notes/dated.md").includes("updated: 2025-01-02\n"));
});

test("summary is shortened from a long key fact", () => {
  const brain = repo();
  const longFact = "word ".repeat(80);
  writeNew(brain, "notes/long.md", "---\nkey_fact: " + longFact + "\n---\n\n# T\n\nBody\n");
  const summary = brain.read("notes/long.md").split("\n").find((line) => line.startsWith("summary: "));
  assert.ok(summary !== undefined);
  // Python's len() counts code points.
  assert.ok([...summary].length - "summary: ".length <= 160);
  assert.ok(summary.endsWith("…"));
});

test("new files get mode 0600", () => {
  const brain = repo();
  writeNew(brain, "notes/private-mode.md", md());
  assert.equal(brain.mode("notes/private-mode.md"), 0o600);
});

test("new files in new folders work and get mode 0600", () => {
  const brain = repo();
  const pkg = {
    changes: [
      { path: "topics/fresh/README.md", expected: null, content: md({ fields: "scope: work\n" }) },
      { path: "topics/fresh/page.md", expected: null, content: md() },
    ],
  };
  assert.equal(brain.run(["ingest", "--input", "-"], { stdin: JSON.stringify(pkg) }).code, 0);
  assert.equal(brain.mode("topics/fresh/page.md"), 0o600);
});

test("existing file mode is kept on change", () => {
  const brain = repo();
  fs.chmodSync(path.join(brain.root, "notes/first.md"), 0o640);
  assert.equal(brain.run(["write", "notes/first.md", "--expected", currentRev(brain, "notes/first.md"), "--append"],
    { stdin: "more\n" }).code, 0);
  assert.equal(brain.mode("notes/first.md"), 0o640);
});

test("write commits and pushes to the remote", () => {
  const world = synced();
  writeNew(world.brain, "notes/fresh.md", md());
  assert.equal(world.remoteLog()[0], "Update notes");
  assert.ok(world.remoteFile("notes/fresh.md").includes("# T"));
  assert.equal(world.brain.git(["status", "--porcelain"]), "");
});

test("write uses the configured commit message", () => {
  const world = synced();
  world.brain.repoOption('commit_message = "Remember things"');
  writeNew(world.brain, "notes/fresh.md", md());
  assert.equal(world.brain.git(["log", "-1", "--format=%s"]), "Remember things");
});

test("auto_push false commits locally and leaves the remote alone", () => {
  const world = synced();
  world.brain.repoOption("auto_push = false");
  const result = writeNew(world.brain, "notes/fresh.md", md());
  assert.equal(result.code, 0);
  assert.equal(world.brain.git(["log", "-1", "--format=%s"]), "Update notes");
  assert.deepEqual(world.remoteLog(), ["Initial"]);
});

test("write to an existing file with expected new is a conflict with the current rev", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/first.md", md());
  assert.equal(result.code, 2);
  assert.equal(result.out, "");
  const current = currentRev(brain, "notes/first.md");
  assert.equal(result.err, "A file changed since you read it (current rev=" + current + "). Read it again, then retry.\n");
});

test("stale revision is rejected with the current rev and changes nothing", () => {
  const brain = repo();
  const before = brain.read("notes/first.md");
  const result = brain.run(["write", "notes/first.md", "--expected", "0123456789ab"], { stdin: md() });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("current rev=" + currentRev(brain, "notes/first.md")));
  assert.equal(brain.read("notes/first.md"), before);
});

test("correct revision replaces the file", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  const result = brain.run(["write", "notes/first.md", "--expected", current], { stdin: md({ body: "Replaced body" }) });
  assert.equal(result.code, 0);
  assert.ok(brain.read("notes/first.md").includes("Replaced body"));
});

test("full length revision is accepted", () => {
  const brain = repo();
  const full: string = JSON.parse(brain.run(["read", "notes/first.md", "--json"]).out).hits[0].revision;
  assert.equal(brain.run(["write", "notes/first.md", "--expected", full], { stdin: md({ body: "Full rev" }) }).code, 0);
});

test("rewriting changes the updated date only when content changes", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  brain.run(["write", "notes/first.md", "--expected", current], { stdin: brain.read("notes/first.md") });
  assert.ok(brain.read("notes/first.md").includes("updated: 2026-10-01\n"));
  brain.run(["write", "notes/first.md", "--expected", current], { stdin: md({ body: "Different" }) });
  assert.ok(!brain.read("notes/first.md").includes("updated: 2026-10-01\n"));
});

for (const expected of ["abc", "xyz123456789", "0123456789a", "NEW"]) {
  test("malformed expected value exits 2: " + expected, () => {
    const brain = repo();
    const result = brain.run(["write", "notes/fresh.md", "--expected", expected], { stdin: md() });
    assert.equal(result.code, 2);
    assert.equal(result.err, "expected must be null for new files or a revision (at least 12 hex characters of rev).\n");
    assert.ok(!brain.exists("notes/fresh.md"));
  });
}

test("expected revision for a missing file exits 2", () => {
  const brain = repo();
  const result = brain.run(["write", "notes/absent.md", "--expected", "0123456789ab"], { stdin: md() });
  assert.equal(result.code, 2);
  assert.equal(result.err, "An expected file is missing. Check the current state.\n");
});

test("write requires the expected option", () => {
  const brain = repo();
  const result = brain.run(["write", "notes/fresh.md"], { stdin: md() });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("--expected"));
});

// --- append ---------------------------------------------------------------------------------------------------

test("append adds the text after a blank line", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  const result = brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "## More\n- item\n" });
  assert.equal(result.code, 0);
  assert.ok(brain.read("notes/first.md").endsWith("Proven content.\n\n## More\n- item\n"));
});

test("append refreshes the updated date", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "more\n" });
  assert.ok(!brain.read("notes/first.md").includes("updated: 2026-10-01\n"));
});

test("repeating an append with the same revision changes nothing", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "## More\n- item\n" });
  const afterFirst = brain.read("notes/first.md");
  const result = brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "## More\n- item\n" });
  assert.equal(result.code, 0);
  assert.equal(result.out, SAVED + "Unchanged: notes/first.md\n");
  assert.equal(brain.read("notes/first.md"), afterFirst);
});

test("a different append with a stale revision is rejected", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "one\n" });
  const result = brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "two\n" });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("current rev="));
});

test("append to a missing file exits 2", () => {
  const brain = repo();
  const result = brain.run(["write", "notes/absent.md", "--expected", "new", "--append"], { stdin: "text\n" });
  assert.equal(result.code, 2);
  assert.equal(result.err, "append needs an existing file and non-empty text.\n");
});

test("append of empty text exits 2", () => {
  const brain = repo();
  const current = currentRev(brain, "notes/first.md");
  const result = brain.run(["write", "notes/first.md", "--expected", current, "--append"], { stdin: "  \n" });
  assert.equal(result.code, 2);
  assert.equal(result.err, "append needs an existing file and non-empty text.\n");
});

// --- dry run, json, input -------------------------------------------------------------------------------------

test("dry run writes nothing and commits nothing", () => {
  const world = synced();
  const head = world.brain.git(["rev-parse", "HEAD"]);
  const result = writeNew(world.brain, "notes/fresh.md", md(), "--dry-run");
  assert.equal(result.code, 0);
  assert.equal(result.out, "Write status: preview; sync: not-run\nChanged: notes/fresh.md\n");
  assert.ok(!world.brain.exists("notes/fresh.md"));
  assert.equal(world.brain.git(["rev-parse", "HEAD"]), head);
  assert.deepEqual(world.remoteLog(), ["Initial"]);
});

test("dry run still validates", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/Bad_Name.md", md(), "--dry-run");
  assert.equal(result.code, 2);
  assert.ok(!brain.exists("notes/Bad_Name.md"));
});

test("dry run works on a dirty tree", () => {
  const brain = repo();
  brain.write("notes/uncommitted.md", md());
  assert.equal(writeNew(brain, "notes/fresh.md", md(), "--dry-run").code, 0);
});

test("write json has the result keys", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/fresh.md", md(), "--json");
  assert.equal(result.code, 0);
  const data = JSON.parse(result.out);
  assert.deepEqual(Object.keys(data), ["changed", "unchanged", "revisions", "issues", "saved", "sync"]);
  assert.deepEqual(data.changed, ["notes/fresh.md"]);
  assert.deepEqual(data.unchanged, []);
  assert.deepEqual(data.issues, []);
  assert.equal(data.saved, true);
  assert.equal(data.sync, "ok");
});

test("write json revision matches a later read", () => {
  const brain = repo();
  const data = JSON.parse(writeNew(brain, "notes/fresh.md", md(), "--json").out);
  const read = JSON.parse(brain.run(["read", "notes/fresh.md", "--json"]).out).hits[0].revision;
  assert.deepEqual(data.revisions, { "notes/fresh.md": read });
});

test("dry run json reports preview", () => {
  const brain = repo();
  const data = JSON.parse(writeNew(brain, "notes/fresh.md", md(), "--dry-run", "--json").out);
  assert.deepEqual([data.saved, data.sync], [false, "not-run"]);
});

test("write reads markdown from a file with input", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.synced().brain;
  const source = path.join(sandbox.tmp, "draft.md");
  fs.writeFileSync(source, md({ body: "From a file" }), "utf-8");
  const result = brain.run(["write", "notes/fresh.md", "--expected", "new", "--input", source]);
  assert.equal(result.code, 0);
  assert.ok(brain.read("notes/fresh.md").includes("From a file"));
});

test("unreadable input file exits 2", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.synced().brain;
  const result = brain.run(["write", "notes/fresh.md", "--expected", "new", "--input", path.join(sandbox.tmp, "absent.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "The input is not readable.\n");
});

test("input larger than max_input_chars exits 2 and writes nothing", () => {
  const world = synced();
  world.brain.configure("[limits]\nmax_input_chars = 100\n");
  world.brain.commit("config");
  const result = writeNew(world.brain, "notes/fresh.md", md({ body: "x".repeat(500) }));
  assert.equal(result.code, 2);
  assert.equal(result.err, "The write package is too large.\n");
  assert.ok(!world.brain.exists("notes/fresh.md"));
});

test("input at the limit is accepted", () => {
  const world = synced();
  const content = md({ body: "y" });
  world.brain.configure("[limits]\nmax_input_chars = " + [...content].length + "\n");
  world.brain.commit("config");
  assert.equal(writeNew(world.brain, "notes/fresh.md", content).code, 0);
});

// --- rejected input leaves everything alone -------------------------------------------------------------------

for (const [label, content] of [["no frontmatter", "no heading, no frontmatter\n"],
  ["key fact only", "---\nkey_fact: x\n---\n\nno heading\n"]] as const) {
  test("content without heading or key fact is rejected: " + label, () => {
    const brain = repo();
    const head = brain.git(["rev-parse", "HEAD"]);
    const result = writeNew(brain, "notes/fresh.md", content);
    assert.equal(result.code, 2);
    assert.ok(result.err.startsWith("The write package breaks the rules:"));
    assert.ok(!brain.exists("notes/fresh.md"));
    assert.equal(brain.git(["rev-parse", "HEAD"]), head);
  });
}

test("missing key fact is named in the error", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/fresh.md", "# T\n\nBody\n");
  assert.ok(result.err.split("\n")[0]!.includes("key_fact"));
  assert.ok(result.err.includes("- notes/fresh.md: key_fact is missing or has no valid text."));
});

test("TODO placeholder does not count as a key fact", () => {
  const brain = repo();
  const result = writeNew(brain, "notes/fresh.md", md().replace("A fact.", "TODO"));
  assert.equal(result.code, 2);
});

test("write without git repository exits 2", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.brain();
  const result = sandbox.run(["write", "notes/fresh.md", "--expected", "new", "--serious"], { cwd: brain.root, stdin: md() });
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("Git step failed"));
  assert.ok(!brain.exists("notes/fresh.md"));
});

test("write refuses a dirty tree until sync ran", () => {
  const brain = repo();
  brain.write("notes/by-hand.md", md());
  const result = writeNew(brain, "notes/fresh.md", md());
  assert.equal(result.code, 2);
  assert.equal(result.err, "The brain has uncommitted note changes. Run `rcllr sync` first.\n");
  assert.equal(brain.run(["sync"]).code, 0);
  assert.equal(writeNew(brain, "notes/fresh.md", md()).code, 0);
});
