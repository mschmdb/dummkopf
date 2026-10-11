/** Tone: cheeky and plain messages carry the same instruction; JSON and note text never change. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Sandbox, md, note } from "./harness.ts";
import type { Brain, Synced } from "./harness.ts";

const DENIED_PLAIN = "Path unavailable or access excluded.";

function filled(): Brain {
  const target = new Sandbox().brain();
  target.write("notes/alpha.md", note({ title: "Alpha", body: "needle" }));
  return target;
}

function synced(): Synced {
  return new Sandbox().synced();
}

// --- the three messages named in the README ---------------------------------------------------------------------

test("denied path is cheeky by default", () => {
  const result = filled().cheeky(["read", "notes/absent.md"]);
  assert.deepEqual([result.code, result.out], [2, ""]);
  assert.equal(result.err, "Dummkopf! " + DENIED_PLAIN + "\n");
});

test("denied path is plain with --serious", () => {
  assert.equal(filled().run(["read", "notes/absent.md"]).err, DENIED_PLAIN + "\n");
});

test("hidden and missing paths stay identical in the cheeky tone", () => {
  const target = filled();
  target.write("notes/marked.md", note({ title: "Marked", body: "> SENSITIVE" }));
  assert.deepEqual(target.cheeky(["read", "notes/marked.md"]), target.cheeky(["read", "notes/absent.md"]));
});

test("no results is cheeky by default", () => {
  const result = filled().cheeky(["find", "zzz"]);
  assert.equal(result.code, 0);
  assert.equal(result.out, "Nothing found in released sources. "
    + "Even a Dummkopf knows when it doesn't know.\nNot found: zzz\n");
});

test("no results is plain with --serious", () => {
  assert.equal(filled().run(["find", "zzz"]).out, "Nothing found in released sources.\nNot found: zzz\n");
});

test("sync says 'Brain synced.' when cheeky and 'Synced.' when plain", () => {
  const world = synced();
  assert.equal(world.brain.cheeky(["sync"]).out, "Brain synced.\n");
  assert.equal(world.brain.run(["sync"]).out, "Synced.\n");
});

// --- config and flag -------------------------------------------------------------------------------------------

test("tone plain in the config is the default", () => {
  const target = filled();
  target.configure('[ui]\ntone = "plain"\n');
  assert.equal(target.cheeky(["read", "notes/absent.md"]).err, DENIED_PLAIN + "\n");
  assert.ok(target.cheeky(["find", "zzz"]).out.startsWith("Nothing found in released sources.\n"));
});

test("--serious beats tone cheeky in the config", () => {
  const target = filled();
  target.configure('[ui]\ntone = "cheeky"\n');
  assert.equal(target.cheeky(["read", "notes/absent.md", "--serious"]).err, DENIED_PLAIN + "\n");
});

test("--serious works before the subcommand", () => {
  assert.equal(filled().cheeky(["--serious", "read", "notes/absent.md"]).err, DENIED_PLAIN + "\n");
});

test("missing config message is cheeky by default", () => {
  const sandbox = new Sandbox();
  const cheeky = sandbox.run(["find", "x"], { cwd: sandbox.tmp });
  const plain = sandbox.run(["find", "x", "--serious"], { cwd: sandbox.tmp });
  assert.ok(cheeky.err.startsWith("No brain here, Dummkopf. No dummkopf.toml found in "), cheeky.err);
  assert.ok(plain.err.startsWith("No dummkopf.toml found in "), plain.err);
  assert.ok(cheeky.err.endsWith(plain.err));
});

// --- the joke never hides the instruction ----------------------------------------------------------------------

test("cheeky version conflict keeps the current rev", () => {
  const { brain } = synced();
  const cheeky = brain.cheeky(["write", "notes/first.md", "--expected", "0123456789ab"], { stdin: md() });
  const plain = brain.run(["write", "notes/first.md", "--expected", "0123456789ab"], { stdin: md() });
  assert.equal(cheeky.code, 2);
  assert.equal(plain.code, 2);
  assert.equal(cheeky.err, "Someone else touched this note. Read it again, Dummkopf. " + plain.err);
  assert.ok(cheeky.err.includes("current rev="));
});

test("cheeky new sensitive note keeps the grant instruction", () => {
  const { brain } = synced();
  const content = md({ body: "> SENSITIVE" });
  const cheeky = brain.cheeky(["write", "notes/secret.md", "--expected", "new"], { stdin: content });
  const plain = brain.run(["write", "notes/secret.md", "--expected", "new"], { stdin: content });
  assert.equal(cheeky.err, "Dummkopf! " + plain.err);
  assert.ok(cheeky.err.includes("--allow-sensitive notes/secret.md"));
});

test("cheeky marker removal keeps the rule", () => {
  const { brain } = synced();
  brain.run(["write", "notes/secret.md", "--expected", "new", "--allow-sensitive", "notes/secret.md"],
    { stdin: md({ body: "> SENSITIVE\n\nbody" }) });
  const rev: string = JSON.parse(brain.run(["read", "notes/secret.md", "--allow-sensitive", "notes/secret.md",
    "--json"]).out).hits[0].revision;
  const args = ["write", "notes/secret.md", "--expected", rev, "--allow-sensitive", "notes/secret.md"];
  const cheeky = brain.cheeky(args, { stdin: md({ body: "no marker" }) });
  const plain = brain.run(args, { stdin: md({ body: "no marker" }) });
  assert.equal(plain.err, "A write package must not remove a sensitivity marker.\n");
  assert.equal(cheeky.err, "Dummkopf! " + plain.err);
});

for (const args of [["find", "docker", "--limit", "11"], ["read", "notes/alpha.md", "--start", "0"],
  ["find", "docker", "--scope", "nowhere"], ["find", ""], ["read", "notes/alpha.md", "--section", "nope"]]) {
  test("errors without a cheeky variant read the same in both tones: " + JSON.stringify(args), () => {
    const target = filled();
    const cheeky = target.cheeky(args);
    const plain = target.run(args);
    assert.equal(cheeky.code, 2);
    assert.equal(plain.code, 2);
    assert.equal(cheeky.err, plain.err);
  });
}

// --- what the tone never touches ---------------------------------------------------------------------------------

for (const args of [["find", "needle"], ["context", "needle"], ["read", "notes/alpha.md"], ["find", "needle", "--json"],
  ["check"], ["meta", "report"]]) {
  test("successful output is the same in both tones: " + args.join(" "), () => {
    const target = filled();
    assert.deepEqual(target.cheeky(args), target.run(args));
  });
}

test("JSON for empty results is the same in both tones", () => {
  const target = filled();
  const cheeky = target.cheeky(["find", "zzz", "--json"]);
  assert.deepEqual(cheeky, target.run(["find", "zzz", "--json"]));
  assert.deepEqual(JSON.parse(cheeky.out).hits, []);
});

test("exit codes do not depend on the tone", () => {
  const world = synced();
  const hook = path.join(world.remote, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", "utf-8");
  fs.chmodSync(hook, 0o755);
  const result = world.brain.cheeky(["write", "notes/fresh.md", "--expected", "new"], { stdin: md() });
  assert.equal(result.code, 3);
  assert.equal(result.out, "Write status: saved; sync: failed\nChanged: notes/fresh.md\n");
});
