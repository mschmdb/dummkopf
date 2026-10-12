/** Port of tests/extras/test_curator.py. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type CuratorScan, prompt, renderMarkdown, scan } from "../src/extras/curator.ts";
import { len } from "../src/py.ts";
import { PyDate } from "../src/pydate.ts";
import { type Brain, brain, german, invoke } from "./helpers.ts";

const ago = (days: number): string => PyDate.today().addDays(-days).isoformat();

function repo(): Brain {
  const target = brain();
  target.gitInit();
  return target;
}

function hub(): Brain {
  const target = german();
  target.gitInit();
  return target;
}

function run(target: Brain, daysAgo = 0, openDays: number | null = null, staleDays: number | null = null): CuratorScan {
  target.commit("init", ago(daysAgo) + "T12:00:00");
  return scan(target.config, openDays, staleDays);
}

type ListKey = "open_loops" | "stale_topics" | "conflicting_dates" | "stale_active";
const paths = (data: CuratorScan, key: ListKey): string[] => data[key].map((entry) => entry.path);

test("open loop flagged only when old", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "This question is not yet answered.\n");
  assert.ok(paths(run(target, 40, 28), "open_loops").includes("topics/foo/bar.md"));
});

test("open loop not flagged when recent", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "This question is not yet answered.\n");
  assert.ok(!paths(run(target, 5, 28), "open_loops").includes("topics/foo/bar.md"));
});

test("German open words and word boundary", () => {
  const target = hub();
  target.write("topics/foo/offen.md", "Diese Frage ist noch offen.\n");
  target.write("topics/foo/bar.md", "Das war eine Zeit der Offenheit. Hoffentlich bleibt das so.\n");
  const found = paths(run(target, 40, 28), "open_loops");
  assert.ok(found.includes("topics/foo/offen.md"));
  assert.ok(!found.includes("topics/foo/bar.md"));
});

test("open loop shows up to three short lines", () => {
  const target = hub();
  const long = "x".repeat(200);
  target.write("topics/foo/bar.md", "Zeile1 offen " + long + "\nZeile2 prüfen\nZeile3 TODO\nZeile4 noch nicht fertig\n");
  const entry = run(target, 40, 28).open_loops.find((item) => item.path === "topics/foo/bar.md")!;
  assert.ok(entry.lines.length <= 3);
  assert.ok(entry.lines.every((line) => len(line) <= 120));
});

test("stale topic", () => {
  const target = repo();
  target.write("topics/bar/README.md", "# Bar\n");
  assert.ok(paths(run(target, 70, null, 56), "stale_topics").includes("topics/bar/"));
});

test("a recent topic is not stale", () => {
  const target = repo();
  target.write("topics/bar/README.md", "# Bar\n");
  assert.ok(!paths(run(target, 5, null, 56), "stale_topics").includes("topics/bar/"));
});

test("the frontmatter date beats a recent commit", () => {
  const target = repo();
  const old = ago(90);
  target.write("topics/foo/bar.md", "---\nupdated: " + old + "\n---\n\nStill TBD.\n");
  const entry = run(target, 0, 28).open_loops.find((item) => item.path === "topics/foo/bar.md")!;
  assert.equal(entry.updated, old);
});

test("a recent frontmatter date beats an old commit", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "---\nupdated: " + ago(0) + "\n---\n\nStill TBD.\n");
  assert.ok(!paths(run(target, 90, 28), "open_loops").includes("topics/foo/bar.md"));
});

test("Git date fallback without frontmatter", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "No frontmatter, still TBD.\n");
  const entry = run(target, 40, 28).open_loops.find((item) => item.path === "topics/foo/bar.md")!;
  assert.equal(entry.updated.length, 10);
});

test("stale topic uses frontmatter and any recent file", () => {
  const target = repo();
  target.write("topics/bar/README.md", "---\nupdated: " + ago(90) + "\n---\n\n# Bar\n");
  assert.ok(paths(run(target, 0, null, 56), "stale_topics").includes("topics/bar/"));
  target.write("topics/bar/new.md", "---\nupdated: " + ago(0) + "\n---\n\nNew.\n");
  assert.ok(!paths(run(target, 0, null, 56), "stale_topics").includes("topics/bar/"));
});

// A conflict is text that claims a newer state than the note's own date: the metadata lags behind.
test("conflicting dates: the text names a newer as-of date than the frontmatter", () => {
  const de = hub();
  de.write("topics/foo/bar.md", "---\nstand: 2026-08-06\n---\n\nStand: 06.08.2026\n\nSpäter: Stand 2026-09-25\n");
  de.write("topics/foo/one.md", "---\nstand: 2026-08-06\n---\n\nStand: 06.08.2026\n");
  const data = run(de);
  const entry = data.conflicting_dates.find((item) => item.path === "topics/foo/bar.md")!;
  assert.deepEqual(entry, { path: "topics/foo/bar.md", updated: "2026-08-06", dates: ["06.08.2026", "2026-09-25"] });
  assert.ok(!paths(data, "conflicting_dates").includes("topics/foo/one.md"));
  const en = repo();
  en.write("topics/foo/bar.md", "---\nupdated: 2026-08-06\n---\n\nAs of 2026-08-06.\n\nUpdated: 2026-09-25\n");
  assert.ok(paths(run(en), "conflicting_dates").includes("topics/foo/bar.md"));
});

test("the same day in two spellings is one date", () => {
  const de = hub();
  de.write("topics/foo/bar.md", "---\nstand: 2026-07-01\n---\n\nStand 2026-07-15\n\nStand: 15.07.2026\n");
  const entry = run(de).conflicting_dates.find((item) => item.path === "topics/foo/bar.md")!;
  assert.deepEqual(entry.dates, ["2026-07-15"]);
});

test("a documented history up to the note's date is no conflict", () => {
  const de = hub();
  de.write("topics/foo/bar.md", "---\nstand: 2026-09-25\n---\n\nStand: 06.08.2026\n\nSpäter: Stand 25.09.2026\n");
  de.write("topics/foo/newer.md", "---\nstand: 2026-10-10\n---\n\nStand: 06.08.2026\n\nStand: 25.09.2026\n");
  const data = run(de);
  assert.deepEqual(paths(data, "conflicting_dates"), []);
});

test("without a frontmatter date the Git date is the note's date", () => {
  const de = hub();
  de.write("topics/foo/old.md", "Stand: " + ago(30) + "\n");
  de.write("topics/foo/ahead.md", "Stand: " + ago(5) + "\n");
  assert.deepEqual(paths(run(de, 10), "conflicting_dates"), ["topics/foo/ahead.md"]);
});

test("stale active notes", () => {
  const target = hub();
  target.write("topics/foo/old.md", "---\nstatus: aktiv\nstand: " + ago(90) + "\n---\n\n# Foo\n");
  target.write("topics/foo/new.md", "---\nstatus: aktiv\nstand: " + ago(0) + "\n---\n\n# Foo\n");
  target.write("topics/foo/plain.md", "No frontmatter.\n");
  assert.deepEqual(paths(run(target, 0, null, 56), "stale_active"), ["topics/foo/old.md"]);
});

test("a sensitive folder and the paths file are excluded", () => {
  const target = repo();
  target.write("topics/hidden/README.md", "> SENSITIVE\n\n# Hidden\n");
  target.write("topics/hidden/note.md", "Not yet done.\n");
  target.write("topics/listed/note.md", "Not yet done.\n");
  target.write("topics/public/note.md", "Not yet done.\n");
  target.write(".sensitive-paths", "topics/listed/\n");
  const data = run(target, 40, 28);
  assert.deepEqual(paths(data, "open_loops"), ["topics/public/note.md"]);
  assert.ok(data.sensitive_files >= 3 && data.sensitive_topics >= 2);
});

test("open words in frontmatter are ignored", () => {
  const target = hub();
  target.write("notes/a.md", '---\nstand: 2026-01-01\nkernfakt: "Kandidat ungeprüft"\n---\n\nNur Fließtext.\n');
  target.write("notes/b.md", "---\nstand: 2026-01-01\n---\n\nDas ist noch offen.\n");
  const found = paths(run(target, 200, 28), "open_loops");
  assert.ok(!found.includes("notes/a.md") && found.includes("notes/b.md"));
});

test("Markdown has a closing count line", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "Nothing special.\n");
  target.commit("init");
  const text = renderMarkdown(scan(target.config));
  assert.ok(text.includes("sensitive files and") && text.includes("sensitive topics skipped"));
});

test("Markdown lists each note once and names its other findings", () => {
  const result: CuratorScan = {
    open_loops: [{ path: "notes/a.md", updated: "2026-01-01", lines: ["TODO: check"] }],
    stale_topics: [],
    conflicting_dates: [],
    stale_active: [{ path: "notes/a.md", updated: "2026-01-01" }, { path: "notes/b.md", updated: "2026-01-02" }],
    sensitive_files: 0, sensitive_topics: 0,
  };
  const text = renderMarkdown(result);
  assert.equal(text.split("`notes/a.md`").length - 1, 1, text);
  assert.ok(text.includes("- `notes/a.md` (2026-01-01). Also: Stale active notes\n  - TODO: check\n"), text);
  assert.ok(text.includes("- `notes/b.md` (2026-01-02)\n"), text);
});

test("the prompt uses config values", () => {
  const text = prompt(hub().config);
  assert.ok(text.includes("topics/kurator/"));
  assert.ok(text.includes("kernfakt") && text.includes("KANTEN.md"));
  assert.ok(text.includes("> SENSIBEL"));
});

test("CLI", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "x\n");
  target.commit();
  assert.equal(invoke(target, ["curator"]).code, 0);
  const result = invoke(target, ["curator", "--prompt"]);
  assert.ok(result.code === 0 && result.out.includes("Curator"));
  target.configure("[extras]\ncurator = false\n");
  assert.equal(invoke(target, ["curator"]).code, 2);
});

test("the frontmatter date is not an as-of date", () => {
  const target = repo();
  target.write("topics/foo/bar.md", "---\nupdated: 2026-01-01\n---\n\n# Bar\n\nAs of 2026-02-02 all good.\n");
  const entry = run(target).conflicting_dates.find((item) => item.path === "topics/foo/bar.md")!;
  assert.deepEqual(entry.dates, ["2026-02-02"]);
});

test("the prompt picks links by entity or collision, never by month alone", () => {
  const text = prompt(hub().config);
  assert.ok(text.includes("`Entitäts-Kanten`") && text.includes("`Kollisionen`"), text);
  assert.ok(text.includes("Skip `Zeit-Kanten`"), text);
});

test("the prompt asks for fresh reasons instead of last week's report", () => {
  const text = prompt(repo().config);
  assert.ok(text.includes("Do not copy from earlier reports"), text);
  assert.ok(text.includes("Give every finding its own reason from this week's scan"), text);
});

test("the prompt creates the report topic with ingest", () => {
  const text = prompt(repo().config);
  assert.ok(text.includes("dummkopf ingest"));
  assert.ok(text.includes("topics/curator/README.md"));
});
