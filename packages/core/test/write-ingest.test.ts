/** Port of tests/test_write.py: write packets, validation and the write commands. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

import { Access } from "../src/access.ts";
import { AccessDenied, DummkopfError } from "../src/errors.ts";
import { PyDate } from "../src/pydate.ts";
import { check, ingest, type WriteResult } from "../src/write.ts";
import { type Brain, brain, documentText as document, german, invoke, revision } from "./helpers.ts";

process.setMaxListeners(0);

type Item = Record<string, unknown>;

function change(rel: string, content: string, expected: string | null = null): Item {
  return { path: rel, content, expected };
}

function packet(...changes: Item[]): Item {
  return { changes };
}

function write(b: Brain, data: unknown, scope: string | null = null, allowSensitive: string[] = []): WriteResult {
  return ingest(new Access(b.config, scope, null, allowSensitive), data, false, false);
}

function rejects(body: () => unknown, key?: string, kind: typeof DummkopfError = DummkopfError): DummkopfError {
  let caught: unknown;
  try {
    body();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof kind, "expected " + kind.name + ", got " + String(caught));
  if (key !== undefined) assert.equal((caught as DummkopfError).key, key);
  return caught as DummkopfError;
}

const today = (): string => PyDate.today().isoformat();

describe("write packets", () => {
  test("create returns version and repeating same packet changes nothing", () => {
    const b = brain();
    const data = packet(change("notes/new.md", document()));
    const result = write(b, data);
    assert.deepEqual(result.changed, ["notes/new.md"]);
    assert.equal(result.revisions["notes/new.md"], revision(b, "notes/new.md"));
    assert.deepEqual(write(b, data).changed, []);
  });

  test("new files are private to the owner", () => {
    const b = brain();
    write(b, packet(change("notes/new.md", document())));
    assert.equal(fs.statSync(path.join(b.root, "notes/new.md")).mode & 0o777, 0o600);
  });

  test("update requires fresh hash and stale write preserves data", () => {
    const b = brain();
    b.write("notes/a.md", document());
    const old = revision(b, "notes/a.md");
    write(b, packet(change("notes/a.md", document({ body: "New facts." }), old)));
    rejects(() => write(b, packet(change("notes/a.md", document({ body: "Stale version." }), old))), "version_conflict");
    assert.ok(b.read("notes/a.md").includes("New facts."));
  });

  test("exact replacement preserves rest and repeating it changes nothing", () => {
    const b = brain();
    b.write("notes/a.md", document({ body: "First fact.\nOther fact." }));
    const data = packet({ path: "notes/a.md", expected: revision(b, "notes/a.md"),
      replace: [{ old: "First fact.", new: "Corrected fact." }], metadata: { key_fact: "Corrected fact." } });
    write(b, data);
    const text = b.read("notes/a.md");
    assert.ok(text.includes("Other fact.") && text.includes("Corrected fact."));
    assert.deepEqual(write(b, data).changed, []);
  });

  for (const old of ["Fact.", "Missing.", ""]) {
    test("replacement requires unique existing text: " + JSON.stringify(old), () => {
      const b = brain();
      b.write("notes/a.md", document({ body: "Fact.\nFact." }));
      rejects(() => write(b, packet({ path: "notes/a.md", expected: revision(b, "notes/a.md"),
        replace: [{ old, new: "Corrected." }] })));
    });
  }

  test("replacement cannot use stale revision or create a file", () => {
    const b = brain();
    b.write("notes/a.md", document({ body: "Fact." }));
    const old = revision(b, "notes/a.md");
    b.write("notes/a.md", document({ body: "Fact.\nForeign change." }));
    for (const [name, expected] of [["notes/a.md", old], ["notes/missing.md", null]] as const) {
      rejects(() => write(b, packet({ path: name, expected, replace: [{ old: "Fact.", new: "Corrected." }] })));
    }
  });

  test("content and replacement cannot be combined", () => {
    const b = brain();
    const item = change("notes/a.md", document());
    item.replace = [{ old: "x", new: "y" }];
    rejects(() => write(b, packet(item)));
  });

  test("complete update packet is idempotent even with old revision", () => {
    const b = brain();
    b.write("notes/a.md", document());
    const data = packet(change("notes/a.md", document({ body: "New facts." }), revision(b, "notes/a.md")));
    write(b, data);
    assert.deepEqual(write(b, data).changed, []);
  });

  test("all changes validate before any write", () => {
    const b = brain();
    rejects(() => write(b, packet(change("notes/good.md", document()), change("notes/bad.md", "# No metadata"))));
    assert.ok(!b.exists("notes/good.md"));
  });

  test("new topic requires scoped readme in same batch", () => {
    const b = brain();
    rejects(() => write(b, packet(change("topics/new/a.md", document()))), "topic_unavailable");
    write(b, packet(change("topics/new/a.md", document()), change("topics/new/README.md", document({ scope: "work" }))),
      "work");
    assert.equal(new Access(b.config, "work").read("topics/new/a.md").scope, "work");
  });

  test("unscoped new topic is rejected", () => {
    const b = brain();
    rejects(() => write(b, packet(change("topics/new/README.md", document()))), "topic_needs_scope");
  });

  test("unscoped new topic allowed when configured", () => {
    const b = brain();
    b.configure("[scopes]\nrequire_on_new_topic = false\n");
    write(b, packet(change("topics/new/README.md", document())));
    assert.ok(b.exists("topics/new/README.md"));
  });

  test("sensitive batch requires explicit grant and remains protected", () => {
    const b = brain();
    const data = packet(change("topics/locked/README.md", document({ body: "> SENSITIVE", scope: "private" })),
      change("topics/locked/a.md", document()));
    rejects(() => write(b, data), undefined, AccessDenied);
    write(b, data, "private", ["topics/locked"]);
    rejects(() => new Access(b.config).read("topics/locked/a.md"), undefined, AccessDenied);
  });

  test("new sensitive note without grant names the flag", () => {
    const b = brain();
    const data = packet(change("notes/new.md", document({ body: "> SENSITIVE\nSecret" })));
    const error = rejects(() => write(b, data, "private"), undefined, AccessDenied);
    assert.ok(error.message.includes("--allow-sensitive notes/new.md"));
    assert.ok(!b.exists("notes/new.md"));
    write(b, data, "private", ["notes/new.md"]);
    assert.ok(b.exists("notes/new.md"));
  });

  test("new file in sensitive topic keeps generic denial", () => {
    const b = brain();
    b.write("topics/locked/README.md", document({ scope: "private", body: "> SENSITIVE" }));
    const error = rejects(() => write(b, packet(change("topics/locked/a.md", document())), "private"), undefined,
      AccessDenied);
    assert.ok(!error.message.includes("--allow-sensitive"));
  });

  test("existing sensitive note keeps generic denial", () => {
    const b = brain();
    b.write("notes/a.md", document({ body: "> SENSITIVE\nSecret" }));
    const data = packet(change("notes/a.md", document({ body: "> SENSITIVE\nNew" }), revision(b, "notes/a.md")));
    const error = rejects(() => write(b, data), undefined, AccessDenied);
    assert.ok(!error.message.includes("--allow-sensitive"));
  });

  test("sensitive marker cannot be removed", () => {
    const b = brain();
    b.write("notes/a.md", document({ body: "> SENSITIVE\nSecret" }));
    rejects(() => write(b, packet(change("notes/a.md", document(), revision(b, "notes/a.md"))), null, ["notes/a.md"]),
      "marker_removal");
  });

  test("always sensitive file automatically carries marker", () => {
    const g = german();
    const doc = (scope: string, body: string): string => "---\nstand: 2026-10-04\nstatus: aktiv\nkernfakt: Fakt.\n"
      + "kurz: Fakt.\naliase: []\nzeitraum: []\nentitaeten: []\n" + scope + "---\n\n# Titel\n\n" + body + "\n";
    g.write("topics/vertraulich/README.md", doc("scope: privat\n", "> SENSIBEL"));
    ingest(new Access(g.config, "privat", null, ["topics/vertraulich/a.md"]),
      packet(change("topics/vertraulich/a.md", doc("", "Text"))), false, false);
    assert.ok(g.read("topics/vertraulich/a.md").includes("> SENSIBEL"));
  });

  test("scope change on existing readme is rejected", () => {
    const b = brain();
    b.write("topics/test/README.md", document({ scope: "private" }));
    rejects(() => write(b, packet(change("topics/test/README.md", document({ scope: "work" }),
      revision(b, "topics/test/README.md")))), "scope_change");
  });

  test("private source cannot be linked from work note", () => {
    const b = brain();
    b.write("topics/private/README.md", document({ scope: "private" }));
    b.write("topics/private/a.md", document());
    rejects(() => write(b, packet(change("notes/work.md",
      document({ scope: "work", body: "[Source](../topics/private/a.md)" })))));
  });

  test("sensitive link cannot escape through public note", () => {
    const b = brain();
    b.write("notes/secret.md", document({ body: "> SENSITIVE" }));
    rejects(() => write(b, packet(change("notes/public.md", document({ body: "[Source](secret.md)" }))), null,
      ["notes/secret.md"]));
  });

  test("links between new files in same batch are valid", () => {
    const b = brain();
    write(b, packet(change("notes/a.md", document({ body: "[Source](b.md#test)" })), change("notes/b.md", document())));
    assert.ok(b.exists("notes/a.md"));
  });

  test("wiki topic reference resolves to readme", () => {
    const b = brain();
    b.write("topics/example/README.md", document({ scope: "work" }));
    write(b, packet(change("notes/a.md", document({ body: "[[example]]" }))));
  });

  test("wiki cannot link a hidden topic from public note", () => {
    const b = brain();
    b.write("topics/locked/README.md", document({ body: "> SENSITIVE", scope: "private" }));
    rejects(() => write(b, packet(change("notes/a.md", document({ body: "[[locked]]" })))));
  });

  test("rejected link names note line and hint but not target", () => {
    const b = brain();
    b.write("topics/locked/README.md", document({ body: "> SENSITIVE", scope: "private" }));
    const message = rejects(() => write(b, packet(change("notes/a.md", document({ body: "Text.\n\n[[locked]]" })))))
      .message;
    assert.ok(message.includes("link-unavailable"));
    assert.ok(message.includes("notes/a.md, line 15:"));
    assert.ok(message.includes("--allow-sensitive"));
    assert.ok(!message.includes("locked"));
  });

  test("new broken link is rejected but legacy link is warning", () => {
    const b = brain();
    rejects(() => write(b, packet(change("notes/a.md", document({ body: "[Source](missing.md)" })))));
    b.write("notes/old.md", document({ body: "[Source](missing.md)" }));
    assert.ok(check(new Access(b.config)).issues.some((problem) => problem.code === "link-unavailable"));
  });

  test("original source cannot be overwritten", () => {
    for (const [target, folder] of [[brain(), "sources"], [german(), "quellen"]] as const) {
      target.write("topics/test/README.md", document({ scope: "work" }));
      const rel = "topics/test/" + folder + "/original.md";
      target.write(rel, document());
      rejects(() => ingest(new Access(target.config), packet(change(rel, document({ body: "Changed" }),
        revision(target, rel))), false, false), "sources_readonly");
    }
  });

  test("paths, symlinks, duplicates and missing expected are rejected", () => {
    const b = brain();
    const target = b.write("notes/real.md", document());
    fs.symlinkSync(target, path.join(b.root, "notes/link.md"));
    const cases: unknown[] = [
      packet(change("../outside.md", document())),
      packet(change("notes/link.md", document())),
      packet(change("notes/nested/a.md", document())),
      packet(change("notes/real.md", document({ body: "changed" }))),
      packet(change("notes/a.md", document()), change("notes/a.md", document())),
      packet(change("notes/Bad_Name.md", document())),
      packet(change("topics/flat.md", document())),
      { changes: [{ path: "notes/a.md", content: document() }] },
      { changes: [] },
      { changes: [], extra: 1 },
      [],
    ];
    for (const data of cases) rejects(() => write(b, data));
  });

  const invalid = [
    document().replace("2026-10-01", "invalid"),
    document().replace("aliases: [test]", "aliases: test"),
    document().replace("key_fact: Proven content.", "key_fact: TODO"),
    document({ scope: "invalid" }),
  ];
  invalid.forEach((content, index) => {
    test("invalid metadata does not write #" + index, () => {
      const b = brain();
      rejects(() => write(b, packet(change("notes/a.md", content))));
      assert.ok(!b.exists("notes/a.md"));
    });
  });

  const injections: Record<string, unknown>[] = [{ key_fact: "x\nscope: private" }, { "bad:key": "value" },
    { aliases: ["x\nstatus: wrong"] }, { key_fact: 3 }];
  injections.forEach((metadata, index) => {
    test("metadata cannot inject frontmatter lines #" + index, () => {
      const b = brain();
      const item = change("notes/a.md", document());
      item.metadata = metadata;
      rejects(() => write(b, packet(item)));
    });
  });

  test("revision matches original crlf bytes", () => {
    const b = brain();
    fs.mkdirSync(path.join(b.root, "notes"));
    fs.writeFileSync(path.join(b.root, "notes/crlf.md"), document().replaceAll("\n", "\r\n"));
    assert.equal(new Access(b.config).read("notes/crlf.md").revision, revision(b, "notes/crlf.md"));
  });

  test("standalone metadata can supply fact without full frontmatter", () => {
    const b = brain();
    const item = change("notes/a.md", "# Test\nProven content.\n");
    item.metadata = { key_fact: "Proven content.", aliases: ["test"] };
    write(b, packet(item));
    const note = new Access(b.config).read("notes/a.md");
    assert.equal(note.keyFact, "Proven content.");
    assert.equal(note.updated, today());
    assert.equal(note.status, "active");
  });

  test("german mapping writes german keys", () => {
    const g = german();
    const item = change("notes/a.md", "# Test\nInhalt.\n");
    item.metadata = { kernfakt: "Belegt.", aliase: ["test"] };
    ingest(new Access(g.config), packet(item), false, false);
    const text = g.read("notes/a.md");
    for (const key of ["stand: ", "status: aktiv", "kernfakt: Belegt.", "kurz: Belegt.", "zeitraum: []", "entitaeten: []"]) {
      assert.ok(text.includes(key), key);
    }
  });

  test("check omits protected paths and does not mutate files", () => {
    const b = brain();
    const secret = b.write("notes/secret.md", document({ body: "> SENSITIVE\nSecret" }));
    b.write("notes/public.md", "# Missing metadata");
    const before = fs.readFileSync(secret);
    const result = check(new Access(b.config));
    assert.equal(result.checked, 1);
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.deepEqual(fs.readFileSync(secret), before);
  });

  test("append adds block at end and updates date", () => {
    const b = brain();
    b.write("bookmarks/tools.md", document({ body: "## Old\n- URL: a" }));
    write(b, packet({ path: "bookmarks/tools.md", expected: revision(b, "bookmarks/tools.md"), append: "## New\n- URL: b\n" }));
    const text = b.read("bookmarks/tools.md");
    assert.ok(text.endsWith("- URL: a\n\n## New\n- URL: b\n"));
    assert.ok(text.includes("updated: " + today()));
  });

  test("append needs existing file and text", () => {
    const b = brain();
    let error = rejects(() => write(b, packet({ path: "bookmarks/none.md", expected: null, append: "x" })));
    assert.match(error.message, /append/);
    b.write("bookmarks/tools.md", document());
    error = rejects(() => write(b, packet({ path: "bookmarks/tools.md", expected: revision(b, "bookmarks/tools.md"),
      append: "  \n" })));
    assert.match(error.message, /append/);
  });

  test("repeated append after success changes nothing", () => {
    const b = brain();
    b.write("bookmarks/tools.md", document());
    const item = { path: "bookmarks/tools.md", expected: revision(b, "bookmarks/tools.md"), append: "## New\n- URL: b" };
    write(b, packet(item));
    assert.deepEqual(write(b, packet(item)).changed, []);
  });

  test("append excludes content", () => {
    const b = brain();
    b.write("bookmarks/tools.md", document());
    rejects(() => write(b, packet({ path: "bookmarks/tools.md", expected: revision(b, "bookmarks/tools.md"),
      append: "x", content: document() })));
  });

  test("short revision prefix is accepted", () => {
    const b = brain();
    b.write("notes/a.md", document());
    write(b, packet({ path: "notes/a.md", expected: revision(b, "notes/a.md").slice(0, 12), append: "More." }));
    assert.ok(b.read("notes/a.md").includes("More."));
  });

  test("too short or wrong prefix is rejected", () => {
    const b = brain();
    b.write("notes/a.md", document());
    assert.match(rejects(() => write(b, packet({ path: "notes/a.md", expected: revision(b, "notes/a.md").slice(0, 8),
      append: "x" }))).message, /expected/);
    assert.ok(rejects(() => write(b, packet({ path: "notes/a.md", expected: "0".repeat(12), append: "x" }))).message
      .includes("rev=" + revision(b, "notes/a.md").slice(0, 12)));
  });
});

describe("write commands", () => {
  test("cli dry run and check input use same validation", () => {
    const b = brain();
    const source = b.write("packet.json", JSON.stringify(packet(change("notes/a.md", document()))));
    for (const args of [["ingest", "--dry-run"], ["check"]]) {
      const done = invoke(b, [...args, "--input", source, "--json"]);
      assert.equal(done.code, 0, done.err);
      assert.ok(!b.exists("notes/a.md"));
      assert.ok(JSON.parse(done.out));
    }
  });

  test("broken json names line and column", () => {
    const b = brain();
    const done = invoke(b, ["ingest", "--input", "-", "--dry-run"], '{"changes":[\n{"path": }]}');
    assert.equal(done.code, 2);
    assert.ok(done.err.includes("line 2") && done.err.includes("column"));
  });

  test("write markdown with frontmatter as dry run", () => {
    const b = brain();
    const done = invoke(b, ["write", "notes/new.md", "--expected", "new", "--dry-run"], document({ title: "New" }));
    assert.deepEqual([done.code, done.err], [0, ""]);
    assert.ok(done.out.includes("Changed: notes/new.md"));
    assert.ok(!b.exists("notes/new.md"));
  });

  test("write append as dry run", () => {
    const b = brain();
    b.write("bookmarks/tools.md", document());
    const done = invoke(b, ["write", "bookmarks/tools.md", "--append", "--dry-run", "--expected",
      revision(b, "bookmarks/tools.md").slice(0, 12)], "## New\n- URL: b\n");
    assert.deepEqual([done.code, done.err], [0, ""]);
    assert.ok(done.out.includes("Changed: bookmarks/tools.md"));
  });

  test("write requires expected", () => {
    assert.equal(invoke(brain(), ["write", "notes/new.md"]).code, 2);
  });

  test("too large input is rejected", () => {
    const b = brain();
    b.configure("[limits]\nmax_input_chars = 10\n");
    const done = invoke(b, ["write", "notes/new.md", "--expected", "new", "--dry-run"], document());
    assert.equal(done.code, 2);
    assert.ok(done.err.includes("too large"));
  });

  function securityRejected(b: Brain, relative: string, message: string, content = "Addition.", append = true,
                            flags: string[] = []): void {
    const before = fs.readFileSync(path.join(b.root, relative));
    const args = ["write", relative, "--expected", revision(b, relative).slice(0, 12), "--dry-run", "--serious", ...flags];
    if (append) args.push("--append");
    const done = invoke(b, args, content);
    assert.equal(done.code, 2);
    assert.equal(done.out, "");
    assert.ok(done.err.includes(message), done.err);
    assert.deepEqual(fs.readFileSync(path.join(b.root, relative)), before);
  }

  test("append denies sensitive note without grant", () => {
    const b = brain();
    b.write("notes/protected.md", document({ body: "> SENSITIVE\n\nEvidence." }));
    securityRejected(b, "notes/protected.md", "access excluded");
  });

  test("append denies private note in work scope", () => {
    const b = brain();
    b.write("notes/private.md", document({ scope: "private" }));
    securityRejected(b, "notes/private.md", "access excluded", "Addition.", true, ["--scope", "work"]);
  });

  test("append denies symlink and preserves target", () => {
    const b = brain();
    const target = b.write("notes/real.md", document());
    const before = fs.readFileSync(target);
    fs.symlinkSync(target, path.join(b.root, "notes/link.md"));
    securityRejected(b, "notes/link.md", "access excluded");
    assert.ok(fs.lstatSync(path.join(b.root, "notes/link.md")).isSymbolicLink());
    assert.deepEqual(fs.readFileSync(target), before);
  });

  test("append preserves original source", () => {
    const b = brain();
    b.write("topics/demo/README.md", document({ scope: "work" }));
    b.write("topics/demo/sources/original.md", document());
    securityRejected(b, "topics/demo/sources/original.md", "Originals under sources/ stay unchanged");
  });

  test("write preserves sensitive marker despite grant", () => {
    const b = brain();
    b.write("notes/protected.md", document({ body: "> SENSITIVE\n\nEvidence." }));
    securityRejected(b, "notes/protected.md", "must not remove a sensitivity marker", document(), false,
      ["--allow-sensitive", "notes/protected.md"]);
  });

  test("write preserves existing scope", () => {
    const b = brain();
    b.write("notes/work.md", document({ scope: "work" }));
    securityRejected(b, "notes/work.md", "Changing a scope", document({ scope: "private" }), false);
  });
});
