/** Hooks: `hook agent` for Claude Code and Codex, `hook pre-commit`, and the installed Git hook in use. */

import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { binary, type Brain, command, type Env, fullNote, md, NO_FILE_MODES, type Result, Sandbox, type Synced } from "./harness.ts";

const FILLER = "---\nupdated: 2026-10-01\nstatus: active\nkey_fact: K.\nsummary: K.\naliases: []\nperiod: []\n"
  + "entities: []\n---\n";

function agent(sandbox: Sandbox, root: string, event: unknown,
  { cwd, raw }: { cwd?: string; raw?: string } = {}): Result {
  const stdin = raw ?? JSON.stringify(event);
  return sandbox.run(["hook", "agent", "--root", root], { cwd: cwd ?? root, stdin });
}

function toolEvent(tool: string, cwd: string, toolInput: Record<string, string> = {}): Record<string, unknown> {
  return { hook_event_name: "PostToolUse", tool_name: tool, cwd, tool_input: toolInput };
}

/** A brain with an uncommitted note, so a sync is visible on the remote. */
function pending(): Synced {
  const synced = new Sandbox().synced();
  synced.brain.write("notes/pending.md", fullNote({ title: "Pending" }));
  return synced;
}

function syncedToRemote(synced: Synced): boolean {
  return synced.remoteFiles().includes("notes/pending.md");
}

// --- hook agent: never exit 2 ------------------------------------------------------------------------------------

for (const raw of ["", "not json", "[]", "5", "null", '"text"', "{}", '{"tool_name": 5}',
  '{"tool_name": "Bash", "cwd": 5}', '{"hook_event_name": "SessionEnd", "cwd": []}']) {
  test("unusable event " + JSON.stringify(raw) + " exits 0 without output", () => {
    const p = pending();
    const result = agent(p.sandbox, p.brain.root, null, { raw });
    assert.deepEqual([result.code, result.out, result.err], [0, "", ""]);
    assert.ok(!syncedToRemote(p));
  });
}

test("hook outside a brain exits 0", () => {
  const sandbox = new Sandbox();
  const result = sandbox.run(["hook", "agent"], { cwd: sandbox.tmp, stdin: JSON.stringify(toolEvent("Bash", sandbox.tmp)) });
  assert.deepEqual([result.code, result.out, result.err], [0, "", ""]);
});

test("hook with a broken config exits 0", () => {
  const brain = new Sandbox().brain();
  fs.writeFileSync(path.join(brain.root, "rcllr.toml"), "[repo\n", "utf-8");
  const result = agent(brain.sandbox, brain.root, toolEvent("Bash", brain.root));
  assert.deepEqual([result.code, result.err], [0, ""]);
});

test("unwatched tool does not sync", () => {
  const p = pending();
  const result = agent(p.sandbox, p.brain.root, toolEvent("Read", p.brain.root));
  assert.equal(result.code, 0);
  assert.ok(!syncedToRemote(p));
});

test("event from outside the brain does not sync", () => {
  const p = pending();
  const tmp = p.sandbox.tmp;
  const result = agent(p.sandbox, p.brain.root, toolEvent("Bash", path.join(tmp, "elsewhere")), { cwd: tmp });
  assert.equal(result.code, 0);
  assert.ok(!syncedToRemote(p));
});

// --- hook agent: syncing -----------------------------------------------------------------------------------------

test("Bash event in the brain commits and pushes", () => {
  const p = pending();
  const result = agent(p.sandbox, p.brain.root, toolEvent("Bash", p.brain.root, { command: "echo" }));
  assert.deepEqual([result.code, result.out, result.err], [0, "", ""]);
  assert.ok(syncedToRemote(p));
  assert.equal(p.remoteLog()[0], "Update notes");
});

test("event from a nested folder of the brain syncs", () => {
  const p = pending();
  const nested = path.join(p.brain.root, "notes");
  assert.equal(agent(p.sandbox, p.brain.root, toolEvent("Bash", nested)).code, 0);
  assert.ok(syncedToRemote(p));
});

for (const tool of ["Bash", "Write", "Edit", "MultiEdit", "apply_patch", "exec_command"]) {
  test("watched tool " + tool + " syncs when run in the brain", () => {
    const p = pending();
    assert.equal(agent(p.sandbox, p.brain.root, toolEvent(tool, p.brain.root)).code, 0);
    assert.ok(syncedToRemote(p));
  });
}

for (const tool of ["Write", "Edit", "MultiEdit"]) {
  test("file tool " + tool + " on a brain file syncs even from another folder", () => {
    const p = pending();
    const tmp = p.sandbox.tmp;
    const edited = path.join(p.brain.root, "notes", "pending.md");
    const event = toolEvent(tool, tmp, { file_path: edited });
    assert.equal(agent(p.sandbox, p.brain.root, event, { cwd: tmp }).code, 0);
    assert.ok(syncedToRemote(p));
  });
}

test("Bash event with a file path outside the brain does not sync", () => {
  const p = pending();
  const tmp = p.sandbox.tmp;
  const event = toolEvent("Bash", tmp, { file_path: path.join(p.brain.root, "notes", "pending.md") });
  assert.equal(agent(p.sandbox, p.brain.root, event, { cwd: tmp }).code, 0);
  assert.ok(!syncedToRemote(p));
});

test("SessionEnd in the brain syncs", () => {
  const p = pending();
  const event = { hook_event_name: "SessionEnd", cwd: p.brain.root };
  assert.equal(agent(p.sandbox, p.brain.root, event).code, 0);
  assert.ok(syncedToRemote(p));
});

test("SessionEnd outside the brain does not sync", () => {
  const p = pending();
  const tmp = p.sandbox.tmp;
  const event = { hook_event_name: "SessionEnd", cwd: tmp };
  assert.equal(agent(p.sandbox, p.brain.root, event, { cwd: tmp }).code, 0);
  assert.ok(!syncedToRemote(p));
});

test("agent hook uses the working folder when the event has no cwd", () => {
  const p = pending();
  const event = { hook_event_name: "PostToolUse", tool_name: "Bash" };
  assert.equal(agent(p.sandbox, p.brain.root, event).code, 0);
  assert.ok(syncedToRemote(p));
});

// --- hook agent: failures exit 1, never 2 -----------------------------------------------------------------------

test("failed push exits 1 with a message", () => {
  const p = pending();
  const hook = path.join(p.remote, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", "utf-8");
  fs.chmodSync(hook, 0o755);
  const result = agent(p.sandbox, p.brain.root, toolEvent("Bash", p.brain.root));
  assert.equal(result.code, 1);
  assert.equal(result.err, "rcllr sync failed: Git step failed: push. Local data is kept.\n");
});

test("rejected sync state exits 1, not 2", () => {
  const p = pending();
  p.brain.git(["checkout", "-q", "-b", "other"]);
  const result = agent(p.sandbox, p.brain.root, toolEvent("Bash", p.brain.root));
  assert.equal(result.code, 1);
  assert.equal(result.err, "rcllr sync failed: Sync needs branch main.\n");
});

// --- hook pre-commit ---------------------------------------------------------------------------------------------

test("pre-commit outside a brain exits 0 silently", () => {
  const sandbox = new Sandbox();
  const result = sandbox.run(["hook", "pre-commit"], { cwd: sandbox.tmp });
  assert.deepEqual([result.code, result.out, result.err], [0, "", ""]);
});

test("pre-commit without an index file does nothing", () => {
  const brain = new Sandbox().brain();
  brain.write("notes/secret.md", md({ body: "> SENSITIVE" }));
  const result = brain.run(["hook", "pre-commit"]);
  assert.deepEqual([result.code, result.out], [0, ""]);
  assert.ok(!brain.read(".sensitive-paths").includes("secret.md"));
});

/** A Git brain with an INDEX.md. */
function indexed(): Brain {
  const brain = new Sandbox().brain();
  brain.gitInit();
  brain.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n");
  return brain;
}

/** Python's str.splitlines() for LF text: no empty last line. */
function splitlines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

test("pre-commit regenerates the sensitive paths list", () => {
  const b = indexed();
  b.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n");
  const result = b.run(["hook", "pre-commit"]);
  assert.equal(result.code, 0);
  assert.ok(result.out.startsWith(".sensitive-paths updated.\n"));
  assert.equal(splitlines(b.read(".sensitive-paths")).at(-1), "notes/secret.md");
  if (!NO_FILE_MODES) assert.equal(b.mode(".sensitive-paths"), 0o600);
});

test("pre-commit lists a whole folder when its README has the marker", () => {
  const b = indexed();
  b.write("topics/med/README.md", FILLER + "\n# Med\n\n> SENSITIVE\n");
  b.write("topics/med/visit.md", FILLER + "\n# Visit\n");
  b.run(["hook", "pre-commit"]);
  assert.equal(splitlines(b.read(".sensitive-paths")).at(-1), "topics/med/");
});

test("pre-commit lists sensitive always paths", () => {
  const b = indexed();
  b.configure('[sensitive]\nalways = ["topics/health/"]\n');
  b.run(["hook", "pre-commit"]);
  assert.ok(splitlines(b.read(".sensitive-paths")).includes("topics/health/"));
});

test("pre-commit second run prints no paths update", () => {
  const b = indexed();
  b.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n");
  b.run(["hook", "pre-commit"]);
  assert.ok(!b.run(["hook", "pre-commit"]).out.includes(".sensitive-paths updated."));
});

test("pre-commit rebuilds the index tables", () => {
  const b = indexed();
  b.write("notes/visible.md", FILLER + "\n# Visible\n");
  b.write("notes/secret.md", FILLER + "\n# Secret\n\n> SENSITIVE\n");
  b.run(["hook", "pre-commit"]);
  const index = b.read("INDEX.md");
  assert.ok(index.includes("| `notes/visible.md` | K. |  |"));
  assert.ok(!index.includes("secret.md"));
});

/** Today's date, so a note never turns stale while the suite ages. */
const TODAY = new Date().toISOString().slice(0, 10);
const FRESH = FILLER.replace("updated: 2026-10-01", "updated: " + TODAY);

test("pre-commit sums up findings in one line and exits 0", () => {
  const b = indexed();
  b.write("notes/todo.md", FRESH.replace("key_fact: K.", "key_fact: TODO") + "\n# Todo\n");
  b.write("notes/old.md", FILLER.replace("updated: 2026-10-01", "updated: 2020-01-01") + "\n# Old\n");
  b.write("notes/undated.md", FRESH.replace("updated: " + TODAY + "\n", "") + "\n# Undated\n");
  const result = b.run(["hook", "pre-commit"]);
  assert.equal(result.code, 0);
  const summary = result.out.split("\n").filter((line) => line.startsWith("Report:"));
  assert.deepEqual(summary, ["Report: 1 stale, 1 without date, 1 without key fact. "
    + "Run `rcllr meta report` for details."]);
  assert.ok(!result.out.includes("###"), result.out);
  assert.ok(!result.out.includes("notes/todo.md"), result.out);
});

test("pre-commit prints no report line without findings", () => {
  const b = indexed();
  b.write("notes/fine.md", FRESH + "\n# Fine\n");
  const result = b.run(["hook", "pre-commit"]);
  assert.equal(result.code, 0);
  assert.ok(!result.out.includes("Report"), result.out);
});

/** The report lines one pre-commit run prints. */
function reportLines(b: Brain): string[] {
  return b.run(["hook", "pre-commit"]).out.split("\n").filter((line) => line.startsWith("Report:"));
}

function addTodo(b: Brain, name: string): void {
  b.write("notes/" + name + ".md", FRESH.replace("key_fact: K.", "key_fact: TODO") + "\n# " + name + "\n");
}

const ONE_TODO = "Report: 0 stale, 0 without date, 1 without key fact. Run `rcllr meta report` for details.";

test("pre-commit prints the same counts only once", () => {
  const b = indexed();
  addTodo(b, "todo");
  assert.deepEqual(reportLines(b), [ONE_TODO]);
  assert.deepEqual(reportLines(b), []);
  assert.deepEqual(reportLines(b), []);
});

test("pre-commit prints the report again when a note turns stale", () => {
  const b = indexed();
  addTodo(b, "todo");
  reportLines(b);
  b.write("notes/old.md", FRESH.replace("updated: " + TODAY, "updated: 2020-01-01") + "\n# Old\n");
  assert.deepEqual(reportLines(b), ["Report: 1 stale, 0 without date, 1 without key fact. "
    + "Run `rcllr meta report` for details."]);
  assert.deepEqual(reportLines(b), []);
});

test("pre-commit prints the report again after the findings were gone", () => {
  const b = indexed();
  addTodo(b, "todo");
  reportLines(b);
  fs.unlinkSync(path.join(b.root, "notes", "todo.md"));
  assert.deepEqual(reportLines(b), []);
  addTodo(b, "todo");
  assert.deepEqual(reportLines(b), [ONE_TODO]);
});

test("pre-commit keeps the last counts in the Git folder, not in the working tree", () => {
  const b = indexed();
  addTodo(b, "todo");
  const before = b.git(["status", "--porcelain", "--untracked-files=all"]);
  reportLines(b);
  assert.ok(fs.existsSync(path.join(b.root, ".git", "rcllr-report")));
  const after = b.git(["status", "--porcelain", "--untracked-files=all"]).split("\n")
    .filter((line) => !line.endsWith(".sensitive-paths") && !line.endsWith("INDEX.md"));
  assert.deepEqual(after, before.split("\n").filter((line) => !line.endsWith(".sensitive-paths")
    && !line.endsWith("INDEX.md")));
});

test("pre-commit in a brain without Git still prints the report", () => {
  const b = new Sandbox().brain();
  b.write("INDEX.md", "# Index\n\n## Topics\n\n## Notes (flat)\n\n## Bookmarks\n");
  addTodo(b, "todo");
  const first = b.run(["hook", "pre-commit"]);
  assert.equal(first.code, 0);
  assert.ok(first.out.includes(ONE_TODO), first.out + first.err);
});

test("hooks.report always prints the report on every run", () => {
  const b = indexed();
  b.configure('[hooks]\nreport = "always"\n');
  addTodo(b, "todo");
  assert.deepEqual(reportLines(b), [ONE_TODO]);
  assert.deepEqual(reportLines(b), [ONE_TODO]);
});

test("hooks.report never prints no report", () => {
  const b = indexed();
  b.configure('[hooks]\nreport = "never"\n');
  addTodo(b, "todo");
  assert.deepEqual(reportLines(b), []);
  assert.ok(!fs.existsSync(path.join(b.root, ".git", "rcllr-report")));
});

test("an unknown hooks.report value is a config error", () => {
  const b = indexed();
  b.configure('[hooks]\nreport = "sometimes"\n');
  const result = b.run(["check"]);
  assert.equal(result.code, 2);
  assert.equal(result.err, "rcllr.toml: hooks.report: must be one of changes, always, never\n");
});

test("meta report keeps the full list", () => {
  const b = indexed();
  b.write("notes/todo.md", FRESH.replace("key_fact: K.", "key_fact: TODO") + "\n# Todo\n");
  const out = b.run(["meta", "report"]).out;
  assert.ok(out.includes("### No key fact (`TODO`) (1)"), out);
  assert.ok(out.includes("- `notes/todo.md`"), out);
});

// --- the installed Git hook, through a real commit ------------------------------------------------------------

/** A brain made by `init` with `install` run, the `hooked` fixture. */
function hooked(): { sandbox: Sandbox; root: string } {
  const sandbox = new Sandbox();
  const root = path.join(sandbox.tmp, "hooked");
  assert.equal(sandbox.run(["init", root, "--serious", "--remote", path.join(sandbox.tmp, "r.git")],
    { cwd: sandbox.tmp }).code, 0);
  assert.equal(sandbox.run(["install", "--serious"], { cwd: root }).code, 0);
  return { sandbox, root };
}

function commit(sandbox: Sandbox, root: string, env?: Env): SpawnSyncReturns<string> {
  sandbox.git(root, ["add", "-A"]);
  return spawnSync("git", ["commit", "-m", "Save"], { cwd: root, encoding: "utf-8", env: env ?? sandbox.env });
}

/** shutil.which: the first executable of that name on PATH, or null. */
function which(name: string): string | null {
  for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(folder, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

test("commit runs the hook and includes the regenerated paths list", () => {
  const { sandbox, root } = hooked();
  fs.writeFileSync(path.join(root, "notes", "secret.md"), FILLER + "\n# Secret\n\n> SENSITIVE\n", "utf-8");
  const done = commit(sandbox, root);
  assert.equal(done.status, 0);
  assert.ok(splitlines(sandbox.git(root, ["show", "HEAD:.sensitive-paths"])).includes("notes/secret.md"), done.stderr);
  assert.equal(sandbox.git(root, ["status", "--porcelain"]), "");
});

test("commit includes the rebuilt index", () => {
  const { sandbox, root } = hooked();
  fs.writeFileSync(path.join(root, "notes", "visible.md"), FILLER + "\n# Visible\n", "utf-8");
  const done = commit(sandbox, root);
  assert.equal(done.status, 0);
  assert.ok(sandbox.git(root, ["show", "HEAD:INDEX.md"]).includes("`notes/visible.md`"), done.stderr);
});

test("commit completes the frontmatter of a staged note", () => {
  const { sandbox, root } = hooked();
  fs.writeFileSync(path.join(root, "notes", "bare.md"), "# Bare\n\nno frontmatter\n", "utf-8");
  const done = commit(sandbox, root);
  assert.equal(done.status, 0);
  const committed = sandbox.git(root, ["show", "HEAD:notes/bare.md"]);
  assert.ok(committed.startsWith("---\nupdated: "), done.stderr);
  assert.ok(committed.includes("status: active"));
  assert.ok(committed.endsWith("# Bare\n\nno frontmatter"));
});

test("commit still succeeds when rcllr is not on the PATH", {
  skip: process.platform === "win32" && "builds a POSIX PATH that holds only a symlink to git",
}, () => {
  const { sandbox, root } = hooked();
  // Only git, never a rcllr that happens to share git's folder (Homebrew puts both in /opt/homebrew/bin).
  const gitOnly = path.join(sandbox.tmp, "git-only");
  fs.mkdirSync(gitOnly);
  fs.symlinkSync(which("git") ?? "/usr/bin/git", path.join(gitOnly, "git"));
  const env = { ...sandbox.env, PATH: gitOnly + ":/bin" };
  fs.writeFileSync(path.join(root, "notes", "visible.md"), FILLER + "\n# Visible\n", "utf-8");
  const result = commit(sandbox, root, env);
  assert.equal(result.status, 0);
  // The hook also looks in the usual install folders; where rcllr really lives there, it is found on purpose.
  if (!["/opt/homebrew/bin/rcllr", "/usr/local/bin/rcllr"].some((file) => fs.existsSync(file))) {
    assert.ok(result.stderr.includes("rcllr not found on PATH; indexes not updated."));
    assert.ok(!sandbox.git(root, ["show", "HEAD:INDEX.md"]).includes("`notes/visible.md`"));
  }
});

/** One agent hook as its own process, so several can run at the same time like parallel sessions. */
function agentProcess(synced: Synced, event: unknown, root = synced.brain.root): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const [program, argv] = command(binary(), ["hook", "agent", "--root", root]);
    const child = spawn(program, argv, { cwd: root, env: synced.sandbox.env });
    let err = "";
    child.stderr.on("data", (chunk) => { err += String(chunk); });
    child.on("close", (code) => resolve({ code, err }));
    child.stdin.end(JSON.stringify(event));
  });
}

test("parallel sessions in one brain sync every note exactly once", async () => {
  const synced = new Sandbox().synced();
  const names = ["one", "two", "three", "four"];
  for (const name of names) synced.brain.write("notes/" + name + ".md", fullNote({ title: name }));
  const done = await Promise.all(names.map(() => agentProcess(synced, toolEvent("Write", synced.brain.root))));
  assert.deepEqual(done, names.map(() => ({ code: 0, err: "" })));
  assert.equal(synced.brain.git(["status", "--porcelain"]), "");
  const files = synced.remoteFiles();
  for (const name of names) assert.ok(files.includes("notes/" + name + ".md"), name);
  assert.equal(synced.remoteLog().length, 2);
});

test("two machines syncing at the same time both push without an error", async () => {
  const synced = new Sandbox().synced();
  const other = path.join(synced.base, "machine-b");
  synced.sandbox.git(synced.base, ["clone", "-q", "-b", "main", synced.remote, other]);
  for (let round = 0; round < 5; round++) {
    synced.brain.write("notes/a" + round + ".md", fullNote({ title: "A" + round }));
    fs.writeFileSync(path.join(other, "notes", "b" + round + ".md"), fullNote({ title: "B" + round }), "utf-8");
    const done = await Promise.all([
      agentProcess(synced, toolEvent("Write", synced.brain.root)),
      agentProcess(synced, toolEvent("Write", other), other),
    ]);
    assert.deepEqual(done, [{ code: 0, err: "" }, { code: 0, err: "" }], "round " + round);
  }
  const files = synced.remoteFiles();
  for (let round = 0; round < 5; round++) {
    assert.ok(files.includes("notes/a" + round + ".md") && files.includes("notes/b" + round + ".md"), "round " + round);
  }
});
