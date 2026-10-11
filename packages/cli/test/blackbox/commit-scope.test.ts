/** What dummkopf commits: note folders and generated files only, and `--message` for writes. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { fullNote, ingest, md, newEntry, Sandbox, type Synced } from "./harness.ts";

function agentHook(world: Synced): number {
  const event = { hook_event_name: "PostToolUse", tool_name: "Bash", cwd: world.brain.root, tool_input: {} };
  return world.sandbox.run(["hook", "agent", "--root", world.brain.root],
    { cwd: world.brain.root, stdin: JSON.stringify(event) }).code;
}

function changeConfig(world: Synced): void {
  fs.appendFileSync(path.join(world.brain.root, "dummkopf.toml"), "# tuned by an agent\n", "utf-8");
}

// --- the commit scope -------------------------------------------------------------------------------------------

test("agent hook commits a changed note but leaves dummkopf.toml for a human", () => {
  const world = new Sandbox().synced();
  changeConfig(world);
  world.brain.write("notes/pending.md", fullNote({ title: "Pending" }));
  assert.equal(agentHook(world), 0);
  assert.ok(world.remoteFiles().includes("notes/pending.md"));
  assert.ok(!world.remoteFile("dummkopf.toml").includes("tuned by an agent"));
  assert.equal(world.brain.git(["status", "--porcelain"]), "M dummkopf.toml");
});

test("agent hook leaves agent setup and other tooling uncommitted", () => {
  const world = new Sandbox().synced();
  world.brain.write("AGENTS.md", "# Rules\n");
  world.brain.write("CLAUDE.md", "@AGENTS.md\n");
  world.brain.write(".claude/settings.json", "{}\n");
  world.brain.write(".codex/hooks.json", "{}\n");
  world.brain.write("scripts/tool.sh", "echo hi\n");
  world.brain.write("notes/pending.md", fullNote({ title: "Pending" }));
  assert.equal(agentHook(world), 0);
  const files = world.remoteFiles();
  assert.ok(files.includes("notes/pending.md"));
  for (const rel of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".codex/hooks.json", "scripts/tool.sh"]) {
    assert.ok(!files.includes(rel), rel);
  }
});

test("agent hook commits the generated files and every note folder", () => {
  const world = new Sandbox().synced();
  const generated = ["INDEX.md", ".sensitive-paths", "LINKS.md", "topics/job/README.md", "topics/job/plan.md",
    "bookmarks/site.md", "sources/original.pdf", "archive/old.md"];
  for (const rel of generated) world.brain.write(rel, "# " + rel + "\n");
  assert.equal(agentHook(world), 0);
  const files = world.remoteFiles();
  for (const rel of generated) assert.ok(files.includes(rel), rel);
  assert.equal(world.brain.git(["status", "--porcelain"]), "");
});

test("a configured links.output and curator.report_dir are committed too", () => {
  const world = new Sandbox().synced();
  world.brain.configure('[links]\noutput = "maps/LINKS.md"\n[curator]\nreport_dir = "reports/curator"\n');
  world.brain.commit("config");
  world.brain.write("maps/LINKS.md", "# Links\n");
  world.brain.write("reports/curator/week.md", "# Week\n");
  world.brain.write("maps/other.md", "# Other\n");
  assert.equal(agentHook(world), 0);
  const files = world.remoteFiles();
  for (const rel of ["maps/LINKS.md", "reports/curator/week.md"]) assert.ok(files.includes(rel), rel);
  assert.ok(!files.includes("maps/other.md"));
});

test("the routes and entities files named in dummkopf.toml are committed, wherever they live", () => {
  const world = new Sandbox().synced();
  world.brain.configure('[context]\nroutes_file = "hub-routes.json"\n[links]\nentities_file = "scripts/entities.txt"\n');
  world.brain.git(["commit", "-qam", "config"]);
  world.brain.write("hub-routes.json", '{"routes": []}\n');
  world.brain.write("scripts/entities.txt", "Docker\n");
  assert.equal(agentHook(world), 0);
  assert.ok(world.remoteFiles().includes("hub-routes.json"));
  assert.ok(world.remoteFiles().includes("scripts/entities.txt"));
});

test("sync follows the same rule as the hook", () => {
  const world = new Sandbox().synced();
  changeConfig(world);
  world.brain.write("notes/by-hand.md", fullNote({ title: "By hand" }));
  assert.equal(world.brain.run(["sync"]).code, 0);
  assert.ok(world.remoteFiles().includes("notes/by-hand.md"));
  assert.equal(world.brain.git(["status", "--porcelain"]), "M dummkopf.toml");
});

test("sync_exclude still keeps paths inside the note folders out", () => {
  const world = new Sandbox().synced();
  world.brain.repoOption('sync_exclude = ["notes/drafts/"]');
  world.brain.write("notes/drafts/wip.md", fullNote({ title: "Wip" }));
  world.brain.write("notes/done.md", fullNote({ title: "Done" }));
  assert.equal(world.brain.run(["sync"]).code, 0);
  const files = world.remoteFiles();
  assert.ok(files.includes("notes/done.md"));
  assert.ok(!files.includes("notes/drafts/wip.md"));
});

test("a changed dummkopf.toml does not block a write", () => {
  const world = new Sandbox().synced();
  changeConfig(world);
  const result = world.brain.run(["write", "notes/fresh.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.ok(world.remoteFiles().includes("notes/fresh.md"));
  assert.equal(world.brain.git(["status", "--porcelain"]), "M dummkopf.toml");
});

test("a changed note outside dummkopf's own write still blocks a write", () => {
  const world = new Sandbox().synced();
  world.brain.write("notes/by-hand.md", md());
  const result = world.brain.run(["write", "notes/fresh.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 2);
  assert.equal(result.err, "The brain has uncommitted note changes. Run `dummkopf sync` first.\n");
});

// --- --message --------------------------------------------------------------------------------------------------

test("write --message commits with that subject", () => {
  const world = new Sandbox().synced();
  const result = world.brain.run(["write", "notes/fresh.md", "--expected", "new", "--message", "Add fresh note"],
    { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.equal(world.remoteLog()[0], "Add fresh note");
});

test("ingest --message commits with that subject", () => {
  const world = new Sandbox().synced();
  const result = ingest(world.brain, [newEntry("notes/one.md"), newEntry("notes/two.md")],
    ["--message", "Import two notes"]);
  assert.equal(result.code, 0, result.err);
  assert.equal(world.remoteLog()[0], "Import two notes");
});

test("without --message a write uses repo.commit_message", () => {
  const world = new Sandbox().synced();
  world.brain.repoOption('commit_message = "Brain update"');
  world.brain.run(["write", "notes/fresh.md", "--expected", "new"], { stdin: md() });
  assert.equal(world.remoteLog()[0], "Brain update");
});

test("--message works in a local brain", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.brain("local");
  brain.toml = "schema_version = 1\n";
  fs.writeFileSync(path.join(brain.root, "dummkopf.toml"), brain.toml, "utf-8");
  brain.gitInit();
  brain.commit("Initial");
  const result = brain.run(["write", "notes/fresh.md", "--expected", "new", "--message", "Local note"],
    { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.equal(brain.git(["log", "--format=%s", "-1"]), "Local note");
});

const BAD_MESSAGES: [string, string][] = [
  ["an empty message", ""],
  ["a blank message", "   "],
  ["a message with a newline", "Subject\n\nbody with secret-token"],
  ["a message with a carriage return", "Subject\rsecret-token"],
  ["a message over 200 characters", "x".repeat(201)],
];

for (const [name, message] of BAD_MESSAGES) {
  test("write rejects " + name + " with exit 2 and saves nothing", () => {
    const world = new Sandbox().synced();
    const result = world.brain.run(["write", "notes/fresh.md", "--expected", "new", "--message", message],
      { stdin: md() });
    assert.equal(result.code, 2);
    assert.equal(result.err, "--message needs one line of 1 to 200 characters.\n");
    assert.ok(!result.err.includes("secret-token"));
    assert.ok(!world.brain.exists("notes/fresh.md"));
    assert.deepEqual(world.remoteLog(), ["Initial"]);
  });
}

test("ingest rejects a message with a newline", () => {
  const world = new Sandbox().synced();
  const result = ingest(world.brain, [newEntry("notes/one.md")], ["--message", "One\nTwo"]);
  assert.equal(result.code, 2);
  assert.ok(!world.brain.exists("notes/one.md"));
});

test("a message of exactly 200 characters is fine", () => {
  const world = new Sandbox().synced();
  const message = "y".repeat(200);
  const result = world.brain.run(["write", "notes/fresh.md", "--expected", "new", "--message", message],
    { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.equal(world.remoteLog()[0], message);
});
