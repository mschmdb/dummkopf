/** Port of tests/test_access.py: the read gate. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

import { Access } from "../src/access.ts";
import { AccessDenied } from "../src/errors.ts";
import { splitlines } from "../src/py.ts";
import { find } from "../src/search.ts";
import { brain, german, tempDir } from "./helpers.ts";

process.setMaxListeners(0);

const denied = (body: () => unknown): void => {
  assert.throws(body, AccessDenied);
};

describe("access", () => {
  test("alias match returns original path and physical line", () => {
    const b = brain();
    b.note("notes/deploy.md", { fields: "aliases: [pnpm, build]\n" });
    const hit = find(new Access(b.config), "build").hits[0]!;
    assert.equal(hit.path, "notes/deploy.md");
    assert.equal(hit.updated, "2026-10-04");
    const lines = splitlines(b.read(hit.path));
    for (const line of hit.lines) assert.equal(lines[line.n - 1], line.text);
  });

  test("scope inherits and file can override", () => {
    const b = brain();
    b.note("topics/home/README.md", { fields: "scope: private\n" });
    b.note("topics/home/nested/private.md");
    b.note("topics/home/nested/override.md", { fields: "scope: work\n" });
    b.note("notes/shared.md");
    const paths = find(new Access(b.config, "work"), "pnpm esbuild").hits.map((hit) => hit.path);
    assert.deepEqual(new Set(paths), new Set(["topics/home/nested/override.md", "notes/shared.md"]));
    denied(() => new Access(b.config, "work").read("topics/home/nested/private.md"));
  });

  test("scope defaults to query default", () => {
    const b = brain();
    b.configure("[scopes]\nquery_default = 'work'\n");
    b.note("topics/home/README.md", { fields: "scope: private\n" });
    denied(() => new Access(b.config).read("topics/home/README.md"));
    assert.equal(new Access(b.config, "both").read("topics/home/README.md").scope, "private");
  });

  test("unknown scope is rejected with choices", () => {
    const b = brain();
    assert.throws(() => new Access(b.config, "privat"),
      (error: unknown) => error instanceof AccessDenied && error.message.includes("both, private, work"));
  });

  test("mixed label for unscoped notes", () => {
    const b = brain();
    b.note("notes/a.md");
    assert.equal(new Access(b.config).read("notes/a.md").scope, "mixed");
    const g = german();
    g.write("notes/a.md", "---\nstand: 2026-01-01\n---\n\n# A\n");
    assert.equal(new Access(g.config).read("notes/a.md").scope, "gemischt");
  });

  test("sensitive list, marker and ancestor marker block search and read", () => {
    const b = brain();
    b.write(".sensitive-paths", "notes/listed.md\n");
    b.note("notes/listed.md", { body: "SECRET listed" });
    b.note("notes/marked.md", { body: "> SENSITIVE\nSECRET marked" });
    b.note("topics/locked/README.md", { body: "> SENSITIVE\nSECRET ancestor" });
    b.note("topics/locked/nested/child.md", { body: "SECRET child" });
    const access = new Access(b.config);
    assert.deepEqual(find(access, "SECRET").hits, []);
    for (const rel of ["notes/listed.md", "notes/marked.md", "topics/locked/nested/child.md"]) denied(() => access.read(rel));
  });

  test("allow sensitive is limited to requested path", () => {
    const b = brain();
    b.note("topics/locked/README.md", { body: "> SENSITIVE" });
    b.note("topics/locked/a.md", { body: "SECRET" });
    b.note("topics/other/README.md", { body: "> SENSITIVE" });
    b.note("topics/other/a.md", { body: "SECRET" });
    const access = new Access(b.config, null, null, ["topics/locked/"]);
    assert.equal(find(access, "SECRET").hits[0]!.path, "topics/locked/a.md");
    denied(() => access.read("topics/other/a.md"));
  });

  test("grant needs topic folder or md file", () => {
    const b = brain();
    assert.throws(() => new Access(b.config, null, null, ["notes/some-folder"]),
      (error: unknown) => error instanceof AccessDenied && error.key === "grant_needs_path");
  });

  test("always sensitive topic is blocked without marker", () => {
    const g = german();
    g.write("topics/vertraulich/a.md", "---\nstand: 2026-01-01\n---\n\n# A\n\nSECRET\n");
    assert.deepEqual(find(new Access(g.config), "SECRET").hits, []);
    const granted = new Access(g.config, null, null, ["topics/vertraulich"]);
    assert.ok(granted.read("topics/vertraulich/a.md").sensitive);
  });

  test("missing protection file fails closed", () => {
    const b = brain();
    fs.unlinkSync(path.join(b.root, ".sensitive-paths"));
    assert.throws(() => new Access(b.config),
      (error: unknown) => error instanceof AccessDenied && error.key === "sensitive_list_missing");
  });

  test("symlinked protection file fails closed", () => {
    const b = brain();
    fs.unlinkSync(path.join(b.root, ".sensitive-paths"));
    b.write("elsewhere", "# empty\n");
    fs.symlinkSync(path.join(b.root, "elsewhere"), path.join(b.root, ".sensitive-paths"));
    denied(() => new Access(b.config));
  });

  test("path escape, symlinks and skill directories are blocked", () => {
    const b = brain();
    const target = b.note("notes/a.md");
    fs.symlinkSync(target, path.join(b.root, "notes/link.md"));
    b.write("topics/skills/tool/SKILL.md", "# Tool");
    b.note("topics/skills/tool/data.md");
    b.write("AGENTS.md", "# Agents\n");
    const access = new Access(b.config);
    for (const rel of ["../a.md", target, "notes/link.md", "AGENTS.md", "topics/skills/tool/data.md",
      "topics/skills/tool/SKILL.md", "notes/..\\a.md", "notes", "dummkopf.toml"]) {
      denied(() => access.read(rel));
    }
  });

  test("symlinked folder is blocked", () => {
    const b = brain();
    const outside = path.join(tempDir(), "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "x.md"), "# X\n", "utf-8");
    fs.mkdirSync(path.join(b.root, "topics"));
    fs.symlinkSync(outside, path.join(b.root, "topics", "linked"));
    denied(() => new Access(b.config).read("topics/linked/x.md"));
  });

  test("renamed roots are respected", () => {
    const b = brain();
    const config = b.configure("[layout]\nnotes = 'inbox'\n");
    b.note("inbox/a.md");
    b.note("notes/b.md");
    const access = new Access(config);
    assert.equal(access.read("inbox/a.md").path, "inbox/a.md");
    denied(() => access.read("notes/b.md"));
  });

  test("marker changes are checked on repeated reads", () => {
    const b = brain();
    b.note("topics/build/README.md");
    b.note("topics/build/nested/a.md");
    const access = new Access(b.config);
    access.read("topics/build/nested/a.md");
    b.note("topics/build/README.md", { body: "> SENSITIVE" });
    denied(() => access.read("topics/build/nested/a.md"));
  });

  test("nested scope and invalid scope fail closed", () => {
    const b = brain();
    b.note("topics/home/README.md", { fields: "scope: private\n" });
    b.note("topics/home/nested/README.md", { fields: "scope: work\n" });
    b.note("topics/home/nested/a.md");
    b.note("notes/invalid.md", { fields: "scope: typo\n" });
    assert.equal(new Access(b.config, "work").read("topics/home/nested/a.md").scope, "work");
    denied(() => new Access(b.config).read("notes/invalid.md"));
  });

  test("topic filter limits reads", () => {
    const b = brain();
    b.note("topics/build/a.md");
    b.note("notes/a.md");
    const access = new Access(b.config, null, "build");
    assert.equal(access.read("topics/build/a.md").path, "topics/build/a.md");
    denied(() => access.read("notes/a.md"));
    assert.deepEqual(access.paths(), ["topics/build/a.md"]);
    denied(() => new Access(b.config, null, "../x"));
  });

  test("note fields follow the mapping", () => {
    const g = german();
    g.write("notes/a.md", "---\nstand: 2026-01-01\nstatus: aktiv\nkernfakt: Fakt\naliase: [eins, zwei]\n---\n\n# Titel\n\nText\n");
    const note = new Access(g.config).read("notes/a.md");
    assert.deepEqual([note.title, note.updated, note.status, note.keyFact], ["Titel", "2026-01-01", "aktiv", "Fakt"]);
    assert.deepEqual(note.aliases, ["eins", "zwei"]);
    assert.equal(note.revision.length, 64);
  });
});
