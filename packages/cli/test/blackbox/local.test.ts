/** A local brain: no `repo.remote`. dummkopf commits, but never fetches, pushes or checks a remote. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { type Brain, fullNote, lines, md, Sandbox } from "./harness.ts";

/** A Git brain whose dummkopf.toml has no remote. */
function localBrain(sandbox = new Sandbox(), extra = ""): Brain {
  const brain = sandbox.brain("local");
  brain.toml = "schema_version = 1\n" + extra;
  fs.writeFileSync(path.join(brain.root, "dummkopf.toml"), brain.toml, "utf-8");
  brain.gitInit();
  brain.write("notes/first.md", fullNote({ title: "First" }));
  brain.commit("Initial");
  return brain;
}

/** A bare repository the brain could push to, plus its commit subjects. */
function bareRemote(brain: Brain): { url: string; log: () => string[] } {
  const url = path.join(brain.sandbox.tmp, "remote.git");
  brain.sandbox.git(brain.sandbox.tmp, ["init", "-q", "--bare", "-b", "main", url]);
  const log = (): string[] => lines(brain.sandbox.git(url, ["log", "--format=%s", "--all"], false));
  return { url, log };
}

test("init without --remote creates a local brain without a remote line", () => {
  const sandbox = new Sandbox();
  const result = sandbox.run(["init", "brain", "--serious"]);
  assert.equal(result.code, 0, result.err);
  assert.ok(result.out.endsWith("It stays local: dummkopf commits, but never pushes. Next: `dummkopf install`.\n"));
  const root = path.join(sandbox.tmp, "brain");
  const toml = fs.readFileSync(path.join(root, "dummkopf.toml"), "utf-8");
  assert.ok(!/^remote\s*=/m.test(toml), toml);
  assert.ok(toml.includes("# No remote: this brain stays on this machine."));
  assert.equal(sandbox.git(root, ["remote"]), "");
});

test("the AGENTS.md of a local brain says nothing is pushed", () => {
  const sandbox = new Sandbox();
  sandbox.run(["init", "brain", "--serious"]);
  const agents = fs.readFileSync(path.join(sandbox.tmp, "brain", "AGENTS.md"), "utf-8");
  assert.ok(agents.includes("This brain is local: it has no remote, and nothing leaves this machine."));
  assert.ok(!agents.includes("fetches and rebases onto the remote"));
});

test("a brain created with --remote keeps the remote rules in AGENTS.md", () => {
  const sandbox = new Sandbox();
  sandbox.run(["init", "brain", "--remote", "git@example.org:me/brain.git", "--serious"]);
  const agents = fs.readFileSync(path.join(sandbox.tmp, "brain", "AGENTS.md"), "utf-8");
  assert.ok(agents.includes("Before changes dummkopf fetches and rebases onto the remote."));
  assert.ok(!agents.includes("This brain is local"));
});

test("a config with only schema_version is valid and local", () => {
  const brain = localBrain();
  const result = brain.run(["check"]);
  assert.equal(result.code, 0, result.err);
});

test("an empty remote counts as local", () => {
  const brain = localBrain(new Sandbox(), '[repo]\nremote = ""\n');
  const result = brain.run(["write", "notes/a.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.equal(brain.git(["log", "-1", "--format=%s"]), "Update notes");
});

test("write in a local brain commits and reports sync ok", () => {
  const brain = localBrain();
  const result = brain.run(["write", "notes/a.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 0, result.err);
  assert.ok(result.out.startsWith("Write status: saved; sync: ok\n"));
  assert.equal(brain.git(["status", "--porcelain"]), "");
  assert.deepEqual(lines(brain.git(["log", "--format=%s"])), ["Update notes", "Initial"]);
});

test("a local brain never pushes, even when the Git repository has a remote", () => {
  const brain = localBrain();
  const remote = bareRemote(brain);
  brain.git(["remote", "add", "origin", remote.url]);
  assert.equal(brain.run(["write", "notes/a.md", "--expected", "new"], { stdin: md() }).code, 0);
  assert.equal(brain.run(["sync"]).code, 0);
  assert.deepEqual(remote.log(), []);
});

test("a local brain never fetches: a remote that does not exist does not matter", () => {
  const brain = localBrain();
  brain.git(["remote", "add", "origin", path.join(brain.sandbox.tmp, "missing.git")]);
  const result = brain.run(["write", "notes/a.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 0, result.err);
});

test("sync in a local brain commits open note changes", () => {
  const brain = localBrain();
  brain.write("notes/b.md", fullNote({ title: "B" }));
  const result = brain.run(["sync"]);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "Synced.\n");
  assert.equal(brain.git(["status", "--porcelain"]), "");
});

test("the agent hook commits in a local brain", () => {
  const brain = localBrain();
  brain.write("notes/c.md", fullNote({ title: "C" }));
  const event = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: brain.root,
    tool_input: { file_path: path.join(brain.root, "notes/c.md") } });
  const result = brain.sandbox.run(["--root", brain.root, "hook", "agent"], { cwd: brain.root, stdin: event });
  assert.equal(result.code, 0, result.err);
  assert.equal(brain.git(["status", "--porcelain"]), "");
});

test("a brain with a remote still refuses a different Git remote", () => {
  const sandbox = new Sandbox();
  const brain = sandbox.brain("other", "", "git@example.org:me/brain.git");
  brain.gitInit();
  brain.git(["remote", "add", "origin", "git@example.org:someone/else.git"]);
  brain.commit("Initial");
  const result = brain.run(["write", "notes/a.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("Remote origin does not match repo.remote"), result.err);
});
