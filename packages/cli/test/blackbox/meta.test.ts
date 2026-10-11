/** `meta`: generate, index, report, migrate and agents. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Brain, Sandbox } from "./harness.ts";

const INDEX = "# Index\n\nProse stays.\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n";

function fm(title: string, { extra = "", updated = "2026-10-01", keyFact = "K fact." } = {}): string {
  return "---\nupdated: " + updated + "\nstatus: active\nkey_fact: " + keyFact + "\nsummary: " + keyFact + "\n"
    + "aliases: [a1, a2]\nperiod: []\nentities: []\n" + extra + "---\n\n# " + title + "\n\nbody\n";
}

/** Today's local date minus `days`, as YYYY-MM-DD (Python's date.today() - timedelta). */
function isoDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-"
    + String(date.getDate()).padStart(2, "0");
}

function brain(): Brain {
  return new Sandbox().brain();
}

/** A brain with a hand-written INDEX.md. */
function indexed(): Brain {
  const target = brain();
  target.write("INDEX.md", INDEX);
  return target;
}

function tableRows(text: string, heading: string): string[] {
  const start = text.indexOf(heading + "\n");
  assert.ok(start >= 0, "no " + heading + " in:\n" + text);
  const section = text.slice(start + heading.length + 1).split("\n## ")[0]!;
  return section.split("\n").filter((line) => line.startsWith("| `"));
}

/** Python's str.splitlines() for LF text: no empty last line. */
function splitlines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

// --- generate -----------------------------------------------------------------------------------------------

test("generate fills the index tables and keeps the prose", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("notes/n.md", fm("N"));
  b.write("bookmarks/b.md", fm("B"));
  const result = b.run(["meta", "generate"]);
  assert.equal(result.code, 0);
  const text = b.read("INDEX.md");
  assert.ok(text.startsWith("# Index\n\nProse stays.\n\n## Topics\n"));
  assert.deepEqual(tableRows(text, "## Topics"), ["| `topics/job/` | K fact. | a1, a2 |"]);
  assert.deepEqual(tableRows(text, "## Notes (flat)"), ["| `notes/n.md` | K fact. | a1, a2 |"]);
  assert.deepEqual(tableRows(text, "## Bookmarks"), ["| `bookmarks/b.md` | K fact. | a1, a2 |"]);
});

test("generate writes English column headers by default", () => {
  const b = indexed();
  b.run(["meta", "generate"]);
  const text = b.read("INDEX.md");
  assert.ok(text.includes("| Folder | About | Aliases |\n|---|---|---|"));
  assert.equal(count(text, "| File | Key fact | Aliases |\n|---|---|---|"), 2);
});

test("generate prints changed paths on stdout and the count on stderr", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  const result = b.run(["meta", "generate"]);
  assert.equal(result.out, "topics/job/README.md\nINDEX.md\n");
  assert.equal(result.err, "2 file(s) updated.\n");
});

test("generate twice changes nothing the second time", () => {
  const b = indexed();
  b.write("notes/n.md", fm("N"));
  b.run(["meta", "generate"]);
  const again = b.run(["meta", "generate"]);
  assert.deepEqual([again.code, again.out, again.err], [0, "", "0 file(s) updated.\n"]);
});

test("generate --dry-run lists changes and writes nothing", () => {
  const b = indexed();
  b.write("notes/n.md", fm("N"));
  const result = b.run(["meta", "generate", "--dry-run"]);
  assert.equal(result.out, "INDEX.md\n");
  assert.equal(b.read("INDEX.md"), INDEX);
});

test("generate leaves sensitive and archived folders out", () => {
  const b = indexed();
  b.write("notes/open.md", fm("Open"));
  b.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"));
  b.write("topics/med/README.md", fm("Med", { extra: "scope: private\n" }).replace("body", "> SENSITIVE"));
  b.write("archive/old.md", fm("Old"));
  b.run(["meta", "generate"]);
  const text = b.read("INDEX.md");
  assert.deepEqual(tableRows(text, "## Notes (flat)"), ["| `notes/open.md` | K fact. | a1, a2 |"]);
  assert.deepEqual(tableRows(text, "## Topics"), []);
  assert.ok(!text.includes("marked"));
  assert.ok(!text.includes("topics/med"));
  assert.ok(!text.includes("archive"));
});

test("generate leaves listed sensitive paths out", () => {
  const b = indexed();
  b.write("notes/open.md", fm("Open"));
  b.write("notes/listed.md", fm("Listed"));
  b.write(".sensitive-paths", "notes/listed.md\n");
  b.run(["meta", "generate"]);
  assert.ok(!b.read("INDEX.md").includes("listed.md"));
});

test("generate sorts notes by updated date, newest first", () => {
  const b = indexed();
  b.write("notes/a-old.md", fm("Old", { updated: "2020-01-01" }));
  b.write("notes/z-new.md", fm("New", { updated: "2026-10-02" }));
  b.run(["meta", "generate"]);
  const paths = tableRows(b.read("INDEX.md"), "## Notes (flat)").map((row) => row.split("`")[1]);
  assert.deepEqual(paths, ["notes/z-new.md", "notes/a-old.md"]);
});

test("generate adds a file table to each topic README", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("topics/job/a.md", fm("A"));
  b.write("topics/job/deep/b.md", fm("B"));
  b.run(["meta", "generate"]);
  const readme = b.read("topics/job/README.md");
  assert.ok(readme.includes("\n## Files\n\n| File | Key fact | Aliases |\n|---|---|---|\n"));
  assert.deepEqual(tableRows(readme, "## Files"), ["| `topics/job/a.md` | K fact. | a1, a2 |",
    "| `topics/job/deep/b.md` | K fact. | a1, a2 |"]);
});

test("README file table lists only notes of the README scope", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("topics/job/work.md", fm("Work"));
  b.write("topics/job/private.md", fm("Private", { extra: "scope: private\n" }));
  b.run(["meta", "generate"]);
  assert.deepEqual(tableRows(b.read("topics/job/README.md"), "## Files"), [
    "| `topics/job/work.md` | K fact. | a1, a2 |"]);
});

test("README file table leaves sensitive notes out", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("topics/job/open.md", fm("Open"));
  b.write("topics/job/marked.md", fm("Marked").replace("body", "> SENSITIVE"));
  b.run(["meta", "generate"]);
  assert.ok(!b.read("topics/job/README.md").includes("marked"));
});

test("generate keeps the README prose above the table", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }).replace("body", "Hand-written intro."));
  b.write("topics/job/a.md", fm("A"));
  b.run(["meta", "generate"]);
  assert.ok(b.read("topics/job/README.md").includes("# Job\n\nHand-written intro.\n"));
});

test("generate replaces an existing file table in place", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }) + "\n## Files\n\nold intro\n\n"
    + "| File | Key fact | Aliases |\n|---|---|---|\n| `topics/job/gone.md` | stale | |\n");
  b.write("topics/job/a.md", fm("A"));
  b.run(["meta", "generate"]);
  const readme = b.read("topics/job/README.md");
  assert.ok(!readme.includes("gone.md"));
  assert.deepEqual(tableRows(readme, "## Files"), ["| `topics/job/a.md` | K fact. | a1, a2 |"]);
  assert.equal(count(readme, "## Files"), 1);
});

test("German locale writes German table headers and files heading", () => {
  const b = brain();
  b.configure('[ui]\nlocale = "de"\n');
  b.write("INDEX.md", INDEX);
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("topics/job/a.md", fm("A"));
  b.write("notes/n.md", fm("N"));
  b.run(["meta", "generate"]);
  const index = b.read("INDEX.md");
  assert.ok(index.includes("| Ordner | Worum es geht | Aliase |"));
  assert.ok(index.includes("| Datei | Kernfakt | Aliase |"));
  assert.ok(b.read("topics/job/README.md").includes("\n## Dateien\n\n| Datei | Kernfakt | Aliase |\n"));
});

test("English locale does not use German words", () => {
  const b = indexed();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.run(["meta", "generate"]);
  assert.ok(!b.read("topics/job/README.md").includes("Dateien"));
  assert.ok(!b.read("INDEX.md").includes("Ordner"));
});

// --- index -----------------------------------------------------------------------------------------------------

test("index regenerates the paths list and the tables", () => {
  const b = indexed();
  b.write("notes/open.md", fm("Open"));
  b.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"));
  const result = b.run(["meta", "index"]);
  assert.equal(result.code, 0);
  assert.deepEqual(splitlines(result.out), [".sensitive-paths", "INDEX.md"]);
  assert.equal(result.err, "2 file(s) updated.\n");
  assert.deepEqual(splitlines(b.read(".sensitive-paths")).slice(3), ["notes/marked.md"]);
  assert.equal(b.mode(".sensitive-paths"), 0o600);
});

test("index lists folders with a marked README and always paths", () => {
  const b = indexed();
  b.configure('[sensitive]\nalways = ["topics/health/", "notes/vault.md"]\n');
  b.write("topics/med/README.md", fm("Med", { extra: "scope: private\n" }).replace("body", "> SENSITIVE"));
  b.write("topics/med/visit.md", fm("Visit"));
  b.run(["meta", "index"]);
  assert.deepEqual(splitlines(b.read(".sensitive-paths")).slice(3),
    ["notes/vault.md", "topics/health/", "topics/med/"]);
});

test("index --dry-run changes nothing", () => {
  const b = indexed();
  b.write("notes/marked.md", fm("Marked").replace("body", "> SENSITIVE"));
  b.run(["meta", "index", "--dry-run"]);
  assert.equal(b.read(".sensitive-paths"), "# generated\n");
});

test("index twice reports no changes the second time", () => {
  const b = indexed();
  b.run(["meta", "index"]);
  assert.equal(b.run(["meta", "index"]).err, "0 file(s) updated.\n");
});

// --- report ----------------------------------------------------------------------------------------------------

test("report lists missing dates, stale notes and missing key facts", () => {
  const b = brain();
  b.write("notes/bare.md", "# Bare\n\nno frontmatter\n");
  b.write("notes/old.md", fm("Old", { updated: "2020-01-01" }));
  b.write("notes/todo.md", fm("Todo", { keyFact: "TODO" }));
  b.write("notes/fine.md", fm("Fine"));
  const result = b.run(["meta", "report"]);
  assert.equal(result.code, 0);
  assert.equal(result.out,
    "### Missing `updated` (1)\n- `notes/bare.md`\n\n"
    + "### Stale (status active, older than 56 days) (1)\n- `notes/old.md` (updated 2020-01-01)\n\n"
    + "### No key fact (`TODO`) (2)\n- `notes/bare.md`\n- `notes/todo.md`\n\n"
    + "_0 sensitive file(s) skipped._\n");
});

test("report of a clean brain shows empty sections", () => {
  const b = brain();
  b.write("notes/fine.md", fm("Fine", { updated: isoDate() }));
  const out = b.run(["meta", "report"]).out;
  assert.ok(out.includes("### Missing `updated` (0)"));
  assert.ok(out.includes("### Stale (status active, older than 56 days) (0)"));
  assert.ok(out.includes("### No key fact (`TODO`) (0)"));
});

test("report counts skipped sensitive files", () => {
  const b = brain();
  b.write("notes/marked.md", fm("Marked", { keyFact: "TODO" }).replace("body", "> SENSITIVE"));
  const out = b.run(["meta", "report"]).out;
  assert.ok(!out.includes("marked"));
  assert.ok(out.trimEnd().endsWith("_1 sensitive file(s) skipped._"));
});

test("report --max-age changes the stale threshold", () => {
  const b = brain();
  const fortyDaysAgo = isoDate(40);
  b.write("notes/aging.md", fm("Aging", { updated: fortyDaysAgo }));
  assert.ok(!b.run(["meta", "report"]).out.includes("- `notes/aging.md`"));
  const out = b.run(["meta", "report", "--max-age", "30"]).out;
  assert.ok(out.includes("### Stale (status active, older than 30 days) (1)"));
  assert.ok(out.includes("- `notes/aging.md` (updated " + fortyDaysAgo + ")"));
});

test("report ignores archived notes when looking for stale ones", () => {
  const b = brain();
  b.write("notes/shelved.md", fm("Shelved", { updated: "2020-01-01" }).replace("status: active", "status: archived"));
  assert.ok(b.run(["meta", "report"]).out.includes("### Stale (status active, older than 56 days) (0)"));
});

test("report --scope hides notes of other scopes", () => {
  const b = brain();
  b.write("topics/job/README.md", fm("Job", { extra: "scope: work\n" }));
  b.write("topics/job/old.md", fm("Old", { updated: "2020-01-01" }));
  b.write("topics/home/README.md", fm("Home", { extra: "scope: private\n" }));
  b.write("topics/home/old.md", fm("Old", { updated: "2020-01-01" }));
  const out = b.run(["meta", "report", "--scope", "work"]).out;
  assert.ok(out.includes("topics/job/old.md"));
  assert.ok(!out.includes("topics/home/old.md"));
});

test("report rejects an unknown scope", () => {
  const result = brain().run(["meta", "report", "--scope", "nowhere"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "Invalid scope. Use one of: both, private, work.\n");
});

test("report headings stay English in the German locale", () => {
  const b = brain();
  b.configure('[ui]\nlocale = "de"\n');
  b.write("notes/bare.md", "# Bare\n");
  assert.ok(b.run(["meta", "report"]).out.includes("### Missing `updated` (1)"));
});

// --- migrate and agents ----------------------------------------------------------------------------------------

test("migrate adds complete frontmatter to a bare note", () => {
  const b = brain();
  b.write("notes/bare.md", "# Bare\n\nno frontmatter\n");
  const result = b.run(["meta", "migrate"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "notes/bare.md\n");
  assert.equal(result.err, "1 file(s) updated.\n");
  const text = b.read("notes/bare.md");
  assert.match(text, /^---\nupdated: \d{4}-\d{2}-\d{2}\nstatus: active\nkey_fact: TODO\nsummary: TODO\naliases: \[\]\nperiod: \[\]\nentities: \[\]\n---\n/);
  assert.ok(text.endsWith("# Bare\n\nno frontmatter\n"));
});

test("migrate fills only the gaps of a partial note", () => {
  const b = brain();
  b.write("notes/partial.md", "---\nupdated: 2025-05-05\nkey_fact: Mine.\n---\n\n# Partial\n");
  b.run(["meta", "migrate"]);
  const text = b.read("notes/partial.md");
  assert.ok(text.includes("updated: 2025-05-05\n"));
  assert.ok(text.includes("key_fact: Mine.\n"));
  assert.ok(text.includes("status: active\n"));
  assert.ok(text.includes("aliases: []\n"));
});

test("migrate --dry-run lists files and writes nothing", () => {
  const b = brain();
  b.write("notes/bare.md", "# Bare\n");
  const result = b.run(["meta", "migrate", "--dry-run"]);
  assert.equal(result.out, "notes/bare.md\n");
  assert.equal(b.read("notes/bare.md"), "# Bare\n");
});

test("migrate --only limits the paths", () => {
  const b = brain();
  b.write("notes/one.md", "# One\n");
  b.write("notes/two.md", "# Two\n");
  const result = b.run(["meta", "migrate", "--only", "notes/one.md"]);
  assert.equal(result.out, "notes/one.md\n");
  assert.equal(b.read("notes/two.md"), "# Two\n");
});

test("migrate leaves complete notes alone", () => {
  const b = brain();
  b.write("notes/fine.md", fm("Fine"));
  const result = b.run(["meta", "migrate"]);
  assert.deepEqual([result.out, result.err], ["", "0 file(s) updated.\n"]);
});

test("agents prints the rules for this brain", () => {
  const out = brain().run(["meta", "agents"]).out;
  assert.ok(out.startsWith("# Agent rules for this brain\n"));
  assert.ok(out.includes("`> SENSITIVE`"));
  assert.ok(out.includes("`private`, `work`"));
});

test("unknown meta action exits 2", () => {
  const result = brain().run(["meta", "bogus"]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("invalid choice: 'bogus'"));
});
