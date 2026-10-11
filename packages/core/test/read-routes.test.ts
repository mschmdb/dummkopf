/** Port of tests/test_routes.py. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

import { Access } from "../src/access.ts";
import { AccessDenied } from "../src/errors.ts";
import { splitlines } from "../src/py.ts";
import { PyDate } from "../src/pydate.ts";
import { bounded } from "../src/render.ts";
import { contextPacket, type Packet } from "../src/search.ts";
import { type Brain, BASE_CONFIG, german, invoke, makeBrain, tempDir } from "./helpers.ts";

process.setMaxListeners(0);

const TODAY = new PyDate(2026, 10, 4);

/** A German brain with one private, sensitive dated-plan route (as an existing hub uses it). */
class Routed {
  readonly brain: Brain;

  constructor(brain: Brain, setup = true) {
    this.brain = brain;
    if (!setup) return;
    brain.write(".sensitive-paths", "topics/locked/\n");
    brain.write("topics/locked/README.md", "---\nscope: privat\n---\n> SENSIBEL\n");
    this.routes([{ aliases: ["testplan"], sources: "topics/locked/plan-*.md", scope: "privat",
                   kind: "dated-plan", allow_sensitive: true }]);
  }

  routes(routes: Record<string, unknown>[], name = "routen.json"): void {
    this.brain.write(name, JSON.stringify({ routes }));
  }

  request(query: string, scope = "privat", date = TODAY): Packet {
    return contextPacket(new Access(this.brain.config, scope), query, date);
  }

  plan(period: string, body: string, connector = "bis"): void {
    const cut = period.lastIndexOf("-");
    this.brain.write("topics/locked/plan-" + period.slice(0, cut) + "-" + connector + "-" + period.slice(cut + 1)
      + ".md", "# Testplan\n\n" + body);
  }

  out(packet: Packet): string {
    return bounded(packet, 6000, true, "plain");
  }
}

const hub = (): Routed => new Routed(german());
const paths = (packet: Packet): string[] => packet.hits.map((hit) => hit.path);

describe("routes", () => {
  test("explicit request routes to overlapping period and only matching rows", () => {
    const h = hub();
    h.plan("2026-09-25-30", "| Tag | Aufgabe |\n|---|---|\n| Mo, 28.09. | OLD |");
    h.plan("2026-10-02-09", "| Tag | Aufgabe |\n|---|---|\n| So, 04.10. | BEFORE |\n"
      + "| Mo, 05.10. | TARGET |\n| Fr, 09.10. | LAST |");
    h.plan("2026-10-12-18", "| Mo, 12.10. | FUTURE |");
    const result = h.request("Was ist der Testplan für nächste Woche?");
    assert.equal(result.match, "routed");
    assert.deepEqual(paths(result), ["topics/locked/plan-2026-10-02-bis-09.md"]);
    assert.deepEqual(result.period, { start: "2026-10-05", end: "2026-10-11" });
    assert.deepEqual(result.missing_dates, ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10", "2026-10-11"]);
    const output = h.out(result);
    assert.ok(output.includes("TARGET"));
    for (const absent of ["BEFORE", "FUTURE", "OLD"]) assert.ok(!output.includes(absent));
  });

  test("general request does not grant access or reveal private paths", () => {
    const h = hub();
    h.plan("2026-10-02-09", "SECRET");
    const result = h.request("Was gibt es Neues?");
    assert.deepEqual(result.hits, []);
    assert.ok(!h.out(result).includes("locked"));
  });

  test("substring does not authorize a route", () => {
    const h = hub();
    h.plan("2026-10-02-09", "SECRET");
    assert.deepEqual(h.request("Was ist der Testplaner?").hits, []);
  });

  test("work scope never reads private route", () => {
    const h = hub();
    h.plan("2026-10-02-09", "SECRET");
    const result = h.request("Was ist der Testplan?", "work");
    assert.deepEqual(result.hits, []);
    assert.ok(!h.out(result).includes("locked"));
  });

  test("explicit negation does not open a route", () => {
    const h = hub();
    h.plan("2026-10-02-09", "SECRET");
    assert.deepEqual(h.request("Zeige keinen Testplan").hits, []);
  });

  test("negation in another sentence does not hide requested plan", () => {
    const h = hub();
    h.plan("2026-10-02-09", "| Mo, 05.10. | TARGET |");
    const result = h.request("Testplan nächste Woche. Keine anderen Notizen lesen.");
    assert.equal(result.match, "routed");
    assert.equal(result.hits.length, 1);
  });

  test("excluded ingredient does not negate the topic", () => {
    const h = hub();
    h.plan("2026-10-02-09", "| Mo, 05.10. | TARGET |");
    assert.equal(h.request("Testplan nächste Woche ohne Zucker").match, "routed");
  });

  test("unrelated sensitive file is not authorized", () => {
    const h = hub();
    h.plan("2026-10-02-09", "TARGET");
    h.brain.write("topics/locked/other.md", "# Testplan\nSECRET unrelated");
    const result = h.request("Zeig den Testplan");
    assert.equal(result.hits.length, 1);
    assert.ok(!h.out(result).includes("unrelated"));
  });

  test("no matching period does not fall back to old plan", () => {
    const h = hub();
    h.plan("2026-09-25-30", "OLD");
    const result = h.request("Testplan nächste Woche");
    assert.deepEqual(result.hits, []);
    assert.equal(result.match, "routed");
  });

  test("month boundary is handled", () => {
    const h = hub();
    h.plan("2026-12-29-04", "| Fr, 01.01. | NEW YEAR |");
    const result = h.request("Testplan nächste Woche", "privat", new PyDate(2026, 12, 27));
    assert.equal(result.period!.end, "2027-01-03");
    assert.equal(result.missing_dates!.at(-1), "2027-01-03");
    assert.ok(h.out(result).includes("NEW YEAR"));
  });

  test("metadata match beats unrelated literal question", () => {
    const h = hub();
    h.brain.write("notes/source.md", "---\naliase: [widget, restart]\n---\n# Widget\nRestart the widget.");
    h.brain.write("notes/chat.md", "# Chat\nWarum muss ich den Widget restart machen?");
    const result = h.request("Warum muss ich den Widget restart machen?", "both");
    assert.equal(result.hits[0]!.path, "notes/source.md");
  });

  test("physical line numbers remain exact", () => {
    const h = hub();
    h.plan("2026-10-02-09", "| Tag | Aufgabe |\n|---|---|\n| Mo, 05.10. | TARGET |");
    const hit = h.request("Testplan nächste Woche").hits[0]!;
    const lines = splitlines(h.brain.read(hit.path));
    for (const line of hit.lines) assert.equal(line.text, lines[line.n - 1]);
  });

  test("missing configuration keeps normal protection", () => {
    const h = hub();
    fs.unlinkSync(path.join(h.brain.root, "routen.json"));
    h.plan("2026-10-02-09", "SECRET");
    assert.deepEqual(h.request("Testplan nächste Woche").hits, []);
  });

  for (const source of ["../outside/*.md", "topics/*/*.md", "/tmp/plan-*.md", "sources/plan-*.md", "topics/a/**/x.md"]) {
    test("invalid configuration fails closed: " + source, () => {
      const h = hub();
      h.routes([{ aliases: ["testplan"], sources: source, scope: "privat", kind: "dated-plan" }]);
      assert.throws(() => h.request("Testplan"), AccessDenied);
    });
  }

  const badRoutes = [
    { aliases: ["x"], sources: "topics/a/p-*.md", scope: "private", kind: "dated-plan" },
    { aliases: [], sources: "topics/a/p-*.md", scope: "privat", kind: "dated-plan" },
    { aliases: ["x"], sources: "topics/a/p-*.md", scope: "privat", kind: "other" },
  ];
  badRoutes.forEach((route, index) => {
    test("invalid route fields fail closed " + index, () => {
      const h = hub();
      h.routes([route]);
      assert.throws(() => h.request("x"), AccessDenied);
    });
  });

  test("route symlink cannot open an external file", () => {
    const h = hub();
    h.plan("2026-10-02-09", "SECRET");
    const target = path.join(h.brain.root, "topics/locked/plan-2026-10-02-bis-09.md");
    fs.unlinkSync(target);
    h.brain.write("outside.md", "EXTERNAL SECRET");
    fs.symlinkSync(path.join(h.brain.root, "outside.md"), target);
    assert.deepEqual(h.request("Testplan").hits, []);
  });

  test("current week starts on monday", () => {
    const h = hub();
    h.plan("2026-10-02-09", "| So, 04.10. | CURRENT |\n| Mo, 05.10. | NEXT |");
    const result = h.request("Testplan diese Woche");
    assert.deepEqual(result.period, { start: "2026-09-28", end: "2026-10-04" });
    assert.ok(h.out(result).includes("CURRENT"));
    assert.ok(!h.out(result).includes("NEXT"));
  });

  test("period context omits whole document summary", () => {
    const h = hub();
    h.brain.write("topics/locked/plan-2026-10-02-bis-09.md", "---\nkernfakt: OLD SATURDAY\n---\n# Testplan\n| Mo, 05.10. | TARGET |");
    assert.ok(!h.out(h.request("Testplan nächste Woche")).includes("OLD SATURDAY"));
  });

  test("question with only stopwords returns empty", () => {
    assert.deepEqual(hub().request("Was ist das?").hits, []);
  });

  test("command accepts an original question and bounds output", () => {
    const h = hub();
    const today = PyDate.today();
    const monday = today.addDays(7 - today.weekday());
    const sunday = monday.addDays(6);
    const dm = String(monday.day).padStart(2, "0") + "." + String(monday.month).padStart(2, "0") + ".";
    h.brain.write("topics/locked/plan-" + monday.isoformat() + "-bis-" + sunday.isoformat() + ".md",
      "# Testplan\n\n| Mo, " + dm + " | " + "x".repeat(4000) + " |");
    const result = invoke(h.brain, ["context", "Testplan nächste Woche", "--scope", "privat", "--json",
                                    "--max-chars", "500"]);
    assert.equal(result.code, 0, result.err);
    assert.ok(result.out.length <= 500);
    assert.ok(JSON.parse(result.out).truncated);
  });

  test("marker added outside protection list remains private", () => {
    const h = hub();
    h.brain.write("notes/new.md", "> SENSIBEL\n# Widget\nRestart secret");
    assert.deepEqual(h.request("Widget restart").hits, []);
  });

  test("english locale routes", () => {
    const brain = makeBrain(path.join(tempDir(), "en"), BASE_CONFIG("x"));
    const h = new Routed(brain, false);
    brain.write("topics/meals/README.md", "---\nscope: private\n---\n# Meals\n");
    h.routes([{ aliases: ["meal plan"], sources: "topics/meals/plan-*.md", scope: "private", kind: "dated-plan" }],
      "routes.json");
    brain.write("topics/meals/plan-2026-10-02-to-09.md",
      "# Meal plan\n\n| Day | Dish |\n|---|---|\n| Sun 10-04 | NOW |\n| Mon 10-05 | NEXT |\n| Tue 2026-10-06 | LATER |");
    const next = h.out(h.request("What is the meal plan for next week?", "private"));
    assert.ok(next.includes("NEXT") && next.includes("LATER") && !next.includes("NOW"));
    assert.equal(h.request("What is the meal plan for next week?", "private").match, "routed");
    const now = h.out(h.request("meal plan this week", "private"));
    assert.ok(now.includes("NOW") && !now.includes("NEXT"));
    assert.notEqual(h.request("Do not show the meal plan", "private").match, "routed");
    assert.equal(h.request("meal plan next week without onions", "private").match, "routed");
  });
});
