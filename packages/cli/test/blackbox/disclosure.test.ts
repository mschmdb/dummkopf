/** Disclosure paths: write checks, link checks and hook output answer a hidden path like a missing one. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { type Brain, ingest, md, newEntry, Sandbox } from "./harness.ts";

const DENIED = "Path unavailable or access excluded.\n";
const TOPIC_UNAVAILABLE = "This topic is unavailable to this call, or it is new and needs a README.md "
  + "with a scope in the same package.\n";
const WORK = ["--scope", "work", "--dry-run"];
const FILLER = "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\naliases: []\nperiod: []\n"
  + "entities: []\n---\n";

/** A synced brain with a committed private topic. */
function privateBrain(): Brain {
  const repo = new Sandbox().synced().brain;
  repo.write("topics/private/README.md", "---\nscope: private\n---\n\n# Private\n");
  repo.commit("private topic");
  return repo;
}

// --- a new file over a hidden one: the documented "path is taken" signal ------------------------------------

test("a new file over a hidden note in a hidden topic says the path is taken", () => {
  // README: writers learn whether a path is free. A taken path answers path_denied, a free one in a hidden
  // topic answers like a missing topic. Pinned here so a change to the signal is deliberate.
  const brain = privateBrain();
  const entry = newEntry("topics/private/sub/hidden.md");
  assert.equal(ingest(brain, [entry], WORK).err, TOPIC_UNAVAILABLE);
  brain.write("topics/private/sub/hidden.md", md());
  assert.equal(ingest(brain, [entry], WORK).err, DENIED);
});

// --- a new README above hidden notes ------------------------------------------------------------------------

test("a README in a hidden folder answers like a missing topic, with or without notes below", () => {
  const brain = privateBrain();
  const readme = newEntry("topics/private/sub/README.md", md({ fields: "scope: work\n" }));
  const empty = ingest(brain, [readme], WORK);
  brain.write("topics/private/sub/hidden.md", md());
  const filled = ingest(brain, [readme], WORK);
  assert.deepEqual([empty.code, empty.err], [2, TOPIC_UNAVAILABLE]);
  assert.deepEqual([filled.code, filled.err], [2, TOPIC_UNAVAILABLE]);
});

test("a README in a visible folder still may not shift a scope", () => {
  const brain = privateBrain();
  brain.write("topics/job/README.md", "---\nscope: work\n---\n\n# Job\n");
  brain.write("topics/job/sub/a.md", md());
  const result = ingest(brain, [newEntry("topics/job/sub/README.md", md({ fields: "scope: private\n" }))], ["--dry-run"]);
  assert.equal(result.err, "Changing a scope needs a separate review.\n");
});

test("a new topic README still works", () => {
  const brain = privateBrain();
  const result = ingest(brain, [newEntry("topics/fresh/README.md", md({ fields: "scope: work\n" }))], WORK);
  assert.equal(result.code, 0);
});

// --- links to non-Markdown files ----------------------------------------------------------------------------

function linkError(brain: Brain): string {
  const result = ingest(brain, [newEntry("notes/linker.md", md({ body: "[t](secret.png)" }))], WORK);
  assert.equal(result.code, 2);
  return result.err;
}

test("a link to a listed file answers like a link to a missing file", () => {
  const repo = new Sandbox().synced().brain;
  const missing = linkError(repo);
  repo.write(".sensitive-paths", "# generated\nnotes/secret.png\n");
  fs.writeFileSync(path.join(repo.root, "notes", "secret.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(linkError(repo), missing);
  assert.ok(missing.includes("link-unavailable"));
});

test("a link to a file in a hidden folder answers like a missing file", () => {
  const brain = privateBrain();
  const entry = newEntry("notes/linker.md", md({ body: "[t](../topics/private/secret.png)" }));
  const result = ingest(brain, [entry], WORK);
  brain.write("topics/private/secret.png", "png");
  const hidden = ingest(brain, [entry], WORK);
  assert.deepEqual([hidden.code, hidden.err], [result.code, result.err]);
});

test("a link to a visible non-Markdown file is accepted", () => {
  const repo = new Sandbox().synced().brain;
  fs.writeFileSync(path.join(repo.root, "notes", "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(ingest(repo, [newEntry("notes/linker.md", md({ body: "[t](photo.png)" }))], WORK).code, 0);
});

// --- pre-commit hook output ---------------------------------------------------------------------------------

test("pre-commit does not name a sensitive file with unstaged edits", () => {
  const brain = new Sandbox().brain();
  brain.gitInit();
  brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n");
  brain.write("topics/divorce/README.md", FILLER + "\n# Divorce\n\n> SENSITIVE\n");
  brain.write("topics/job/README.md", FILLER + "\n# Job\n");
  brain.commit("start");
  brain.write("topics/divorce/README.md", FILLER + "\n# Divorce\n\n> SENSITIVE\n\nEdited by hand.\n");
  brain.write("topics/divorce/lawyer.md", FILLER + "\n# Lawyer\n");
  brain.write("topics/job/README.md", FILLER + "\n# Job\n\nEdited by hand.\n");
  brain.write("topics/job/plan.md", FILLER + "\n# Plan\n");
  const result = brain.run(["hook", "pre-commit"]);
  assert.equal(result.code, 0);
  assert.ok(!(result.out + result.err).includes("divorce"));
  assert.ok(result.out.includes("Sensitive files with unstaged edits: 1."));
  assert.ok(result.out.includes("topics/job/README.md has unstaged edits"));
});
