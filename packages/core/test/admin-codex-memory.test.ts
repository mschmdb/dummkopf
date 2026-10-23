/** `rcllr import-memory` for Codex: rollout summaries, filtered by the folder each session ran in. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { Access } from "../src/access.ts";
import { importMemory, mirrorName } from "../src/memory.ts";
import { type Brain, brain, invoke, tempDir } from "./helpers.ts";

const ENABLED = '[scopes]\nvalues = ["private", "work", "memory-codex"]\n'
  + '[extras]\ncodex_memory = true\n[codex_memory]\nprojects = ["/Users/me/Sites/shop"]\n';

function summary(cwd: string, title: string, context: string, body = "## Task 1\n\nOutcome: done\n"): string {
  return "thread_id: 01a1\nupdated_at: 2026-10-20T11:38:11+00:00\nrollout_path: /x.jsonl\ncwd: " + cwd
    + "\ngit_branch: main\n\n# " + title + "\n\nRollout context: " + context + "\n\n" + body;
}

function codexHome(files: Record<string, string>): string {
  const home = tempDir();
  const folder = path.join(home, "memories", "rollout_summaries");
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
  return home;
}

function enabled(): Brain {
  const target = brain();
  target.toml = target.toml.replace(/^remote = .*\n/m, "");
  target.configure(ENABLED);
  target.gitInit();
  target.commit("Initial");
  return target;
}

function run(target: Brain, home: string) {
  return importMemory(new Access(target.config), { claudeHome: tempDir(), codexHome: home, dryRun: false, sync: true });
}

test("only summaries from a listed project, or a folder inside it, are imported, in their own scope", () => {
  const target = enabled();
  const home = codexHome({
    "2026-10-18-a.md": summary("/Users/me/Sites/shop", "Checkout bug", "The user fixed the cart total."),
    "2026-10-18-b.md": summary("/Users/me/Sites/shop/packages/api", "API timeout", "Raised the timeout."),
    "2026-10-19-c.md": summary("/Users/me/brain", "Heating subsidy", "Private family matter."),
    "2026-10-19-d.md": summary("/Users/me/Sites/shopping-list", "Groceries", "Not the shop project."),
  });
  const result = run(target, home);
  assert.deepEqual(result.changed, ["topics/codex-memory/README.md", "topics/codex-memory/users-me-sites-shop/2026-10-18-a.md",
    "topics/codex-memory/users-me-sites-shop/2026-10-18-b.md"]);
  assert.match(target.read("topics/codex-memory/README.md"), /^scope: memory-codex$/m);
  const note = target.read("topics/codex-memory/users-me-sites-shop/2026-10-18-a.md");
  assert.match(note, /^key_fact: The user fixed the cart total\.$/m);
  assert.match(note, /^updated: 2026-10-20$/m);
  assert.match(note, /^# Checkout bug$/m);
  assert.ok(note.includes("> Imported from the Codex memory of /Users/me/Sites/shop."));
  assert.ok(!note.includes("thread_id"));
  assert.deepEqual(run(target, home).changed, []);
});

test("without a codex home, or with the extra off, Codex is skipped", () => {
  const target = enabled();
  const result = importMemory(new Access(target.config), { claudeHome: tempDir(), dryRun: false, sync: true });
  assert.deepEqual(result.changed, []);
});

test("the CLI reads --codex-home and imports both sources", () => {
  const target = enabled();
  const home = codexHome({ "a.md": summary("/Users/me/Sites/shop", "Checkout bug", "Fixed.") });
  const result = invoke(target, ["import-memory", "--codex-home", home, "--claude-home", tempDir(), "--serious"]);
  assert.equal(result.code, 0, result.err);
  assert.ok(target.exists("topics/codex-memory/users-me-sites-shop/a.md"));
});

test("mirror names follow the kebab-case write rule and never pose as a README", () => {
  assert.equal(mirrorName("2026-10-18T09-31-56-omdz-style_layering_hoodies.md", "README.md"),
    "2026-10-18t09-31-56-omdz-style-layering-hoodies.md");
  assert.equal(mirrorName("README.md", "README.md"), "memory-readme.md");
  assert.equal(mirrorName("__.md", "README.md"), "memory.md");
});

test("a real Codex file name with capitals and underscores imports", () => {
  const target = enabled();
  const home = codexHome({ "2026-10-18T09-31-56-omdz-style_layering.md": summary("/Users/me/Sites/shop", "Style", "Layers.") });
  assert.deepEqual(run(target, home).changed.slice(1), ["topics/codex-memory/users-me-sites-shop/2026-10-18t09-31-56-omdz-style-layering.md"]);
});
