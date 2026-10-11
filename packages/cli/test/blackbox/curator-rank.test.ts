/** Search ranks curator reports below the notes they summarize, unless the question names the curator. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type Brain, fullNote, Sandbox } from "./harness.ts";

const REPORT = "topics/curator/2026-10-week.md";
const NOTE = "notes/docker.md";

/** A note and a curator report that repeats its terms more prominently. */
function brain(extra = ""): Brain {
  const target = new Sandbox().brain("brain", extra);
  target.write(NOTE, fullNote({ title: "Docker", body: "pnpm esbuild fails in the docker build." }));
  target.write("topics/curator/README.md", fullNote({ title: "Curator", body: "Weekly reports.", scope: "work" }));
  target.write(REPORT, fullNote({ title: "Docker esbuild pnpm review",
    body: "Docker: pnpm esbuild fails. Docker build notes. esbuild and pnpm again." }));
  return target;
}

function paths(out: string): string[] {
  return out.split("\n").filter((line) => line.includes(" | rev=")).map((line) => line.split(" | ")[0]!);
}

test("context ranks the note above a curator report that repeats it", () => {
  const found = paths(brain().run(["context", "Why does esbuild fail with pnpm in docker?"]).out);
  assert.equal(found[0], NOTE, found.join(", "));
  assert.ok(found.includes(REPORT), found.join(", "));
});

test("find ranks the note above a curator report with the same terms", () => {
  const found = paths(brain().run(["find", "docker esbuild", "--limit", "5"]).out);
  assert.deepEqual(found.slice(0, 2), [NOTE, REPORT]);
});

test("curator_report_percent = 100 ranks reports like any note", () => {
  const found = paths(brain("[search.weights]\ncurator_report_percent = 100\n")
    .run(["find", "docker esbuild", "--limit", "5"]).out);
  assert.equal(found[0], REPORT);
});

test("a question naming the curator ranks the report above the note", () => {
  const found = paths(brain().run(["context", "What did the curator say about docker esbuild?"]).out);
  assert.ok(found.includes(REPORT) && found.indexOf(REPORT) < found.indexOf(NOTE), found.join(", "));
});

test("the last folder of report_dir counts as a curator word", () => {
  const target = brain('[curator]\nreport_dir = "topics/hub/kurator"\n');
  target.write("topics/hub/README.md", fullNote({ title: "Hub", body: "Hub.", scope: "work" }));
  target.write("topics/hub/kurator/week.md", target.read(REPORT));
  const lowered = paths(target.run(["find", "docker esbuild", "--limit", "5"]).out);
  assert.equal(lowered.indexOf("topics/hub/kurator/week.md"), lowered.indexOf(NOTE) + 1, lowered.join(", "));
  const named = paths(target.run(["context", "kurator docker esbuild"]).out);
  assert.ok(named.indexOf("topics/hub/kurator/week.md") < named.indexOf(NOTE), named.join(", "));
});

test("curator_report_percent must be at most 100", () => {
  const result = brain("[search.weights]\ncurator_report_percent = 101\n").run(["find", "docker"]);
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("search.weights.curator_report_percent"), result.err);
});
