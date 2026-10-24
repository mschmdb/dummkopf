/** Configuration: where the brain is found and which rcllr.toml files are rejected. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { BASE_TOML, Sandbox, note } from "./harness.ts";
import type { Brain, Result } from "./harness.ts";

function filled(): Brain {
  const target = new Sandbox().brain();
  target.write("notes/alpha.md", note({ title: "Alpha", body: "needle" }));
  return target;
}

function folder(sandbox: Sandbox, ...parts: string[]): string {
  const target = path.join(sandbox.tmp, ...parts);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

test("missing config exits 2 and names init", () => {
  const sandbox = new Sandbox();
  const result = sandbox.run(["find", "needle", "--serious"], { cwd: folder(sandbox, "empty") });
  assert.equal(result.code, 2);
  assert.equal(result.out, "");
  assert.ok(result.err.includes("No rcllr.toml found in"), result.err);
  assert.ok(result.err.includes("`rcllr init`"), result.err);
  assert.ok(result.err.includes("--root"), result.err);
});

test("missing config names the searched folder", () => {
  const sandbox = new Sandbox();
  assert.ok(sandbox.run(["find", "needle", "--serious"], { cwd: folder(sandbox, "empty") }).err.includes("empty"));
});

test("root option selects the brain", () => {
  const target = filled();
  const elsewhere = folder(target.sandbox, "elsewhere");
  const result = target.sandbox.run(["find", "needle", "--serious", "--root", target.root], { cwd: elsewhere });
  assert.equal(result.code, 0);
  assert.ok(result.out.startsWith("notes/alpha.md | rev="), result.out);
});

test("root option works after the subcommand and before it", () => {
  const target = filled();
  const { sandbox } = target;
  const before = sandbox.run(["--root", target.root, "--serious", "find", "needle"], { cwd: sandbox.tmp });
  const after = sandbox.run(["find", "needle", "--serious", "--root", target.root], { cwd: sandbox.tmp });
  assert.equal(before.code, 0);
  assert.equal(after.code, 0);
  assert.equal(before.out, after.out);
});

test("root environment variable selects the brain", () => {
  const target = filled();
  const result = target.sandbox.run(["find", "needle", "--serious"],
    { cwd: target.sandbox.tmp, env: { RCLLR_ROOT: target.root } });
  assert.equal(result.code, 0);
  assert.ok(result.out.includes("notes/alpha.md"), result.out);
});

test("root option beats the environment variable", () => {
  const target = filled();
  const empty = folder(target.sandbox, "empty");
  const result = target.sandbox.run(["find", "needle", "--serious", "--root", empty],
    { cwd: target.root, env: { RCLLR_ROOT: target.root } });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("No rcllr.toml found"), result.err);
});

test("root environment variable beats the working folder", () => {
  const target = filled();
  const other = target.sandbox.brain("other");
  other.write("notes/beta.md", note({ title: "Beta", body: "needle" }));
  const result = target.sandbox.run(["find", "needle", "--serious"],
    { cwd: target.root, env: { RCLLR_ROOT: other.root } });
  assert.ok(result.out.includes("notes/beta.md"), result.out);
  assert.ok(!result.out.includes("notes/alpha.md"), result.out);
});

test("brain is found from a nested folder", () => {
  const target = filled();
  const nested = path.join(target.root, "sub", "deeper");
  fs.mkdirSync(nested, { recursive: true });
  const result = target.sandbox.run(["find", "needle", "--serious"], { cwd: nested });
  assert.equal(result.code, 0);
  assert.ok(result.out.includes("notes/alpha.md"), result.out);
});

test("root without config exits 2", () => {
  const target = filled();
  const result = target.sandbox.run(["find", "needle", "--serious", "--root", path.join(target.sandbox.tmp, "nonexistent")],
    { cwd: target.root });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("No rcllr.toml found"), result.err);
});

function findWith(toml: string): Result {
  const target = filled();
  fs.writeFileSync(path.join(target.root, "rcllr.toml"), toml, "utf-8");
  return target.sandbox.run(["find", "needle", "--serious"], { cwd: target.root });
}

for (const [toml, named] of [
  [BASE_TOML("x") + "[repo2]\nx = 1\n", "repo2"],
  [BASE_TOML("x") + "[ui]\ntonee = 1\n", "ui.tonee"],
  [BASE_TOML("x").replace("remote = 'x'", "remote = 'x'\nbranchh = \"m\""), "repo.branchh"],
  [BASE_TOML("x") + "[search.weights]\ntitel = 1\n", "search.weights.titel"],
] as const) {
  test("unknown key is rejected and named: " + named, () => {
    const result = findWith(toml);
    assert.equal(result.code, 2);
    assert.equal(result.err, "rcllr.toml: " + named + ": unknown key\n");
  });
}

for (const [label, toml, message] of [
  ["missing schema_version", '[repo]\nremote = "x"\n', "rcllr.toml: schema_version: is required"],
  ["schema_version 2", 'schema_version = 2\n[repo]\nremote = "x"\n', "rcllr.toml: schema_version: unsupported version"],
  // A missing or empty remote is valid now: it makes a local brain (local.test.ts).
  ["repo not a table", 'schema_version = 1\nrepo = "x"\n', "rcllr.toml: repo: must be a table"],
  ["unknown tone", 'schema_version = 1\n[repo]\nremote = "x"\n[ui]\ntone = "loud"\n',
    "rcllr.toml: ui.tone: must be one of cheeky, plain"],
  ["negative max_chars", 'schema_version = 1\n[repo]\nremote = "x"\n[limits]\nmax_chars = -1\n',
    "rcllr.toml: limits.max_chars: must not be negative"],
  ["max_chars below 500", 'schema_version = 1\n[repo]\nremote = "x"\n[limits]\nmax_chars = 100\n',
    "rcllr.toml: limits.max_chars: must be at least 500"],
  ["string auto_push", 'schema_version = 1\n[repo]\nremote = "x"\nauto_push = "yes"\n',
    "rcllr.toml: repo.auto_push: must be true or false"],
] as const) {
  test("invalid config value exits 2 and names the key: " + label, () => {
    const result = findWith(toml);
    assert.equal(result.code, 2);
    assert.ok(result.err.startsWith(message), result.err);
  });
}

test("broken TOML exits 2 with a readable message", () => {
  const result = findWith("schema_version = 1\n[repo\n");
  assert.equal(result.code, 2);
  assert.ok(result.err.startsWith("rcllr.toml is not readable:"), result.err);
});

test("renamed scopes need matching link barriers", () => {
  const target = filled();
  target.configure('[scopes]\nvalues = ["a", "b"]\n');
  const result = target.sandbox.run(["find", "needle", "--serious"], { cwd: target.root });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("scopes.link_barriers"), result.err);
  assert.ok(result.err.includes("work>private"), result.err);
});

test("config symlink is not followed", () => {
  const target = filled();
  const real = path.join(target.sandbox.tmp, "real.toml");
  fs.writeFileSync(real, target.toml, "utf-8");
  fs.unlinkSync(path.join(target.root, "rcllr.toml"));
  fs.symlinkSync(real, path.join(target.root, "rcllr.toml"));
  const result = target.sandbox.run(["find", "needle", "--serious"], { cwd: target.root });
  assert.equal(result.code, 2);
  assert.ok(result.err.includes("must not be a symlink"), result.err);
});

test("default limits apply without a limits section", () => {
  const target = filled();
  const result = target.sandbox.run(["find", "needle", "--serious", "--max-chars", "20001"], { cwd: target.root });
  assert.equal(result.code, 2);
  assert.equal(result.err, "--max-chars must be between 500 and 20000.\n");
});

test("config without optional sections is valid", () => {
  const sandbox = new Sandbox();
  const minimal = sandbox.brain("minimal");
  minimal.write("notes/x.md", note({ title: "X", body: "needle" }));
  assert.equal(sandbox.run(["find", "needle", "--serious"], { cwd: minimal.root }).code, 0);
});
