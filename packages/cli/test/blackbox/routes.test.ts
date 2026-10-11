/** Routes: `context` opens dated plan files by alias and period, and only the matching rows. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Sandbox } from "./harness.ts";
import type { Brain } from "./harness.ts";

type Route = Record<string, unknown>;
type Packet = Record<string, any>;

/** A calendar day as a UTC midnight, so adding days never trips over daylight saving time. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function addDays(day: Date, count: number): Date {
  return new Date(day.getTime() + count * 86_400_000);
}

function iso(day: Date): string {
  return day.toISOString().slice(0, 10);
}

const TODAY = today();
const MONDAY = addDays(TODAY, -((TODAY.getUTCDay() + 6) % 7));
const NEXT_MONDAY = addDays(MONDAY, 7);
const ROUTE: Route = { aliases: ["meal plan"], sources: "topics/meals/plan-*.md", scope: "private", kind: "dated-plan" };

function writeRoutes(target: Brain, routes: Route[], name = "routes.json"): void {
  target.write(name, JSON.stringify({ routes }));
}

function plan(target: Brain, start: Date, end: Date, rows: [Date, string][], connector = "to"): string {
  const rel = "topics/meals/plan-" + iso(start) + "-" + connector + "-" + iso(end) + ".md";
  const table = rows.map(([day, meal]) => "| " + iso(day) + " | " + meal + " |");
  const lines = ["# Plan", "", "| Day | Meal |", "|---|---|", ...table];
  target.write(rel, lines.join("\n") + "\n");
  return rel;
}

function context(target: Brain, query: string, ...args: string[]): Packet {
  const result = target.run(["context", query, "--json", ...args]);
  assert.equal(result.code, 0, result.err);
  return JSON.parse(result.out);
}

function hitPaths(packet: Packet): string[] {
  return packet.hits.map((hit: Packet) => hit.path);
}

function brain(): Brain {
  return new Sandbox().brain();
}

function meals(): Brain {
  const target = brain();
  target.write("topics/meals/README.md", "---\nscope: private\n---\n\n# Meals\n");
  writeRoutes(target, [ROUTE]);
  return target;
}

function week(start: Date, count = 7): Date[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

// --- routed answers ---------------------------------------------------------------------------------------------

test("next week opens the overlapping plan and only its matching rows", () => {
  const target = meals();
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "THISWEEKROW"]]);
  const chosen = plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6),
    [[NEXT_MONDAY, "pasta"], [addDays(NEXT_MONDAY, 2), "soup"]]);
  plan(target, addDays(NEXT_MONDAY, 7), addDays(NEXT_MONDAY, 13), [[addDays(NEXT_MONDAY, 7), "LATERROW"]]);
  const packet = context(target, "meal plan next week");
  assert.equal(packet.match, "routed");
  assert.deepEqual(hitPaths(packet), [chosen]);
  const texts = packet.hits[0].lines.map((line: Packet) => line.text);
  assert.deepEqual(texts, ["# Plan", "| Day | Meal |", "|---|---|",
    "| " + iso(NEXT_MONDAY) + " | pasta |", "| " + iso(addDays(NEXT_MONDAY, 2)) + " | soup |"]);
});

test("routed lines keep their physical line numbers", () => {
  const target = meals();
  const rel = plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  const fileLines = target.read(rel).replace(/\n$/, "").split("\n");
  for (const line of context(target, "meal plan next week").hits[0].lines) {
    assert.equal(fileLines[line.n - 1], line.text);
  }
});

test("routed JSON has period and missing dates", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"], [addDays(NEXT_MONDAY, 2), "soup"]]);
  const packet = context(target, "meal plan next week");
  assert.deepEqual(packet.period, { start: iso(NEXT_MONDAY), end: iso(addDays(NEXT_MONDAY, 6)) });
  assert.deepEqual(packet.missing_dates, [1, 3, 4, 5, 6].map((offset) => iso(addDays(NEXT_MONDAY, offset))));
  assert.deepEqual(Object.keys(packet), ["hits", "match", "more", "truncated", "period", "missing_dates"]);
});

test("routed text names the period and the dates without rows", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), week(NEXT_MONDAY, 6).map((day) => [day, "x"]));
  const out = target.run(["context", "meal plan next week"]).out;
  const sunday = iso(addDays(NEXT_MONDAY, 6));
  assert.equal(out.split("\n")[0], "Requested period: " + iso(NEXT_MONDAY) + " to " + sunday);
  assert.ok(out.trimEnd().endsWith("No dated plan rows for: " + sunday), out);
});

test("a fully covered period has no missing dates", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), week(NEXT_MONDAY).map((day) => [day, "x"]));
  const packet = context(target, "meal plan next week");
  assert.deepEqual(packet.missing_dates, []);
  assert.ok(!target.run(["context", "meal plan next week"]).out.includes("No dated plan rows"));
});

test("this week uses Monday to Sunday of the current week", () => {
  const target = meals();
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "THISWEEKROW"]]);
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "NEXTWEEKROW"]]);
  const packet = context(target, "meal plan this week");
  assert.deepEqual(packet.period, { start: iso(MONDAY), end: iso(addDays(MONDAY, 6)) });
  const rendered = JSON.stringify(packet);
  assert.ok(rendered.includes("THISWEEKROW"));
  assert.ok(!rendered.includes("NEXTWEEKROW"));
});

test("a plan spanning two weeks serves both", () => {
  const target = meals();
  const rel = plan(target, MONDAY, addDays(NEXT_MONDAY, 6), [[MONDAY, "first"], [NEXT_MONDAY, "second"]]);
  assert.deepEqual(hitPaths(context(target, "meal plan next week")), [rel]);
  assert.deepEqual(hitPaths(context(target, "meal plan this week")), [rel]);
});

test("short file names with only the end day work", () => {
  const target = meals();
  const start = NEXT_MONDAY;
  const end = addDays(NEXT_MONDAY, 6);
  const rel = "topics/meals/plan-" + iso(start) + "-to-" + String(end.getUTCDate()).padStart(2, "0") + ".md";
  target.write(rel, "# Plan\n\n| Day | Meal |\n|---|---|\n| " + iso(start) + " | pasta |\n");
  assert.deepEqual(hitPaths(context(target, "meal plan next week")), [rel]);
});

test("no overlapping plan gives no hits but stays routed", () => {
  const target = meals();
  plan(target, addDays(MONDAY, -14), addDays(MONDAY, -8), [[addDays(MONDAY, -14), "OLDROW"]]);
  const packet = context(target, "meal plan next week");
  assert.deepEqual(packet.hits, []);
  assert.equal(packet.match, "routed");
  assert.equal(packet.missing_dates.length, 7);
});

test("without a period the plan covering today is chosen", () => {
  const target = meals();
  const current = plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "current"]]);
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "future"]]);
  const packet = context(target, "meal plan");
  assert.deepEqual(hitPaths(packet), [current]);
  assert.ok(!("period" in packet));
});

test("without a period the latest past plan is the fallback", () => {
  const target = meals();
  plan(target, addDays(MONDAY, -28), addDays(MONDAY, -22), [[addDays(MONDAY, -28), "oldest"]]);
  const latest = plan(target, addDays(MONDAY, -14), addDays(MONDAY, -8), [[addDays(MONDAY, -14), "latest"]]);
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "future"]]);
  assert.deepEqual(hitPaths(context(target, "meal plan")), [latest]);
});

test("the alias matches whole words only", () => {
  const target = meals();
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "ROUTEDROW"]]);
  assert.notEqual(context(target, "meal planner").match, "routed");
  assert.equal(context(target, "meal plan").match, "routed");
  assert.equal(context(target, "What is the meal plan?").match, "routed");
});

test("a negated request does not open the route", () => {
  const target = meals();
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "ROUTEDROW"]]);
  assert.notEqual(context(target, "show me no meal plan").match, "routed");
  assert.equal(context(target, "meal plan without sugar").match, "routed");
});

test("a negation in another sentence does not cancel the request", () => {
  const target = meals();
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "ROUTEDROW"]]);
  assert.equal(context(target, "Meal plan please. Do not read other notes.").match, "routed");
});

test("route scope must match the requested scope", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  assert.deepEqual(context(target, "meal plan next week", "--scope", "work").hits, []);
  assert.equal(context(target, "meal plan next week", "--scope", "private").hits.length, 1);
  assert.equal(context(target, "meal plan next week", "--scope", "both").hits.length, 1);
});

test("topic option restricts the route to that topic", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  assert.deepEqual(context(target, "meal plan next week", "--topic", "elsewhere").hits, []);
  assert.equal(context(target, "meal plan next week", "--topic", "meals").hits.length, 1);
});

test("a route opens only files matching its pattern", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  target.write("topics/meals/notes.md", "# Notes\n\nOTHERFILEWORD\n");
  target.write("topics/meals/plan-notes.md", "# Plan notes\n\nOTHERFILEWORD\n");
  assert.ok(!JSON.stringify(context(target, "meal plan next week")).includes("OTHERFILEWORD"));
});

test("routes file name comes from the config", () => {
  const target = meals();
  fs.unlinkSync(path.join(target.root, "routes.json"));
  target.configure('[context]\nroutes_file = "my-routes.json"\n');
  writeRoutes(target, [ROUTE], "my-routes.json");
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  assert.equal(context(target, "meal plan next week").match, "routed");
});

test("without a routes file context is a normal search", () => {
  const target = meals();
  fs.unlinkSync(path.join(target.root, "routes.json"));
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  assert.notEqual(context(target, "meal plan next week").match, "routed");
});

test("find never uses routes", () => {
  const target = meals();
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "pasta"]]);
  const packet = JSON.parse(target.run(["find", "meal plan next week", "--json"]).out);
  assert.notEqual(packet.match, "routed");
  assert.ok(!("period" in packet));
});

test("a symlinked plan file is not opened", () => {
  const target = meals();
  target.write("outside.md", "# Plan\n\n| Day | Meal |\n|---|---|\n| " + iso(NEXT_MONDAY) + " | EXTERNALROW |\n");
  const link = path.join(target.root, "topics/meals/plan-" + iso(NEXT_MONDAY) + "-to-" + iso(addDays(NEXT_MONDAY, 6)) + ".md");
  fs.symlinkSync(path.join(target.root, "outside.md"), link);
  assert.deepEqual(context(target, "meal plan next week").hits, []);
});

test("German locale reads German weeks and row dates", () => {
  const target = brain();
  target.configure('[ui]\nlocale = "de"\n');
  target.write("topics/essen/README.md", "---\nscope: private\n---\n\n# Essen\n");
  writeRoutes(target, [{ ...ROUTE, aliases: ["essensplan"], sources: "topics/essen/plan-*.md" }]);
  const end = addDays(NEXT_MONDAY, 6);
  const rel = "topics/essen/plan-" + iso(NEXT_MONDAY) + "-bis-" + iso(end) + ".md";
  const [, month, day] = iso(NEXT_MONDAY).split("-");
  target.write(rel, "# Plan\n\n| Tag | Essen |\n|---|---|\n| Mo, " + day + "." + month + ". | Nudeln |\n");
  const packet = context(target, "Essensplan nächste Woche");
  assert.equal(packet.match, "routed");
  assert.deepEqual(hitPaths(packet), [rel]);
  assert.ok(packet.hits[0].lines.some((line: Packet) => line.text.includes("Nudeln")));
  assert.equal(packet.missing_dates.length, 6);
});

// --- sensitive plans -------------------------------------------------------------------------------------------

function sensitiveMeals(): Brain {
  const target = meals();
  target.write(".sensitive-paths", "topics/meals/\n");
  plan(target, NEXT_MONDAY, addDays(NEXT_MONDAY, 6), [[NEXT_MONDAY, "secretpasta"]]);
  target.write("topics/meals/other.md", "# Other\n\nSECRETOTHER\n");
  return target;
}

test("a sensitive plan stays closed without allow_sensitive in the route", () => {
  const packet = context(sensitiveMeals(), "meal plan next week");
  assert.deepEqual(packet.hits, []);
  assert.ok(!JSON.stringify(packet).includes("secretpasta"));
});

test("allow_sensitive in the route opens the matching plan", () => {
  const target = sensitiveMeals();
  writeRoutes(target, [{ ...ROUTE, allow_sensitive: true }]);
  const packet = context(target, "meal plan next week");
  assert.ok(JSON.stringify(packet).includes("secretpasta"));
  assert.equal(packet.match, "routed");
});

test("an opened sensitive route does not open other files of the folder", () => {
  const target = sensitiveMeals();
  writeRoutes(target, [{ ...ROUTE, allow_sensitive: true }]);
  assert.ok(!JSON.stringify(context(target, "meal plan next week")).includes("SECRETOTHER"));
  assert.equal(target.run(["read", "topics/meals/other.md"]).code, 2);
});

test("an opened sensitive route does not open the plan for other commands", () => {
  const target = sensitiveMeals();
  writeRoutes(target, [{ ...ROUTE, allow_sensitive: true }]);
  assert.deepEqual(JSON.parse(target.run(["find", "secretpasta", "--json"]).out).hits, []);
  assert.equal(target.run(["read", "topics/meals/plan-" + iso(NEXT_MONDAY) + "-to-"
    + iso(addDays(NEXT_MONDAY, 6)) + ".md"]).code, 2);
  assert.deepEqual(context(target, "Anything new in the notes?").hits, []);
});

test("a general question does not open a sensitive route", () => {
  const target = sensitiveMeals();
  writeRoutes(target, [{ ...ROUTE, allow_sensitive: true }]);
  assert.ok(!JSON.stringify(context(target, "What is new this week?")).includes("secretpasta"));
});

test("a hidden newer plan does not change the answer", () => {
  const target = meals();
  const visible = plan(target, addDays(MONDAY, -14), addDays(MONDAY, -8), [[addDays(MONDAY, -14), "visible"]]);
  const before = context(target, "meal plan");
  target.write(".sensitive-paths", "topics/meals/plan-" + iso(MONDAY) + "-to-" + iso(addDays(MONDAY, 6)) + ".md\n");
  plan(target, MONDAY, addDays(MONDAY, 6), [[MONDAY, "hiddennewer"]]);
  const after = context(target, "meal plan");
  assert.deepEqual(after, before);
  assert.equal(after.hits[0].path, visible);
});

// --- invalid routes fail closed ----------------------------------------------------------------------------------

function routesError(target: Brain, raw: string | null, ...routes: Route[]): string {
  if (raw !== null) target.write("routes.json", raw);
  else writeRoutes(target, routes);
  const result = target.run(["context", "anything at all"]);
  assert.equal(result.code, 2);
  assert.equal(result.out, "");
  return result.err;
}

const SUFFIX = ". All routes stay closed until this is fixed.\n";
const SOURCES_SHAPE = "route 1: sources must look like <note folder>/<folder>/<name>-*.md, wildcards only in the file name";
const ALIASES_LIST = "route 1: aliases must be a non-empty list of strings";

const INVALID_ROUTES: [string, unknown, string][] = [
  ["unknown key", { ...ROUTE, bogus: 1 }, "route 1: unknown key 'bogus'"],
  ["bad scope", { ...ROUTE, scope: "nowhere" }, "route 1: scope must be one of private, work"],
  ["bad kind", { ...ROUTE, kind: "other" }, "route 1: kind must be dated-plan"],
  ["empty aliases", { ...ROUTE, aliases: [] }, ALIASES_LIST],
  ["non-string alias", { ...ROUTE, aliases: [5] }, ALIASES_LIST],
  ["short alias", { ...ROUTE, aliases: ["it"] }, "route 1: alias 'it' needs a real word (3+ letters, not a filler word)"],
  ["filler alias", { ...ROUTE, aliases: ["the"] }, "route 1: alias 'the' needs a real word (3+ letters, not a filler word)"],
  ["non-string sources", { ...ROUTE, sources: 5 }, "route 1: sources must be a string"],
  ["sources leaving the brain", { ...ROUTE, sources: "../x/plan-*.md" }, SOURCES_SHAPE],
  ["wildcard folder in sources", { ...ROUTE, sources: "topics/*/plan-*.md" }, SOURCES_SHAPE],
  ["sources outside a note folder", { ...ROUTE, sources: "sources/meals/plan-*.md" }, SOURCES_SHAPE],
  ["non-boolean allow_sensitive", { ...ROUTE, allow_sensitive: "yes" }, "route 1: allow_sensitive must be true or false"],
  ["route not an object", "text", "route 1: must be an object"],
];

for (const [label, route, problem] of INVALID_ROUTES) {
  test("invalid route names the route and the problem: " + label, () => {
    const target = meals();
    target.write("routes.json", JSON.stringify({ routes: [route] }));
    const result = target.run(["context", "anything at all"]);
    assert.equal(result.code, 2);
    assert.equal(result.err, "routes.json: " + problem + SUFFIX);
  });
}

test("the second broken route is numbered 2", () => {
  assert.equal(routesError(meals(), null, ROUTE, { ...ROUTE, kind: "other" }),
    "routes.json: route 2: kind must be dated-plan" + SUFFIX);
});

for (const [raw, problem] of [
  ["{not json", "not readable as JSON"],
  ['{"routes": "x"}', 'needs a top-level "routes" list'],
  ["[]", 'needs a top-level "routes" list'],
  ["{}", 'needs a top-level "routes" list'],
]) {
  test("unreadable routes file " + raw + " fails closed", () => {
    assert.equal(routesError(meals(), raw!), "routes.json: " + problem + SUFFIX);
  });
}

test("symlinked routes file fails closed", () => {
  const target = meals();
  fs.unlinkSync(path.join(target.root, "routes.json"));
  target.write("real-routes.json", JSON.stringify({ routes: [ROUTE] }));
  fs.symlinkSync(path.join(target.root, "real-routes.json"), path.join(target.root, "routes.json"));
  const err = routesError(target, null);
  assert.ok(err.startsWith("routes.json: must not be a symlink"), err);
});

test("broken routes do not affect find or read", () => {
  const target = meals();
  target.write("routes.json", "{not json");
  target.write("notes/n.md", "# N\n\nneedle\n");
  assert.equal(target.run(["find", "needle"]).code, 0);
  assert.equal(target.run(["read", "notes/n.md"]).code, 0);
});

test("an empty routes list is valid", () => {
  const target = meals();
  writeRoutes(target, []);
  assert.equal(target.run(["context", "anything at all"]).code, 0);
});
