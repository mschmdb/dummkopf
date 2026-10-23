/**
 * Move a brain from the old name dummkopf to rcllr: config file, command name in the agent rules, hooks.
 * Notes stay untouched. Files outside the brain are only listed, never changed.
 */

import * as fs from "node:fs";

import { CONFIG_NAME, LEGACY_CONFIG_NAME, loadConfig } from "./config.ts";
import { hooksDir, install, isOurs, LEGACY_MANAGED, loadJson } from "./install.ts";
import { isObject, type Json } from "./pyjson.ts";
import { run } from "./proc.ts";
import { exists, isFile, isSymlink, join, readText, writeText } from "./pyos.ts";

/** The agent rule files `init` writes; the command name in them changes. */
const RULE_FILES = ["AGENTS.md", "CLAUDE.md"];
/** Files outside the brain that often call the CLI by name; listed so the user can update them. */
const OUTSIDE_FILES = [".claude/CLAUDE.md", ".claude/settings.json", ".codex/AGENTS.md"];
const SKILL_FOLDERS = [".claude/skills", ".codex/skills"];
// The command, the config file and @dummkopf/core change; a URL path such as github.com/me/dummkopf and the
// capitalized word in prose stay.
const OLD_COMMAND = /(?<![\w/])dummkopf\b/g;
const MENTIONS_OLD_COMMAND = /(?<![\w/])dummkopf\b/;
const OLD_ENV = /\bDUMMKOPF_ROOT\b/g;

export interface NameMigration {
  /** Step keys in order: `rename-config`, `agents:<file>`, `hooks`. Empty when nothing is left to do. */
  steps: string[];
  /** Places outside the brain that still name dummkopf: `~/`-paths and environment variables. */
  outside: string[];
  applied: boolean;
}

export interface MigrateOptions {
  apply: boolean;
  home: string;
  env: Record<string, string | undefined>;
}

export function renamed(text: string): string {
  return text.replace(OLD_ENV, "RCLLR_ROOT").replace(OLD_COMMAND, "rcllr");
}

export function migrateName(root: string, options: MigrateOptions): NameMigration {
  const steps: string[] = [];
  const legacyConfig = join(root, LEGACY_CONFIG_NAME);
  const renameConfig = isFile(legacyConfig) && !exists(join(root, CONFIG_NAME));
  if (renameConfig) steps.push("rename-config");
  // A symlink may point outside the brain, and the brain may come from someone else: never write through one.
  const rules = RULE_FILES.filter((file) => isFile(join(root, file)) && !isSymlink(join(root, file)))
    .map((file): [string, string, string] => {
      const text = readText(join(root, file));
      return [file, text, renamed(text)];
    })
    .filter(([, before, after]) => before !== after);
  for (const [file] of rules) steps.push("agents:" + file);
  const hooks = oldHooksInstalled(root);
  if (hooks) steps.push("hooks");

  if (options.apply) {
    if (renameConfig) renameConfigFile(root);
    for (const [file, , after] of rules) writeText(join(root, file), after);
    if (hooks) install(loadConfig(root));
  }
  return { steps, outside: outside(options.home, options.env), applied: options.apply };
}

function renameConfigFile(root: string): void {
  const tracked = run("git", ["ls-files", "--error-unmatch", "--", LEGACY_CONFIG_NAME], { cwd: root });
  if (!tracked.failed && tracked.code === 0) {
    const moved = run("git", ["mv", "--", LEGACY_CONFIG_NAME, CONFIG_NAME], { cwd: root });
    if (!moved.failed && moved.code === 0) return;
  }
  fs.renameSync(join(root, LEGACY_CONFIG_NAME), join(root, CONFIG_NAME));
}

/** True when a hook from before the rename is in place: the old pre-commit marker or an old agent hook. */
function oldHooksInstalled(root: string): boolean {
  let preCommit = "";
  try {
    preCommit = join(hooksDir(loadConfig(root)), "pre-commit");
  } catch {
    // Not a Git repository: no pre-commit hook to look at.
  }
  if (preCommit && isFile(preCommit) && readText(preCommit, "ignore").includes(LEGACY_MANAGED)) return true;
  return [join(root, ".claude", "settings.json"), join(root, ".codex", "hooks.json")].some((file) => {
    try {
      return oldAgentHook(loadJson(file).hooks);
    } catch {
      return false;
    }
  });
}

function oldAgentHook(value: Json | undefined): boolean {
  if (Array.isArray(value)) return value.some(oldAgentHook);
  if (!isObject(value)) return false;
  if (isOurs(value.command) && typeof value.command === "string" && MENTIONS_OLD_COMMAND.test(value.command)) {
    return true;
  }
  return Object.values(value).some(oldAgentHook);
}

function outside(home: string, env: Record<string, string | undefined>): string[] {
  const skills = SKILL_FOLDERS.flatMap((folder) => {
    const directory = join(home, folder);
    let names: string[] = [];
    try {
      names = fs.readdirSync(directory).sort();
    } catch {
      // No skills folder.
    }
    return names.map((name) => folder + "/" + name + "/SKILL.md");
  });
  const found = [...OUTSIDE_FILES, ...skills].filter((rel) => {
    const file = join(home, rel);
    return isFile(file) && MENTIONS_OLD_COMMAND.test(readText(file, "ignore"));
  }).map((rel) => "~/" + rel);
  return env.DUMMKOPF_ROOT ? [...found, "DUMMKOPF_ROOT"] : found;
}
