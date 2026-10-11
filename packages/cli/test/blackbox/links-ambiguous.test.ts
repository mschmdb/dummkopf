/** A wikilink with several readable targets says so; a hidden candidate still stays unnamed. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type Brain, fullNote, ingest, md, newEntry, Sandbox, topic } from "./harness.ts";

const AMBIGUOUS = "notes/linker.md:13: A wikilink matches several notes: bookmarks/agentic.md, "
  + "topics/agentic/README.md. Link one path instead. (warning)";

/** A topic and a bookmark that share the name "agentic". */
function twins(bookmark = md()): Brain {
  const target = new Sandbox().synced().brain;
  assert.equal(ingest(target, topic("agentic", "work")).code, 0);
  target.write("bookmarks/agentic.md", bookmark);
  target.commit("bookmark");
  return target;
}

function brain(bookmark = md()): Brain {
  const target = twins(bookmark);
  target.write("notes/linker.md", fullNote({ body: "See [[agentic]]." }));
  return target;
}

function linkerLines(target: Brain): string[] {
  return target.run(["check"]).out.split("\n").filter((line) => line.startsWith("notes/linker.md"));
}

test("check names both readable candidates of an ambiguous wikilink", () => {
  assert.deepEqual(linkerLines(brain()), [AMBIGUOUS]);
});

test("check JSON lists the candidates", () => {
  const data = JSON.parse(brain().run(["check", "--json"]).out);
  const found = data.issues.find((item: { path: string }) => item.path === "notes/linker.md");
  assert.equal(found.code, "link-ambiguous");
  assert.deepEqual(found.candidates, ["bookmarks/agentic.md", "topics/agentic/README.md"]);
});

test("a hidden candidate is neither named nor counted", () => {
  const target = brain(md({ body: "> SENSITIVE" }));
  assert.deepEqual(linkerLines(target), []);
});

test("a write that adds an ambiguous wikilink is rejected with the candidates", () => {
  const result = ingest(twins(), [newEntry("notes/other.md", md({ body: "See [[agentic]]." }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("link-ambiguous"), result.err);
  assert.ok(result.err.includes("bookmarks/agentic.md, topics/agentic/README.md"), result.err);
});

test("a wikilink with many candidates names three and counts the rest", () => {
  const target = new Sandbox().synced().brain;
  const entries = ["a", "b", "c", "d", "e"].map((name) => newEntry("topics/" + name + "/README.md",
    md({ fields: "scope: work\n", title: name })));
  assert.equal(ingest(target, entries).code, 0);
  target.write("notes/linker.md", fullNote({ body: "See [[README]]." }));
  const line = linkerLines(target)[0] ?? "";
  assert.ok(line.includes("topics/a/README.md, topics/b/README.md, topics/c/README.md and 2 more."), line);
});
