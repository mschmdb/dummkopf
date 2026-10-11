/** `ingest` packets: shapes, replace and append, metadata, all-or-nothing validation and path rules. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { ingest, md, newEntry, packet, rev, Sandbox, topic } from "./harness.ts";
import type { Brain, Entry, Synced } from "./harness.ts";

const SAVED = "Write status: saved; sync: ok\n";
// "Proven content." occurs in the frontmatter too, so the swap names the heading above it.
const FIRST_BODY_SWAP = { old: "# First\n\nProven content.", new: "# First\n\nFixed." };

function repo(): Brain {
  return new Sandbox().synced().brain;
}

function synced(): Synced {
  return new Sandbox().synced();
}

// --- packet shapes --------------------------------------------------------------------------------------------

test("ingest content creates several files in one commit", () => {
  const world = synced();
  const result = ingest(world.brain, [newEntry("notes/one.md"), newEntry("notes/two.md")]);
  assert.equal(result.code, 0);
  assert.equal(result.out, SAVED + "Changed: notes/one.md\nChanged: notes/two.md\n");
  assert.deepEqual(world.remoteLog().slice(0, 2), ["Update notes", "Initial"]);
  assert.ok(world.brain.exists("notes/one.md"));
  assert.ok(world.brain.exists("notes/two.md"));
});

test("ingest reads the package from a file", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.synced().brain;
  const source = path.join(sandbox.tmp, "package.json");
  fs.writeFileSync(source, packet(newEntry("notes/one.md")), "utf-8");
  assert.equal(brain.run(["ingest", "--input", source]).code, 0);
  assert.ok(brain.exists("notes/one.md"));
});

test("ingest json output lists changed and revisions", () => {
  const brain = repo();
  const data = JSON.parse(ingest(brain, [newEntry("notes/one.md")], ["--json"]).out);
  assert.deepEqual(Object.keys(data), ["changed", "unchanged", "revisions", "issues", "saved", "sync"]);
  assert.deepEqual(Object.keys(data.revisions), ["notes/one.md"]);
  assert.equal(data.saved, true);
});

test("ingest replace swaps one exact text", () => {
  const brain = repo();
  const current = rev(brain, "notes/first.md");
  const entry = { path: "notes/first.md", expected: current, replace: [FIRST_BODY_SWAP] };
  const result = ingest(brain, [entry]);
  assert.equal(result.code, 0);
  assert.ok(brain.read("notes/first.md").includes("\nFixed.\n"));
});

test("ingest replace can apply several pairs", () => {
  const brain = repo();
  brain.run(["write", "notes/pairs.md", "--expected", "new"], { stdin: md({ body: "alpha and beta" }) });
  const entry = { path: "notes/pairs.md", expected: rev(brain, "notes/pairs.md"),
    replace: [{ old: "alpha", new: "one" }, { old: "beta", new: "two" }] };
  assert.equal(ingest(brain, [entry]).code, 0);
  assert.ok(brain.read("notes/pairs.md").includes("one and two"));
});

test("ingest replace can delete text with an empty new", () => {
  const brain = repo();
  brain.run(["write", "notes/pairs.md", "--expected", "new"], { stdin: md({ body: "keep drop" }) });
  const entry = { path: "notes/pairs.md", expected: rev(brain, "notes/pairs.md"),
    replace: [{ old: " drop", new: "" }] };
  assert.equal(ingest(brain, [entry]).code, 0);
  assert.ok(brain.read("notes/pairs.md").includes("keep\n"));
});

test("ingest replace repeated with the same revision is unchanged", () => {
  const brain = repo();
  const entry = { path: "notes/first.md", expected: rev(brain, "notes/first.md"), replace: [FIRST_BODY_SWAP] };
  ingest(brain, [entry]);
  const again = ingest(brain, [entry]);
  assert.equal(again.code, 0);
  assert.equal(again.out, SAVED + "Unchanged: notes/first.md\n");
});

for (const old of ["no such text", "e"]) {
  test("ingest replace with a missing or ambiguous old text exits 2: " + JSON.stringify(old), () => {
    const brain = repo();
    const entry = { path: "notes/first.md", expected: rev(brain, "notes/first.md"), replace: [{ old, new: "x" }] };
    const result = ingest(brain, [entry]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "The old text is missing or ambiguous. Read the original passage again.\n");
  });
}

const MALFORMED_PAIRS: unknown[] = [[], "text", [{ old: "", new: "x" }], [{ old: "a" }], [{ old: "a", new: 1 }],
  [{ old: "a", new: "b", extra: "c" }]];
for (const pairs of MALFORMED_PAIRS) {
  test("ingest replace with malformed pairs exits 2: " + JSON.stringify(pairs), () => {
    const brain = repo();
    const entry = { path: "notes/first.md", expected: rev(brain, "notes/first.md"), replace: pairs };
    assert.equal(ingest(brain, [entry]).code, 2);
  });
}

test("ingest replace on a missing file exits 2", () => {
  const brain = repo();
  const entry = { path: "notes/absent.md", expected: "0123456789ab", replace: [{ old: "a", new: "b" }] };
  assert.equal(ingest(brain, [entry]).code, 2);
});

test("ingest append adds text", () => {
  const brain = repo();
  const entry = { path: "notes/first.md", expected: rev(brain, "notes/first.md"), append: "## New\n- Fact" };
  assert.equal(ingest(brain, [entry]).code, 0);
  assert.ok(brain.read("notes/first.md").endsWith("\n\n## New\n- Fact\n"));
});

test("ingest metadata overrides frontmatter fields", () => {
  const brain = repo();
  const entry = newEntry("notes/meta.md", "# M\n\nbody\n", { metadata: { key_fact: "From metadata", aliases: ["a", "b"] } });
  assert.equal(ingest(brain, [entry]).code, 0);
  const text = brain.read("notes/meta.md");
  assert.ok(text.includes("key_fact: From metadata\n"));
  assert.ok(text.includes("aliases: [a, b]\n"));
  assert.ok(text.includes("summary: From metadata\n"));
});

const INVALID_METADATA: Entry[] = [{ key_fact: 5 }, { "bad key": "v" }, { key_fact: "line\nbreak" },
  { aliases: [1] }, { key_fact: null }];
for (const metadata of INVALID_METADATA) {
  test("ingest invalid metadata exits 2: " + JSON.stringify(metadata), () => {
    const brain = repo();
    const result = ingest(brain, [newEntry("notes/meta.md", "# M\n\nbody\n", { metadata })]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "Metadata needs valid keys and string or string-list values.\n");
  });
}

test("ingest dry run validates and saves nothing", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/one.md")], ["--dry-run"]);
  assert.equal(result.out, "Write status: preview; sync: not-run\nChanged: notes/one.md\n");
  assert.ok(!brain.exists("notes/one.md"));
});

test("ingest repeating a new file package is a conflict when content differs", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/one.md")]);
  assert.equal(ingest(brain, [newEntry("notes/one.md", md({ body: "different" }))]).code, 2);
});

test("ingest repeating the identical new file package is unchanged", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/one.md")]);
  const again = ingest(brain, [newEntry("notes/one.md")]);
  assert.equal(again.code, 0);
  assert.equal(again.out, SAVED + "Unchanged: notes/one.md\n");
});

// --- all or nothing -------------------------------------------------------------------------------------------

test("one invalid entry rejects the whole package", () => {
  const world = synced();
  const head = world.brain.git(["rev-parse", "HEAD"]);
  const result = ingest(world.brain, [newEntry("notes/good.md"), newEntry("notes/bad.md", "no heading")]);
  assert.equal(result.code, 2);
  assert.ok(!world.brain.exists("notes/good.md"));
  assert.ok(!world.brain.exists("notes/bad.md"));
  assert.equal(world.brain.git(["rev-parse", "HEAD"]), head);
  assert.deepEqual(world.remoteLog(), ["Initial"]);
});

test("a stale entry rejects the whole package", () => {
  const brain = repo();
  const stale = { path: "notes/first.md", expected: "0123456789ab", append: "x" };
  const result = ingest(brain, [newEntry("notes/good.md"), stale]);
  assert.equal(result.code, 2);
  assert.ok(!brain.exists("notes/good.md"));
});

test("errors name every broken file and the rule codes", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/a.md", "no heading"), newEntry("notes/b.md", "no heading either")]);
  assert.ok(result.err.startsWith("The write package breaks the rules: body, key_fact, summary.\n"));
  for (const name of ["notes/a.md", "notes/b.md"]) {
    assert.ok(result.err.includes("- " + name + ": Content and an H1 heading are missing."));
  }
});

const PACKET_SHAPES: [string, string][] = [
  ["[]", "A write package must contain only `changes`."],
  ['{"changes": [], "extra": 1}', "A write package must contain only `changes`."],
  ['{"other": []}', "A write package must contain only `changes`."],
  ['{"changes": []}', "changes needs 1 to 50 file entries."],
  ['{"changes": "x"}', "changes needs 1 to 50 file entries."],
];
for (const [raw, message] of PACKET_SHAPES) {
  test("packet shape errors: " + raw, () => {
    const brain = repo();
    const result = brain.run(["ingest", "--input", "-"], { stdin: raw });
    assert.equal(result.code, 2);
    assert.equal(result.err, message + "\n");
  });
}

test("more entries than max_changes exits 2", () => {
  const brain = repo();
  brain.configure("[limits]\nmax_changes = 1\n");
  brain.commit("config");
  const result = ingest(brain, [newEntry("notes/one.md"), newEntry("notes/two.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "changes needs 1 to 1 file entries.\n");
});

const ENTRY_ERROR = "Each entry needs path, expected and exactly one of content, replace or append; "
  + "metadata is optional.\n";

const BAD_ENTRIES: unknown[] = [
  { path: "notes/a.md", content: "# T\n" },
  { expected: null, content: "# T\n" },
  { path: "notes/a.md", expected: null },
  { path: "notes/a.md", expected: null, content: "# T\n", append: "x" },
  { path: "notes/a.md", expected: null, content: "# T\n", other: 1 },
  { path: 5, expected: null, content: "# T\n" },
  { path: "notes/a.md", expected: null, content: 5 },
  { path: "notes/a.md", expected: null, content: "# T\n", metadata: [] },
  "notes/a.md",
];
for (const entry of BAD_ENTRIES) {
  test("entry shape errors: " + JSON.stringify(entry), () => {
    const brain = repo();
    // A plain string is not an Entry; the harness serialises whatever it gets.
    const result = ingest(brain, [entry as Entry]);
    assert.equal(result.code, 2);
    assert.equal(result.err, ENTRY_ERROR);
  });
}

test("a path may appear once per package", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/a.md"), newEntry("notes/a.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "A target path may appear only once per package.\n");
});

for (const expected of ["abc", "ZZZZZZZZZZZZ", 12, "0123456789a"]) {
  test("expected must be null or a revision: " + JSON.stringify(expected), () => {
    const brain = repo();
    const entry = { path: "notes/a.md", expected, content: md() };
    const result = ingest(brain, [entry]);
    assert.equal(result.code, 2);
    assert.ok(result.err.startsWith("expected must be null for new files or a revision"));
  });
}

test("broken JSON reports message, line and column", () => {
  const brain = repo();
  const result = brain.run(["ingest", "--input", "-"], { stdin: '{"changes": [\n  {"path": }]}' });
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("The JSON write package is not readable: Expecting value (line 2, column 12). "));
  assert.ok(result.err.includes("quoted heredoc"));
});

test("empty input is broken JSON", () => {
  const brain = repo();
  const result = brain.run(["ingest", "--input", "-"], { stdin: "" });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("(line 1, column 1)"));
});

test("input larger than max_input_chars exits 2", () => {
  const brain = repo();
  brain.configure("[limits]\nmax_input_chars = 50\n");
  brain.commit("config");
  const result = ingest(brain, [newEntry("notes/a.md", md({ body: "x".repeat(200) }))]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "The write package is too large.\n");
});

// --- paths ----------------------------------------------------------------------------------------------------

for (const rel of ["notes/Bad_Name.md", "notes/UPPER.md", "notes/my_note.md", "notes/x.txt",
  "notes/two--dashes.md", "notes/-lead.md", "notes/has space.md"]) {
  test("non kebab-case paths are rejected: " + rel, () => {
    const brain = repo();
    const result = ingest(brain, [newEntry(rel)]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "Target paths need kebab-case names and .md files.\n");
  });
}

for (const rel of ["notes/a.md", "notes/my-note-2.md", "notes/2026-10-05.md", "bookmarks/ai-tools.md"]) {
  test("kebab-case paths are accepted: " + rel, () => {
    const brain = repo();
    assert.equal(ingest(brain, [newEntry(rel)]).code, 0);
  });
}

const DEPTH_RULES: [string, string][] = [
  ["notes/sub/deep.md", "Notes and bookmarks need a flat target path, e.g. notes/<name>.md."],
  ["bookmarks/sub/deep.md", "Notes and bookmarks need a flat target path, e.g. bookmarks/<name>.md."],
  ["topics/solo.md", "Topic files need a topic folder, e.g. topics/<topic>/<file>.md."],
];
for (const [rel, message] of DEPTH_RULES) {
  test("path depth rules: " + rel, () => {
    const brain = repo();
    const result = ingest(brain, [newEntry(rel)]);
    assert.equal(result.code, 2);
    assert.equal(result.err, message + "\n");
  });
}

for (const rel of ["../escape.md", "/tmp/escape.md", "other/x.md", "sources/x.md", "x.md", "notes\\x.md",
  "dummkopf.toml"]) {
  test("paths outside the note folders are denied: " + rel, () => {
    const brain = repo();
    const result = ingest(brain, [newEntry(rel)]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "Path unavailable or access excluded.\n");
  });
}

test("README may use its uppercase name", () => {
  const brain = repo();
  assert.equal(ingest(brain, topic("fresh")).code, 0);
});

test("folder names in topics must be kebab-case too", () => {
  const brain = repo();
  const result = ingest(brain, topic("Bad_Topic"));
  assert.equal(result.code, 2);
  assert.equal(result.err, "Target paths need kebab-case names and .md files.\n");
});

test("originals under a sources folder stay unchanged", () => {
  const brain = repo();
  ingest(brain, [...topic("work"),
    newEntry("topics/work/sources/orig.md", "# Orig\n\nverbatim\n", { metadata: { key_fact: "k" } })]);
  const entry = { path: "topics/work/sources/orig.md", expected: rev(brain, "topics/work/sources/orig.md"),
    append: "edited" };
  const result = ingest(brain, [entry]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Originals under sources/ stay unchanged.\n");
});
