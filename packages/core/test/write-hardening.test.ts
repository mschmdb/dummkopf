/**
 * Port of tests/test_hardening.py. Threat model for an open-source tool: brains cloned from strangers,
 * with symlinks and odd spellings.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

import { Access } from "../src/access.ts";
import { AccessDenied, ConfigError, RcllrError } from "../src/errors.ts";
import { scan } from "../src/extras/curator.ts";
import { build } from "../src/extras/links.ts";
import { generate } from "../src/meta.ts";
import { find } from "../src/search.ts";
import { syncRepository } from "../src/sync.ts";
import { check, ingest, seams } from "../src/write.ts";
import { type Brain, brain, documentText as document, invoke, revision, synced, tempDir } from "./helpers.ts";

process.setMaxListeners(0);

function caught(body: () => unknown): RcllrError {
  try {
    body();
  } catch (error) {
    assert.ok(error instanceof RcllrError, String(error));
    return error;
  }
  assert.fail("no error");
}

describe("hardening", () => {
  for (const spelling of ["topics/health/bp.md", "topics/Health/bp.md", "topics/HEALTH/BP.md", "topics/health/BP.md"]) {
    test("always sensitive path cannot be read as " + spelling, () => {
      const b = brain();
      b.configure("[sensitive]\nalways = ['topics/health/']\n");
      b.note("topics/health/bp.md", { body: "BLOODPRESSURE" });
      assert.throws(() => new Access(b.config).read(spelling), AccessDenied);
    });
  }

  test("listed path matches case insensitively", () => {
    const b = brain();
    b.configure("[sensitive]\nalways = ['topics/Health/']\n");
    b.note("topics/health/bp.md", { body: "BLOODPRESSURE" });
    assert.deepEqual(find(new Access(b.config), "BLOODPRESSURE").hits, []);
  });

  test("read needs the exact on-disk spelling", () => {
    const b = brain();
    b.note("notes/plain.md");
    const access = new Access(b.config);
    assert.equal(access.read("notes/plain.md").path, "notes/plain.md");
    if (b.exists("notes/Plain.md")) assert.throws(() => access.read("notes/Plain.md"), AccessDenied);
  });

  function outsideLink(): Brain {
    const b = brain();
    const outside = path.join(tempDir(), "outside");
    fs.mkdirSync(path.join(outside, "dir"), { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.md"), "---\nupdated: 2020-01-01\nkey_fact: OUTSIDE-SECRET\n---\n\n"
      + "# S\n\nnot yet OUTSIDE-SECRET\n");
    fs.writeFileSync(path.join(outside, "dir", "inner.md"), "# I\n\nnot yet OUTSIDE-SECRET\n");
    b.write("INDEX.md", "# I\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n");
    fs.mkdirSync(path.join(b.root, "notes"));
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(b.root, "notes", "link.md"));
    fs.mkdirSync(path.join(b.root, "topics"));
    fs.symlinkSync(path.join(outside, "dir"), path.join(b.root, "topics", "linked"));
    fs.symlinkSync(outside, path.join(b.root, "bookmarks"));
    b.gitInit();
    b.commit();
    return b;
  }

  test("symlinks never reach curator, index or links", () => {
    const b = outsideLink();
    const config = b.config;
    assert.ok(!JSON.stringify(scan(config, 1)).includes("OUTSIDE-SECRET"));
    generate(config);
    assert.ok(!b.read("INDEX.md").includes("OUTSIDE-SECRET"));
    assert.ok(!JSON.stringify(build(config, 1)).includes("link.md"));
    assert.ok(!JSON.stringify(build(config, 1)).includes("OUTSIDE-SECRET"));
  });

  test("links output never lands in note folders", () => {
    const b = brain();
    b.gitInit();
    b.note("topics/job/README.md", { fields: "scope: work\n", body: "August 2026" });
    b.commit();
    for (const out of ["notes/links.md", "topics/job/links.md", "bookmarks/links.md"]) {
      const done = invoke(b, ["links", "--out", out, "--serious"]);
      assert.equal(done.code, 2, out);
      assert.ok(done.err.includes("outside the note folders"));
    }
    assert.ok(!b.exists("notes/links.md"));
  });

  test("links output into missing folder is a clean rejection", () => {
    const b = brain();
    b.gitInit();
    b.note("topics/a/README.md");
    b.commit();
    const done = invoke(b, ["links", "--out", "reports/links.md", "--serious"]);
    assert.equal(done.code, 2);
    assert.ok(!(done.out + done.err).includes("Traceback"));
    assert.ok(done.err.includes("folder"));
  });

  test("config rejects links output inside note folders", () => {
    const b = brain();
    assert.throws(() => b.configure("[links]\noutput = 'notes/links.md'\n"),
      (error: unknown) => error instanceof ConfigError && /links\.output/.test(error.message));
  });

  function linkIssue(b: Brain, target: string): string {
    const data = { changes: [{ path: "notes/x.md", expected: null, content: document({ body: "[a](" + target + ")" }) }] };
    return caught(() => ingest(new Access(b.config), data, true, false)).message;
  }

  test("hidden and missing link targets look identical", () => {
    const b = brain();
    b.write("notes/hidden.md", document({ body: "> SENSITIVE" }));
    const hidden = linkIssue(b, "hidden.md");
    assert.equal(hidden, linkIssue(b, "absent.md"));
    assert.ok(hidden.includes("link-unavailable"));
  });

  test("hidden and missing wiki targets look identical", () => {
    const b = brain();
    b.write("topics/locked/README.md", document({ body: "> SENSITIVE", scope: "private" }));
    const messages = ["locked", "absent"].map((name) => caught(() => ingest(new Access(b.config), { changes: [
      { path: "notes/x.md", expected: null, content: document({ body: "[[" + name + "]]" }) }] }, true, false)).message);
    assert.equal(messages[0], messages[1]);
  });

  test("check reports hidden and missing legacy links alike", () => {
    const b = brain();
    b.write("notes/hidden.md", document({ body: "> SENSITIVE" }));
    b.write("notes/a.md", document({ body: "[a](hidden.md)" }));
    b.write("notes/b.md", document({ body: "[a](absent.md)" }));
    const issues = new Map(check(new Access(b.config)).issues
      .map((problem) => [problem.path, [problem.code, problem.message, problem.severity]]));
    assert.deepEqual(issues.get("notes/a.md"), issues.get("notes/b.md"));
  });

  test("saved and pushed write never exits 2 when remote hides the note", () => {
    const b = brain();
    b.write("notes/a.md", document());
    const original = { ...seams };
    seams.prepareRepository = () => {};
    seams.syncLocked = () => {
      b.write("notes/a.md", b.read("notes/a.md") + "\n> SENSITIVE\n");
    };
    try {
      const result = ingest(new Access(b.config), { changes: [
        { path: "notes/a.md", expected: revision(b, "notes/a.md"), append: "More." }] });
      assert.ok(result.saved && result.sync === "ok");
      assert.ok(!("notes/a.md" in result.revisions));
    } finally {
      Object.assign(seams, original);
    }
  });

  test("sync commits only note paths even if excluded files are staged", () => {
    const s = synced();
    s.brain.toml = s.brain.toml.replace("[repo]\n", "[repo]\nsync_exclude = ['rcllr.toml']\n");
    s.brain.configure("");
    s.brain.commit("Configure");
    s.git(["push", "-q"]);
    s.brain.write("rcllr.toml", s.brain.toml + "# half edited\n");
    s.git(["add", "rcllr.toml"]);
    s.brain.write("notes/first.md", "updated\n");
    syncRepository(s.brain.config);
    assert.equal(s.git(["show", "--name-only", "--format=", "HEAD"]), "notes/first.md");
    assert.equal(s.git(["diff", "--cached", "--name-only"]), "rcllr.toml");
  });
});
