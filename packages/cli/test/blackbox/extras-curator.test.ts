/** Extras, part two: `curator`, its JSON keys, scope filtering and sensitivity counts, and the off switches. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Brain, Sandbox } from "./harness.ts";

// Parsed JSON reports: the tests index into them freely, as the Python suite did.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Today's local date minus `days`, as YYYY-MM-DD (Python's date.today() - timedelta). */
function isoDate(days = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-"
    + String(date.getDate()).padStart(2, "0");
}

const TODAY = isoDate();
const CURATOR_KEYS = ["open_loops", "stale_topics", "conflicting_dates", "stale_active", "sensitive_files",
  "sensitive_topics"];

function doc(title: string, body = "body", { extra = "", updated = TODAY, status = "active" } = {}): string {
  return "---\nupdated: " + updated + "\nstatus: " + status + "\nkey_fact: K.\nsummary: K.\naliases: []\nperiod: []\n"
    + "entities: []\n" + extra + "---\n\n# " + title + "\n\n" + body + "\n";
}

function topic(target: Brain, name: string, scope: string, body = "body", { extra = "", updated = TODAY } = {}): void {
  target.write("topics/" + name + "/README.md", doc(name, "readme", { extra: "scope: " + scope + "\n", updated }));
  target.write("topics/" + name + "/note.md", doc(name + " note", body, { extra, updated }));
}

function curatorJson(target: Brain, ...args: string[]): Json {
  const result = target.run(["curator", "--json", ...args]);
  assert.equal(result.code, 0, result.err);
  return JSON.parse(result.out);
}

function brain(): Brain {
  return new Sandbox().brain();
}

// --- curator ---------------------------------------------------------------------------------------------------

test("curator --json has the scan keys", () => {
  assert.deepEqual(Object.keys(curatorJson(brain())), CURATOR_KEYS);
});

test("curator --json of an empty brain", () => {
  assert.deepEqual(curatorJson(brain()), {
    open_loops: [], stale_topics: [], conflicting_dates: [], stale_active: [], sensitive_files: 0, sensitive_topics: 0,
  });
});

test("curator text has four sections and the skipped line", () => {
  const result = brain().run(["curator"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "# Curator scan\n\n## Open loops\n\nNone found.\n\n## Topics without movement\n\n"
    + "None found.\n\n## Conflicting dates\n\nNone found.\n\n## Stale active notes\n\n"
    + "None found.\n\n0 sensitive files and 0 sensitive topics skipped.\n");
});

test("open loop needs an open word and an old note", () => {
  const b = brain();
  b.write("notes/old-loop.md", doc("Old", "First line\nTODO check the invoice\nmore", { updated: "2020-01-01" }));
  b.write("notes/new-loop.md", doc("New", "TODO check the invoice"));
  b.write("notes/old-quiet.md", doc("Quiet", "all done", { updated: "2020-01-01" }));
  const loops = curatorJson(b).open_loops;
  assert.deepEqual(loops, [{ path: "notes/old-loop.md", updated: "2020-01-01", lines: ["TODO check the invoice"] }]);
});

for (const word of ["open question", "to check", "unverified", "TBD", "not yet"]) {
  test("open word '" + word + "' marks a loop", () => {
    const b = brain();
    b.write("notes/loop.md", doc("Loop", "This is " + word + " still", { updated: "2020-01-01" }));
    assert.deepEqual(curatorJson(b).open_loops.map((loop: Json) => loop.path), ["notes/loop.md"]);
  });
}

test("open loop text shows the matching lines", () => {
  const b = brain();
  b.write("notes/loop.md", doc("Loop", "TODO call back", { updated: "2020-01-01" }));
  assert.ok(b.run(["curator"]).out.includes("- `notes/loop.md` (2020-01-01)\n  - TODO call back\n"));
});

test("--open-days moves the open loop cutoff", () => {
  const b = brain();
  b.write("notes/loop.md", doc("Loop", "TODO call back", { updated: TODAY }));
  assert.deepEqual(curatorJson(b).open_loops, []);
  const threeDaysAgo = isoDate(3);
  b.write("notes/loop.md", doc("Loop", "TODO call back", { updated: threeDaysAgo }));
  assert.deepEqual(curatorJson(b).open_loops, []);
  assert.equal(curatorJson(b, "--open-days", "1").open_loops.length, 1);
});

test("open_days comes from the config", () => {
  const b = brain();
  b.configure("[curator]\nopen_days = 1\n");
  b.write("notes/loop.md", doc("Loop", "TODO call back", { updated: isoDate(3) }));
  assert.equal(curatorJson(b).open_loops.length, 1);
});

test("stale active note is listed", () => {
  const b = brain();
  b.write("notes/stale.md", doc("Stale", undefined, { updated: "2020-01-01" }));
  b.write("notes/shelved.md", doc("Shelved", undefined, { updated: "2020-01-01", status: "archived" }));
  b.write("notes/fresh.md", doc("Fresh"));
  assert.deepEqual(curatorJson(b).stale_active, [{ path: "notes/stale.md", updated: "2020-01-01" }]);
});

test("--stale-days moves the stale cutoff", () => {
  const b = brain();
  b.write("notes/recent.md", doc("Recent", undefined, { updated: isoDate(3) }));
  assert.deepEqual(curatorJson(b).stale_active, []);
  assert.deepEqual(curatorJson(b, "--stale-days", "1").stale_active.map((item: Json) => item.path),
    ["notes/recent.md"]);
});

test("stale topic is a topic whose newest note is old", () => {
  const b = brain();
  topic(b, "quiet", "work", undefined, { updated: "2020-01-01" });
  topic(b, "busy", "work", undefined, { updated: "2020-01-01" });
  b.write("topics/busy/new.md", doc("New"));
  assert.deepEqual(curatorJson(b).stale_topics, [{ path: "topics/quiet/", updated: "2020-01-01" }]);
});

test("conflicting dates name notes whose text is newer than their date", () => {
  const b = brain();
  b.write("notes/conflict.md", doc("Conflict", "As of 2025-01-01 it is x.\n\nAs of 2025-02-02 it is y.",
    { updated: "2025-01-01" }));
  b.write("notes/history.md", doc("History", "As of 2025-01-01 it is x.\n\nAs of 2025-02-02 it is y.",
    { updated: "2025-02-02" }));
  b.write("notes/single.md", doc("Single", "As of 2025-01-01 it is x.", { updated: "2025-01-01" }));
  assert.deepEqual(curatorJson(b).conflicting_dates,
    [{ path: "notes/conflict.md", updated: "2025-01-01", dates: ["2025-01-01", "2025-02-02"] }]);
});

test("repeating the same as-of date is no conflict", () => {
  const b = brain();
  b.write("notes/same.md", doc("Same", "As of 2025-01-01 a.\n\nAs of 2025-01-01 b.", { updated: "2025-01-01" }));
  assert.deepEqual(curatorJson(b).conflicting_dates, []);
});

test("curator leaves sensitive notes out and counts them", () => {
  const b = brain();
  b.write("notes/open.md", doc("Open", "TODO fine", { updated: "2020-01-01" }));
  b.write("notes/marked.md", doc("Marked", "> SENSITIVE\n\nTODO hidden", { updated: "2020-01-01" }));
  const scan = curatorJson(b);
  assert.deepEqual(scan.open_loops.map((loop: Json) => loop.path), ["notes/open.md"]);
  assert.equal(scan.sensitive_files, 1);
  assert.ok(!b.run(["curator"]).out.includes("marked"));
  assert.ok(b.run(["curator"]).out.includes("1 sensitive files and 0 sensitive topics skipped."));
});

test("curator --scope filters the scan", () => {
  const b = brain();
  topic(b, "job", "work", "TODO work item", { updated: "2020-01-01" });
  topic(b, "home", "private", "TODO home item", { updated: "2020-01-01" });
  const paths = curatorJson(b, "--scope", "work").open_loops.map((loop: Json) => loop.path);
  assert.deepEqual(paths, ["topics/job/note.md"]);
  assert.equal(curatorJson(b, "--scope", "both").open_loops.length, 2);
});

test("curator rejects an unknown scope", () => {
  assert.equal(brain().run(["curator", "--scope", "nowhere"]).code, 2);
});

test("curator prompt is filled with the brain settings", () => {
  const result = brain().run(["curator", "--prompt"]);
  assert.equal(result.code, 0);
  assert.ok(result.out.startsWith("# Curator prompt (weekly run)\n"));
  assert.ok(result.out.includes("`topics/curator/YYYY-WW.md`"));
  assert.ok(result.out.includes("LINKS.md"));
  assert.ok(result.out.includes("> SENSITIVE"));
  assert.ok(result.out.includes(".sensitive-paths"));
  for (const placeholder of ["{report_dir}", "{links_file}", "{marker}", "{paths_file}", "{updated}", "{key_fact}"]) {
    assert.ok(!result.out.includes(placeholder), placeholder);
  }
});

test("curator prompt follows the config", () => {
  const b = brain();
  b.configure('[curator]\nreport_dir = "reports/weekly"\n\n[sensitive]\nmarker = "> HUSH"\n\n'
    + '[links]\noutput = "MAP.md"\n');
  const out = b.run(["curator", "--prompt"]).out;
  assert.ok(out.includes("reports/weekly/YYYY-WW.md"));
  assert.ok(out.includes("> HUSH"));
  assert.ok(out.includes("MAP.md"));
});

// --- off switches ----------------------------------------------------------------------------------------------

for (const command of [["links"], ["links", "--json"], ["curator"], ["curator", "--json"], ["curator", "--prompt"]]) {
  test("disabled extras exit 2 and name the switch: " + command.join(" "), () => {
    const b = brain();
    b.configure("[extras]\nlinks = false\ncurator = false\n");
    const result = b.run(command);
    const name = command[0]!;
    assert.equal(result.code, 2);
    assert.equal(result.out, "");
    assert.equal(result.err, "The extra `" + name + "` is disabled in dummkopf.toml ([extras] " + name + " = false).\n");
  });
}

test("disabling one extra leaves the other working", () => {
  const b = brain();
  b.configure("[extras]\nlinks = false\n");
  assert.equal(b.run(["links"]).code, 2);
  assert.equal(b.run(["curator"]).code, 0);
});

test("disabled links do not write the map", () => {
  const b = brain();
  b.configure("[extras]\nlinks = false\n");
  b.run(["links"]);
  assert.ok(!b.exists("LINKS.md"));
});
