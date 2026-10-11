/** Write rules: topics and READMEs, scope changes, sensitivity markers, links and `check`. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fullNote, ingest, md, newEntry, packet, rev, Sandbox, topic } from "./harness.ts";
import type { Brain } from "./harness.ts";

const LINK_UNAVAILABLE = "link-unavailable";

function repo(): Brain {
  return new Sandbox().synced().brain;
}

/** Python's str.splitlines() for output that ends in a newline. */
function splitlines(value: string): string[] {
  return value === "" ? [] : value.replace(/\n$/, "").split("\n");
}

// --- topics and READMEs ---------------------------------------------------------------------------------------

test("new topic needs a README in the same package", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("topics/fresh/page.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "This topic is unavailable to this call, or it is new and needs a README.md "
    + "with a scope in the same package.\n");
});

test("new topic with README and scope is saved", () => {
  const brain = repo();
  const result = ingest(brain, [...topic("fresh"), newEntry("topics/fresh/page.md")]);
  assert.equal(result.code, 0);
  assert.deepEqual(splitlines(result.out).slice(1),
    ["Changed: topics/fresh/README.md", "Changed: topics/fresh/page.md"]);
});

test("new topic README without scope exits 2", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("topics/fresh/README.md"), newEntry("topics/fresh/page.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "A new topic needs an explicit scope: private, work.\n");
});

test("new topic README with unknown scope exits 2", () => {
  const brain = repo();
  const result = ingest(brain, topic("fresh", "bogus"));
  assert.equal(result.code, 2);
});

test("scope is optional for new topics when the config says so", () => {
  const brain = repo();
  brain.configure("[scopes]\nrequire_on_new_topic = false\n");
  brain.commit("config");
  assert.equal(ingest(brain, [newEntry("topics/fresh/README.md", md({ title: "Fresh" }))]).code, 0);
});

test("new file in a hidden topic looks like a new file in a missing topic", () => {
  const brain = repo();
  brain.write("topics/med/README.md", "---\nscope: private\n---\n\n# Med\n\n> SENSITIVE\n");
  brain.commit("hidden topic");
  const hidden = ingest(brain, [newEntry("topics/med/new.md")]);
  const missing = ingest(brain, [newEntry("topics/nothing/new.md")]);
  assert.equal(hidden.code, 2);
  assert.equal(missing.code, 2);
  assert.equal(hidden.err, missing.err);
  assert.equal(hidden.out, missing.out);
});

test("new file in an out-of-scope topic is denied like a missing topic", () => {
  const brain = repo();
  ingest(brain, topic("job", "work"));
  const outside = ingest(brain, [newEntry("topics/job/new.md")], ["--scope", "private"]);
  const missing = ingest(brain, [newEntry("topics/nothing/new.md")], ["--scope", "private"]);
  assert.equal(outside.code, 2);
  assert.equal(missing.code, 2);
  assert.equal(outside.err, missing.err);
});

test("new README cannot change the scope of notes below it", () => {
  const brain = repo();
  ingest(brain, [...topic("job", "work"), newEntry("topics/job/sub/note.md")]);
  const result = ingest(brain, [newEntry("topics/job/sub/README.md", md({ fields: "scope: private\n" }))]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Changing a scope needs a separate review.\n");
});

test("changing a scope in frontmatter exits 2", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/scoped.md", md({ fields: "scope: work\n" }))]);
  const entry = { path: "notes/scoped.md", expected: rev(brain, "notes/scoped.md"),
    content: md({ fields: "scope: private\n" }) };
  const result = ingest(brain, [entry]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Changing a scope needs a separate review.\n");
});

test("dropping a scope from frontmatter exits 2", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/scoped.md", md({ fields: "scope: work\n" }))]);
  const body = "---\nkey_fact: A fact.\nscope:\n---\n\n# T\n\nBody\n";
  const entry = { path: "notes/scoped.md", expected: rev(brain, "notes/scoped.md"), content: body };
  assert.equal(ingest(brain, [entry]).code, 2);
});

// --- markers --------------------------------------------------------------------------------------------------

test("new sensitive note needs allow-sensitive for that path", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE" }))]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "New sensitive note. Release it with --allow-sensitive notes/secret.md, "
    + "but only after the user named the topic in the current prompt.\n");
  assert.ok(!brain.exists("notes/secret.md"));
});

test("new sensitive note with the grant is saved and then hidden", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE\n\nsecretword" }))],
    ["--allow-sensitive", "notes/secret.md"]);
  assert.equal(result.code, 0);
  assert.equal(brain.mode("notes/secret.md"), 0o600);
  assert.equal(brain.run(["read", "notes/secret.md"]).err, "Path unavailable or access excluded.\n");
  const hits: { path: string }[] = JSON.parse(brain.run(["find", "secretword", "--json"]).out).hits;
  assert.deepEqual(hits.map((hit) => hit.path), []);
});

test("grant for a different path does not release a new sensitive note", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE" }))],
    ["--allow-sensitive", "notes/other.md"]);
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("New sensitive note."));
});

test("new file under sensitive.always gets the marker automatically", () => {
  const brain = repo();
  brain.configure('[sensitive]\nalways = ["topics/health/"]\n');
  brain.commit("config");
  const result = ingest(brain, [...topic("health", "private"), newEntry("topics/health/visit.md")],
    ["--allow-sensitive", "topics/health"]);
  assert.equal(result.code, 0, result.err);
  assert.ok(brain.read("topics/health/visit.md").includes("> SENSITIVE\n"));
});

test("removing a marker is rejected", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE\n\nbody" }))], ["--allow-sensitive", "notes/secret.md"]);
  const entry = { path: "notes/secret.md",
    expected: rev(brain, "notes/secret.md", "--allow-sensitive", "notes/secret.md"),
    content: md({ body: "no marker now" }) };
  const result = ingest(brain, [entry], ["--allow-sensitive", "notes/secret.md"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "A write package must not remove a sensitivity marker.\n");
  assert.ok(brain.read("notes/secret.md").includes("> SENSITIVE"));
});

test("changing a hidden note without the grant gets the denied message", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE\n\nbody" }))], ["--allow-sensitive", "notes/secret.md"]);
  const hidden = ingest(brain, [{ path: "notes/secret.md", expected: "0123456789ab", append: "x" }]);
  assert.equal(hidden.code, 2);
  assert.equal(hidden.err, "Path unavailable or access excluded.\n");
  assert.ok(brain.read("notes/secret.md").includes("> SENSITIVE"));
});

// Together with the hidden-note test above: a writer can tell an occupied path from a free one.
test("append to a missing note names the missing file rule", () => {
  const brain = repo();
  const missing = ingest(brain, [{ path: "notes/absent.md", expected: "0123456789ab", append: "x" }]);
  assert.equal(missing.err, "append needs an existing file and non-empty text.\n");
});

// README: whoever may create notes learns whether a path is free, because `expected: new` fails.
test("creating over a hidden file is the one documented oracle", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE\n\nbody" }))], ["--allow-sensitive", "notes/secret.md"]);
  const result = ingest(brain, [newEntry("notes/secret.md")]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Path unavailable or access excluded.\n");
});

// --- links ----------------------------------------------------------------------------------------------------

test("dead link is rejected with note and line", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](gone.md)" }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("The write package breaks the rules: link-unavailable.\n"));
  assert.ok(result.err.includes("- notes/linker.md, line 13: A link target is missing or not released."));
  assert.ok(!result.err.includes("gone.md"));
});

test("link to an existing note is accepted", () => {
  const brain = repo();
  assert.equal(ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](first.md)" }))]).code, 0);
});

test("link to a note in the same package is accepted", () => {
  const brain = repo();
  assert.equal(ingest(brain, [newEntry("notes/a.md", md({ body: "[b](b.md)" })), newEntry("notes/b.md")]).code, 0);
});

test("link with an anchor checks the file", () => {
  const brain = repo();
  assert.equal(ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](first.md#section)" }))]).code, 0);
});

test("external and fragment links are not checked", () => {
  const brain = repo();
  const body = "[a](https://example.org) [b](mailto:me@example.org) [c](#top)";
  assert.equal(ingest(brain, [newEntry("notes/linker.md", md({ body }))]).code, 0);
});

test("link to a hidden note looks like a link to a missing note", () => {
  const brain = repo();
  ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE" }))], ["--allow-sensitive", "notes/secret.md"]);
  const hidden = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](secret.md)" }))]);
  const missing = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](nothing.md)" }))]);
  assert.equal(hidden.code, 2);
  assert.equal(missing.code, 2);
  assert.equal(hidden.err, missing.err);
  assert.ok(hidden.err.includes(LINK_UNAVAILABLE));
});

test("a granted sensitive note may link to a granted target", () => {
  const brain = repo();
  const grants = ["--allow-sensitive", "notes/secret.md", "--allow-sensitive", "notes/inner.md"];
  ingest(brain, [newEntry("notes/secret.md", md({ body: "> SENSITIVE" }))], grants);
  const result = ingest(brain, [newEntry("notes/inner.md", md({ body: "> SENSITIVE\n\n[x](secret.md)" }))], grants);
  assert.equal(result.code, 0);
});

test("link scheme other than http and mailto is rejected", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](javascript:alert)" }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("link-invalid"));
  assert.ok(result.err.includes("This link scheme is not allowed."));
});

test("link that leaves the brain is rejected", () => {
  const brain = repo();
  const result = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](../../outside.md)" }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("A local link leaves the brain."));
});

test("work note may not link to a private note", () => {
  const brain = repo();
  ingest(brain, [...topic("job", "work"), ...topic("home", "private"), newEntry("topics/home/diary.md")]);
  const result = ingest(brain, [newEntry("topics/job/page.md", md({ body: "[x](../home/diary.md)" }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("link-scope"));
  assert.ok(result.err.includes("A link crosses a sensitivity or scope boundary."));
});

/** A work page that already links to a private note, written past dummkopf as after a migration. */
function oldBarrierLink(): Brain {
  const brain = repo();
  ingest(brain, [...topic("job", "work"), ...topic("home", "private"), newEntry("topics/home/diary.md"),
    newEntry("topics/job/page.md")]);
  brain.write("topics/job/page.md", md({ body: "Intro.\n\n[x](../home/diary.md)" }));
  brain.commit("migrated");
  return brain;
}

test("an edit beside an old barrier link is saved with a warning", () => {
  const brain = oldBarrierLink();
  const entry = { path: "topics/job/page.md", expected: rev(brain, "topics/job/page.md"),
    content: md({ body: "Intro, edited.\n\n[x](../home/diary.md)" }) };
  const result = ingest(brain, [entry]);
  assert.equal(result.code, 0, result.err);
  assert.ok(brain.read("topics/job/page.md").includes("Intro, edited."));
});

test("a new barrier link next to an old one is still rejected", () => {
  const brain = oldBarrierLink();
  ingest(brain, [newEntry("topics/home/other.md")]);
  const entry = { path: "topics/job/page.md", expected: rev(brain, "topics/job/page.md"),
    content: md({ body: "Intro.\n\n[x](../home/diary.md)\n\n[y](../home/other.md)" }) };
  const result = ingest(brain, [entry]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("link-scope"));
});

test("check still reports an old barrier link as an error", () => {
  const result = oldBarrierLink().run(["check"]);
  assert.equal(result.code, 2);
  assert.ok(result.out.includes("topics/job/page.md:9: A link crosses a sensitivity or scope boundary. (error)"),
    result.out);
});

test("check names the line of every occurrence of a repeated link, sorted", () => {
  const brain = repo();
  brain.write("notes/linker.md", fullNote({
    body: "[[gone-wiki]]\n\n[a](gone.md)\n\n```\n[c](gone.md)\n```\n\nText [b](gone.md)",
  }));
  const lines = splitlines(brain.run(["check"]).out).filter((line) => line.startsWith("notes/linker.md"));
  assert.deepEqual(lines.map((line) => line.split(":").slice(0, 2).join(":")),
    ["notes/linker.md:13", "notes/linker.md:15", "notes/linker.md:21"]);
});

test("private note may link to a work note", () => {
  const brain = repo();
  ingest(brain, [...topic("job", "work"), ...topic("home", "private"), newEntry("topics/job/page.md")]);
  assert.equal(ingest(brain, [newEntry("topics/home/diary.md", md({ body: "[x](../job/page.md)" }))]).code, 0);
});

test("link barriers come from the config", () => {
  const brain = repo();
  brain.configure("[scopes]\nlink_barriers = []\n");
  brain.commit("config");
  ingest(brain, [...topic("job", "work"), ...topic("home", "private"), newEntry("topics/home/diary.md")]);
  assert.equal(ingest(brain, [newEntry("topics/job/page.md", md({ body: "[x](../home/diary.md)" }))]).code, 0);
});

test("link to a folder outside the note folders is unavailable", () => {
  const brain = repo();
  brain.write("archive/old.md", "# Old\n");
  brain.commit("archive");
  const result = ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](../archive/old.md)" }))]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes(LINK_UNAVAILABLE));
});

test("links.allow_outside opens a listed folder for existing files", () => {
  const brain = repo();
  brain.write("archive/old.md", "# Old\n");
  brain.configure('[links]\nallow_outside = ["archive"]\n');
  brain.commit("archive");
  assert.equal(ingest(brain, [newEntry("notes/linker.md", md({ body: "[x](../archive/old.md)" }))]).code, 0);
  const missing = ingest(brain, [newEntry("notes/other.md", md({ body: "[x](../archive/absent.md)" }))]);
  assert.equal(missing.code, 2);
  assert.ok(missing.err.includes(LINK_UNAVAILABLE));
});

test("check reports a dead link in an existing note as a warning", () => {
  const brain = repo();
  brain.write("notes/dead.md", "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\n"
    + "aliases: []\nperiod: []\nentities: []\n---\n\n# Dead\n\n[x](gone.md)\n");
  brain.commit("dead link");
  const result = brain.run(["check", "notes/dead.md", "--json"]);
  assert.equal(result.code, 0);
  const data = JSON.parse(result.out);
  assert.equal(data.ok, true);
  assert.deepEqual(data.issues, [{ path: "notes/dead.md", code: "link-unavailable", severity: "warning",
    message: "A link target is missing or not released.", line: 13 }]);
});

// --- check --input --------------------------------------------------------------------------------------------

test("check input previews a package without saving", () => {
  const brain = repo();
  const result = brain.run(["check", "--input", "-"], { stdin: packet(newEntry("notes/one.md")) });
  assert.equal(result.code, 0);
  assert.equal(result.out, "Write status: preview; sync: not-run\nChanged: notes/one.md\n");
  assert.ok(!brain.exists("notes/one.md"));
});

test("check input json marks the result as not saved", () => {
  const brain = repo();
  const data = JSON.parse(brain.run(["check", "--input", "-", "--json"], { stdin: packet(newEntry("notes/one.md")) }).out);
  assert.deepEqual([data.saved, data.sync], [false, "not-run"]);
});

test("check input rejects a broken package like ingest", () => {
  const brain = repo();
  const result = brain.run(["check", "--input", "-"], { stdin: packet(newEntry("notes/one.md", "no heading")) });
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("The write package breaks the rules:"));
});

test("check input works on a dirty tree", () => {
  const brain = repo();
  brain.write("notes/by-hand.md", md());
  assert.equal(brain.run(["check", "--input", "-"], { stdin: packet(newEntry("notes/one.md")) }).code, 0);
});

test("check takes paths or input, not both", () => {
  const brain = repo();
  const result = brain.run(["check", "notes/first.md", "--input", "-"], { stdin: "{}" });
  assert.equal(result.code, 2);
  assert.equal(result.err, "check takes file paths or --input, not both.\n");
});

test("check without arguments counts the released files", () => {
  const brain = repo();
  const result = brain.run(["check"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "Checked files: 1; status: ok\n");
});

test("check json has checked, issues and ok", () => {
  const brain = repo();
  assert.deepEqual(JSON.parse(brain.run(["check", "--json"]).out), { checked: 1, issues: [], ok: true });
});

test("check exits 2 when a note has errors", () => {
  const brain = repo();
  brain.write("notes/bare.md", "# Bare\n\nno frontmatter\n");
  const result = brain.run(["check"]);
  assert.equal(result.code, 2);
  assert.ok(result.out.startsWith("Checked files: 2; status: error\n"));
  assert.ok(result.out.includes("notes/bare.md: Frontmatter is missing. (error)"));
});

test("check text names the line of an issue, but not the link target", () => {
  const brain = repo();
  brain.write("notes/linker.md", fullNote({ body: "[gone](secret-target.md)" }));
  const result = brain.run(["check"]);
  const issue = splitlines(result.out).find((line) => line.startsWith("notes/linker.md"));
  assert.equal(issue, "notes/linker.md:13: A link target is missing or not released. (warning)");
  assert.ok(!result.out.includes("secret-target"), result.out);
});

test("check json issue keys", () => {
  const brain = repo();
  brain.write("notes/bare.md", "# Bare\n\nno frontmatter\n");
  const data = JSON.parse(brain.run(["check", "--json"]).out);
  assert.equal(data.ok, false);
  const keys = Object.keys(data.issues[0]);
  for (const key of ["path", "code", "severity", "message"]) assert.ok(keys.includes(key), key);
  assert.equal(data.issues[0].severity, "error");
});

test("check of a hidden or missing path exits 2 with the denied message", () => {
  const brain = repo();
  const result = brain.run(["check", "notes/absent.md"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Path unavailable or access excluded.\n");
});
