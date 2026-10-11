/** Sensitivity: markers, lists, grants, oracles, path spelling, symlinks and a missing paths file. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { note, Sandbox } from "./harness.ts";
import type { Brain } from "./harness.ts";

const DENIED = "Path unavailable or access excluded.\n";
const SECRET_BODY = "secretword here";

function foundPaths(brain: Brain, command: string, query: string, ...extra: string[]): string[] {
  const data: { hits: { path: string }[] } = JSON.parse(brain.run([command, query, "--json", ...extra]).out);
  return data.hits.map((hit) => hit.path);
}

/** Assert that read, find, context and check all keep a path out. */
function hiddenEverywhere(brain: Brain, rel: string, word = "secretword"): void {
  assert.equal(brain.run(["read", rel]).err, DENIED);
  for (const command of ["find", "context"]) {
    assert.ok(!foundPaths(brain, command, word).includes(rel), command);
  }
  assert.equal(brain.run(["check", rel]).code, 2);
}

/** A plain brain (no Git) with one visible note, `notes/open.md`. */
function openBrain(): Brain {
  const brain = new Sandbox().brain();
  brain.write("notes/open.md", note({ title: "Open", body: "visible words" }));
  return brain;
}

function at(brain: Brain, rel: string): string {
  return path.join(brain.root, rel);
}

// --- what makes a note sensitive ------------------------------------------------------------------------------

test("marker line in the file hides it", () => {
  const brain = openBrain();
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  hiddenEverywhere(brain, "notes/marked.md");
});

for (const marker of ["    > SENSITIVE", "\t> SENSITIVE", ">SENSITIVE", "> sensitive", ">   SENSITIVE",
  " > SENSITIVE", "> SENSITIVE trailing words"]) {
  test("marker variants hide the file: " + JSON.stringify(marker), () => {
    const brain = openBrain();
    brain.write("notes/variant.md", note({ title: "Variant", body: marker + "\n\n" + SECRET_BODY }));
    hiddenEverywhere(brain, "notes/variant.md");
  });
}

test("marker after a byte order mark hides the file", () => {
  const brain = openBrain();
  brain.write("notes/bom.md", "﻿> SENSITIVE\n" + note({ title: "Bom", body: SECRET_BODY }));
  hiddenEverywhere(brain, "notes/bom.md");
});

test("marker on a CRLF line hides the file", () => {
  const brain = openBrain();
  const text = "---\r\nupdated: 2026-10-04\r\n---\r\n\r\n# Crlf\r\n\r\n> SENSITIVE\r\n" + SECRET_BODY + "\r\n";
  fs.mkdirSync(at(brain, "notes"), { recursive: true });
  fs.writeFileSync(at(brain, "notes/crlf.md"), Buffer.from(text, "utf-8"));
  hiddenEverywhere(brain, "notes/crlf.md");
});

test("marker on a CR-only line hides the file", () => {
  const brain = openBrain();
  fs.writeFileSync(at(brain, "notes/cr.md"), Buffer.from("# Cr\r> SENSITIVE\r" + SECRET_BODY + "\r", "utf-8"));
  hiddenEverywhere(brain, "notes/cr.md");
});

test("marker inside a sentence does not hide the file", () => {
  const brain = openBrain();
  brain.write("notes/prose.md", note({ title: "Prose", body: "The words > SENSITIVE appear mid-line, secretword" }));
  assert.ok(brain.run(["find", "secretword"]).out.includes("notes/prose.md"));
});

test("marker in the topic README hides the whole topic", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
  brain.write("topics/med/deep/more.md", note({ title: "More", body: SECRET_BODY }));
  for (const rel of ["topics/med/README.md", "topics/med/visit.md", "topics/med/deep/more.md"]) {
    hiddenEverywhere(brain, rel);
  }
});

test("marker in an ancestor README two levels up hides the file", () => {
  const brain = openBrain();
  brain.write("topics/a/README.md", "---\nscope: private\n---\n\n# A\n\n> SENSITIVE\n");
  brain.write("topics/a/b/c/deep.md", note({ title: "Deep", body: SECRET_BODY }));
  hiddenEverywhere(brain, "topics/a/b/c/deep.md");
});

test("unmarked sibling topic stays visible", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/open/README.md", "---\nscope: private\n---\n\n# Open\n");
  brain.write("topics/open/x.md", note({ title: "X", body: "visible words" }));
  assert.ok(brain.run(["find", "visible"]).out.includes("topics/open/x.md"));
});

test("path listed in the paths file hides the file", () => {
  const brain = openBrain();
  brain.write("notes/listed.md", note({ title: "Listed", body: SECRET_BODY }));
  brain.write(".sensitive-paths", "# comment\n\nnotes/listed.md\n");
  hiddenEverywhere(brain, "notes/listed.md");
});

test("folder listed in the paths file hides everything below", () => {
  const brain = openBrain();
  brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n");
  brain.write("topics/lst/item.md", note({ title: "Item", body: SECRET_BODY }));
  brain.write(".sensitive-paths", "topics/lst/\n");
  hiddenEverywhere(brain, "topics/lst/item.md");
  hiddenEverywhere(brain, "topics/lst/README.md");
});

test("paths file entries match regardless of case", () => {
  const brain = openBrain();
  brain.write("notes/listed.md", note({ title: "Listed", body: SECRET_BODY }));
  brain.write(".sensitive-paths", "Notes/Listed.md\n");
  hiddenEverywhere(brain, "notes/listed.md");
});

test("sensitive.always prefix hides files without a marker", () => {
  const brain = openBrain();
  brain.configure('[sensitive]\nalways = ["topics/health/"]\n');
  brain.write("topics/health/README.md", "---\nscope: private\n---\n\n# Health\n");
  brain.write("topics/health/x.md", note({ title: "X", body: SECRET_BODY }));
  hiddenEverywhere(brain, "topics/health/x.md");
});

test("sensitive.always accepts a single file", () => {
  const brain = openBrain();
  brain.configure('[sensitive]\nalways = ["notes/always.md"]\n');
  brain.write("notes/always.md", note({ title: "Always", body: SECRET_BODY }));
  hiddenEverywhere(brain, "notes/always.md");
});

test("custom marker replaces the default", () => {
  const brain = openBrain();
  brain.configure('[sensitive]\nmarker = "> HUSH"\n');
  brain.write("notes/hush.md", note({ title: "Hush", body: "> HUSH\n\n" + SECRET_BODY }));
  brain.write("notes/default.md", note({ title: "Default", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  hiddenEverywhere(brain, "notes/hush.md");
  assert.equal(brain.run(["read", "notes/default.md"]).code, 0);
});

test("hidden notes do not change the hits of visible ones", () => {
  const brain = openBrain();
  const before = brain.run(["find", "visible", "--json"]).out;
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\nvisible words too" }));
  assert.equal(brain.run(["find", "visible", "--json"]).out, before);
});

// --- oracles --------------------------------------------------------------------------------------------------

for (const hidden of ["notes/marked.md", "topics/med/visit.md", "topics/lst/item.md"]) {
  test("hidden and missing paths answer byte-identically for read: " + hidden, () => {
    const brain = openBrain();
    brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
    brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
    brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
    brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n");
    brain.write("topics/lst/item.md", note({ title: "Item", body: SECRET_BODY }));
    brain.write(".sensitive-paths", "topics/lst/\n");
    const missing = brain.run(["read", "notes/does-not-exist.md"]);
    const result = brain.run(["read", hidden]);
    assert.deepEqual([result.code, result.out, result.err], [missing.code, missing.out, missing.err]);
    assert.equal(result.code, 2);
  });
}

test("hidden and missing paths answer identically in both tones", () => {
  const brain = openBrain();
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  assert.deepEqual(brain.cheeky(["read", "notes/marked.md"]), brain.cheeky(["read", "notes/absent.md"]));
});

test("hidden and missing paths answer identically for check", () => {
  const brain = openBrain();
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  assert.deepEqual(brain.run(["check", "notes/marked.md"]), brain.run(["check", "notes/absent.md"]));
});

test("hidden file in a missing topic looks like a missing file", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
  assert.deepEqual(brain.run(["read", "topics/med/visit.md"]), brain.run(["read", "topics/none/visit.md"]));
});

// --- grants ---------------------------------------------------------------------------------------------------

test("allow-sensitive releases the named file", () => {
  const brain = openBrain();
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  const result = brain.run(["read", "notes/marked.md", "--allow-sensitive", "notes/marked.md"]);
  assert.equal(result.code, 0);
  assert.ok(result.out.includes(SECRET_BODY));
});

test("allow-sensitive grants only the named path", () => {
  const brain = openBrain();
  brain.write("notes/one.md", note({ title: "One", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  brain.write("notes/two.md", note({ title: "Two", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  const result = brain.run(["read", "notes/two.md", "--allow-sensitive", "notes/one.md"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, DENIED);
});

test("allow-sensitive topic releases the topic and nothing else", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
  brain.write("topics/other/README.md", "---\nscope: private\n---\n\n# Other\n\n> SENSITIVE\n");
  brain.write("topics/other/x.md", note({ title: "X", body: SECRET_BODY }));
  assert.equal(brain.run(["read", "topics/med/visit.md", "--allow-sensitive", "topics/med"]).code, 0);
  assert.equal(brain.run(["read", "topics/other/x.md", "--allow-sensitive", "topics/med"]).code, 2);
});

test("allow-sensitive topic covers a listed folder", () => {
  const brain = openBrain();
  brain.write("topics/lst/README.md", "---\nscope: private\n---\n\n# Lst\n");
  brain.write("topics/lst/item.md", note({ title: "Item", body: SECRET_BODY }));
  brain.write(".sensitive-paths", "topics/lst/\n");
  assert.equal(brain.run(["read", "topics/lst/item.md", "--allow-sensitive", "topics/lst"]).code, 0);
});

test("allow-sensitive topic lets find search the granted topic", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
  assert.ok(!brain.run(["find", "secretword"]).out.includes("topics/med/visit.md"));
  assert.ok(brain.run(["find", "secretword", "--allow-sensitive", "topics/med"]).out.includes("topics/med/visit.md"));
});

test("allow-sensitive can repeat", () => {
  const brain = openBrain();
  brain.write("notes/one.md", note({ title: "One", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  brain.write("notes/two.md", note({ title: "Two", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  const out = brain.run(["find", "secretword", "--allow-sensitive", "notes/one.md",
    "--allow-sensitive", "notes/two.md"]).out;
  assert.ok(out.includes("notes/one.md"));
  assert.ok(out.includes("notes/two.md"));
});

test("allow-sensitive for a different file does not release a variant", () => {
  const brain = openBrain();
  brain.write("notes/indent.md", note({ title: "Indent", body: "    > SENSITIVE\n\n" + SECRET_BODY }));
  assert.equal(brain.run(["read", "notes/indent.md", "--allow-sensitive", "notes/open.md"]).code, 2);
});

test("allow-sensitive marker header still shows the scope", () => {
  const brain = openBrain();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.write("topics/med/visit.md", note({ title: "Visit", body: SECRET_BODY }));
  const out = brain.run(["read", "topics/med/visit.md", "--allow-sensitive", "topics/med"]).out;
  assert.ok(out.split("\n")[0]!.endsWith("scope=private"));
});

test("allow-sensitive needs a topic folder or an md file", () => {
  const brain = openBrain();
  const result = brain.run(["read", "notes/open.md", "--allow-sensitive", "notes/folder"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "--allow-sensitive needs a topic folder or a concrete .md file.\n");
});

for (const grant of ["notes", "topics", "../x.md", "/etc/x.md", "other/x.md"]) {
  test("allow-sensitive rejects paths outside the note folders: " + grant, () => {
    const brain = openBrain();
    const result = brain.run(["read", "notes/open.md", "--allow-sensitive", grant]);
    assert.equal(result.code, 2);
    assert.equal(result.err, DENIED);
  });
}

// --- path spelling and escapes --------------------------------------------------------------------------------

// On a case-insensitive file system (macOS default) these names reach the real file, so the tool must
// refuse them itself; on a case-sensitive one the file is simply absent. Both end in the same denial.
for (const rel of ["Notes/open.md", "notes/Open.md", "NOTES/OPEN.MD"]) {
  test("wrong case spelling is denied: " + rel, () => {
    const brain = openBrain();
    const result = brain.run(["read", rel]);
    assert.equal(result.code, 2);
    assert.equal(result.err, DENIED);
  });
}

test("wrong case spelling of a hidden topic is denied", () => {
  const brain = openBrain();
  brain.write("topics/health/README.md", "---\nscope: private\n---\n\n# Health\n\n> SENSITIVE\n");
  brain.write("topics/health/x.md", note({ title: "X", body: SECRET_BODY }));
  assert.equal(brain.run(["read", "Topics/Health/x.md"]).err, DENIED);
});

for (const rel of ["../open.md", "notes/../notes/open.md", "/etc/passwd", "notes\\open.md", "dummkopf.toml",
  ".sensitive-paths", "notes"]) {
  test("paths outside the note folders are denied: " + rel, () => {
    const brain = openBrain();
    const result = brain.run(["read", rel]);
    assert.equal(result.code, 2);
    assert.equal(result.err, DENIED);
  });
}

test("files in folders with a skill file are denied", () => {
  const brain = openBrain();
  brain.write("topics/skills/SKILL.md", "# Skill\n");
  brain.write("topics/skills/README.md", "---\nscope: private\n---\n\n# Skills\n");
  brain.write("topics/skills/other.md", note({ title: "Other", body: "visible skillword" }));
  assert.equal(brain.run(["read", "topics/skills/other.md"]).err, DENIED);
  assert.deepEqual(foundPaths(brain, "find", "skillword"), []);
});

// --- symlinks -------------------------------------------------------------------------------------------------

test("symlinked note is not readable or listed", () => {
  const brain = openBrain();
  fs.symlinkSync(at(brain, "notes/open.md"), at(brain, "notes/link.md"));
  assert.equal(brain.run(["read", "notes/link.md"]).err, DENIED);
  assert.deepEqual(foundPaths(brain, "find", "visible"), ["notes/open.md"]);
});

test("symlink to a file outside the brain is denied", () => {
  const brain = openBrain();
  const outside = path.join(brain.sandbox.tmp, "outside.md");
  fs.writeFileSync(outside, "# Outside\n\noutsideword\n", "utf-8");
  fs.symlinkSync(outside, at(brain, "notes/escape.md"));
  assert.equal(brain.run(["read", "notes/escape.md"]).err, DENIED);
  assert.deepEqual(foundPaths(brain, "find", "outsideword"), []);
});

test("symlinked folder is not followed", () => {
  const brain = openBrain();
  brain.write("topics/real/README.md", "---\nscope: private\n---\n\n# Real\n");
  brain.write("topics/real/item.md", note({ title: "Item", body: "linkedword" }));
  fs.symlinkSync(at(brain, "topics/real"), at(brain, "topics/alias"));
  assert.equal(brain.run(["read", "topics/alias/item.md"]).err, DENIED);
  assert.deepEqual(foundPaths(brain, "find", "linkedword"), ["topics/real/item.md"]);
});

test("symlinked topic README denies the notes below it", () => {
  const brain = openBrain();
  brain.write("elsewhere/README.md", "---\nscope: private\n---\n\n# Elsewhere\n");
  brain.write("topics/t/item.md", note({ title: "Item", body: "readmeword" }));
  fs.symlinkSync(at(brain, "elsewhere/README.md"), at(brain, "topics/t/README.md"));
  assert.equal(brain.run(["read", "topics/t/item.md"]).err, DENIED);
});

test("symlinked note folder is ignored", () => {
  const brain = openBrain();
  const outside = path.join(brain.sandbox.tmp, "outside-notes");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "x.md"), "# X\n\nfolderword\n", "utf-8");
  fs.renameSync(at(brain, "notes"), at(brain, "notes-real"));
  fs.symlinkSync(outside, at(brain, "notes"));
  assert.equal(brain.run(["read", "notes/x.md"]).err, DENIED);
  assert.deepEqual(foundPaths(brain, "find", "folderword"), []);
});

// --- the paths file -------------------------------------------------------------------------------------------

for (const args of [["read", "notes/open.md"], ["find", "visible"], ["context", "visible words"], ["check"]]) {
  test("missing paths file fails closed: " + args.join(" "), () => {
    const brain = openBrain();
    fs.unlinkSync(at(brain, ".sensitive-paths"));
    const result = brain.run(args);
    assert.equal(result.code, 2);
    assert.equal(result.out, "");
    assert.ok(result.err.includes(".sensitive-paths"));
    assert.ok(result.err.includes("`dummkopf meta index`"));
  });
}

test("symlinked paths file counts as missing", () => {
  const brain = openBrain();
  fs.writeFileSync(at(brain, "real-paths"), "# generated\n", "utf-8");
  fs.unlinkSync(at(brain, ".sensitive-paths"));
  fs.symlinkSync(at(brain, "real-paths"), at(brain, ".sensitive-paths"));
  assert.equal(brain.run(["read", "notes/open.md"]).code, 2);
});

test("renamed paths file is honored", () => {
  const brain = openBrain();
  brain.configure('[sensitive]\npaths_file = ".hidden-list"\n');
  brain.write(".hidden-list", "notes/listed.md\n");
  brain.write("notes/listed.md", note({ title: "Listed", body: SECRET_BODY }));
  fs.unlinkSync(at(brain, ".sensitive-paths"));
  assert.equal(brain.run(["read", "notes/listed.md"]).err, DENIED);
  assert.equal(brain.run(["read", "notes/open.md"]).code, 0);
});

test("meta index restores a missing paths file", () => {
  const brain = openBrain();
  brain.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE\n\n" + SECRET_BODY }));
  fs.unlinkSync(at(brain, ".sensitive-paths"));
  assert.equal(brain.run(["meta", "index"]).code, 0);
  assert.ok(brain.read(".sensitive-paths").split(/\r\n|\r|\n/).includes("notes/marked.md"));
  assert.equal(brain.run(["read", "notes/open.md"]).code, 0);
});
