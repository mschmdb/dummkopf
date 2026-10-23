/** `rcllr migrate-name`: move a brain from the old name dummkopf to rcllr. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { CONFIG_NAME, LEGACY_CONFIG_NAME } from "../src/config.ts";
import { migrateName } from "../src/migrate.ts";
import { type Brain, brain, runGit, tempDir } from "./helpers.ts";

const OLD_AGENTS = "# Rules\n\nRun `dummkopf context \"<question>\"` first. Config lives in dummkopf.toml.\n"
  + "Set DUMMKOPF_ROOT=~/brain. Source: https://github.com/mschmdb/dummkopf\n"
  + "Without memory, every agent is a Dummkopf.\n";
const OLD_HOOK = 'PATH="$HOME/.local/bin:$PATH" dummkopf --root "$CLAUDE_PROJECT_DIR" hook agent';

/** A brain as dummkopf 0.4 left it: old config name, old hooks, old command in AGENTS.md. */
function legacy({ hooks = true } = {}): Brain {
  const target = brain();
  fs.renameSync(path.join(target.root, CONFIG_NAME), path.join(target.root, LEGACY_CONFIG_NAME));
  target.gitInit();
  target.write("AGENTS.md", OLD_AGENTS);
  target.write("CLAUDE.md", "@AGENTS.md\n");
  target.note("notes/history.md", { body: "We used to call it dummkopf." });
  if (hooks) {
    const hook = path.join(target.root, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\n# managed-by: dummkopf\ndummkopf hook pre-commit || true\n");
    fs.chmodSync(hook, 0o755);
    target.write(".claude/settings.json", JSON.stringify({
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: OLD_HOOK }] }] },
    }));
  }
  target.commit("Brain as dummkopf left it");
  return target;
}

function home(files: Record<string, string> = {}): string {
  const root = tempDir();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test("a dry run lists every step and changes nothing", () => {
  const target = legacy();
  const before = runGit(target.root, ["status", "--porcelain"]);
  const result = migrateName(target.root, { apply: false, home: home(), env: {} });
  assert.deepEqual(result.steps, ["rename-config", "agents:AGENTS.md", "hooks"]);
  assert.equal(result.applied, false);
  assert.ok(target.exists(LEGACY_CONFIG_NAME) && !target.exists(CONFIG_NAME));
  assert.equal(target.read("AGENTS.md"), OLD_AGENTS);
  assert.equal(runGit(target.root, ["status", "--porcelain"]), before);
});

test("apply renames the config, rewrites the command name and reinstalls the hooks", () => {
  const target = legacy();
  const result = migrateName(target.root, { apply: true, home: home(), env: {} });
  assert.equal(result.applied, true);
  assert.ok(target.exists(CONFIG_NAME) && !target.exists(LEGACY_CONFIG_NAME));
  assert.match(runGit(target.root, ["status", "--porcelain"]), /^R {2}dummkopf\.toml -> rcllr\.toml$/m);
  assert.equal(target.read("AGENTS.md"),
    "# Rules\n\nRun `rcllr context \"<question>\"` first. Config lives in rcllr.toml.\n"
    + "Set RCLLR_ROOT=~/brain. Source: https://github.com/mschmdb/dummkopf\n"
    + "Without memory, every agent is a Dummkopf.\n");
  assert.equal(target.read("CLAUDE.md"), "@AGENTS.md\n");
  const hook = fs.readFileSync(path.join(target.root, ".git", "hooks", "pre-commit"), "utf-8");
  assert.ok(hook.includes("# managed-by: rcllr") && hook.includes("rcllr hook pre-commit"));
  const commands = JSON.stringify(JSON.parse(target.read(".claude/settings.json")).hooks);
  assert.ok(commands.includes("rcllr --root") && !commands.includes("dummkopf --root"));
  assert.ok(target.read("notes/history.md").includes("We used to call it dummkopf."));
});

test("a second run finds nothing left to do", () => {
  const target = legacy();
  migrateName(target.root, { apply: true, home: home(), env: {} });
  assert.deepEqual(migrateName(target.root, { apply: true, home: home(), env: {} }).steps, []);
});

test("a brain without hooks gets none from the migration", () => {
  const target = legacy({ hooks: false });
  const result = migrateName(target.root, { apply: true, home: home(), env: {} });
  assert.deepEqual(result.steps, ["rename-config", "agents:AGENTS.md"]);
  assert.ok(!target.exists(".claude/settings.json"));
  assert.ok(!fs.existsSync(path.join(target.root, ".git", "hooks", "pre-commit")));
});

test("an untracked config is renamed without Git", () => {
  const target = legacy({ hooks: false });
  runGit(target.root, ["rm", "-q", "--cached", LEGACY_CONFIG_NAME]);
  migrateName(target.root, { apply: true, home: home(), env: {} });
  assert.ok(target.exists(CONFIG_NAME) && !target.exists(LEGACY_CONFIG_NAME));
});

test("places outside the brain are listed, never changed", () => {
  const target = legacy({ hooks: false });
  const text = "Long-term memory: run `dummkopf --root ~/brain context`.\n";
  const user = home({ ".claude/CLAUDE.md": text, ".claude/skills/notes/SKILL.md": "dk find x\ndummkopf read y\n",
    ".codex/AGENTS.md": "nothing to see\n" });
  const result = migrateName(target.root, { apply: true, home: user, env: { DUMMKOPF_ROOT: "/brain" } });
  assert.deepEqual(result.outside, ["~/.claude/CLAUDE.md", "~/.claude/skills/notes/SKILL.md", "DUMMKOPF_ROOT"]);
  assert.equal(fs.readFileSync(path.join(user, ".claude/CLAUDE.md"), "utf-8"), text);
});

test("a symlinked rule file is skipped, so the migration never writes outside the brain", () => {
  const target = legacy({ hooks: false });
  const victim = path.join(tempDir(), ".zshrc");
  fs.writeFileSync(victim, "alias brain='dummkopf context'\n");
  fs.rmSync(path.join(target.root, "CLAUDE.md"));
  fs.symlinkSync(victim, path.join(target.root, "CLAUDE.md"));
  const result = migrateName(target.root, { apply: true, home: home(), env: {} });
  assert.ok(!result.steps.includes("agents:CLAUDE.md"));
  assert.equal(fs.readFileSync(victim, "utf-8"), "alias brain='dummkopf context'\n");
});
