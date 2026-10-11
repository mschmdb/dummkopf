/**
 * Hooks: the Git pre-commit backstop and the agent hook for Claude Code and Codex.
 *
 * Hooks never block. The pre-commit hook always exits 0; the agent hook exits 1 on a
 * failed sync, which both agents treat as a non-blocking error.
 *
 * Port of hook.py. Output goes through the `HookOutput` the caller passes, so the core never
 * writes to the process streams itself.
 */

import * as fs from "node:fs";

import type { Config } from "./config.ts";
import { DummkopfError } from "./errors.ts";
import { iterNoteFiles } from "./files.ts";
import { text as say } from "./messages.ts";
import { generate, migrate, report } from "./meta.ts";
import { run } from "./proc.ts";
import { repr, splitlines } from "./py.ts";
import { isObject } from "./pyjson.ts";
import { isFile, isSymlink, join, parents, readText, resolve } from "./pyos.ts";
import { Sensitivity } from "./sensitive.ts";
import { syncRepository } from "./sync.ts";

/** Where hook messages go: the CLI passes its stdout and stderr writers. */
export interface HookOutput {
  out(text: string): void;
  err(text: string): void;
}

// Claude Code: Bash, Write, Edit, MultiEdit. Codex: apply_patch, exec_command.
export const WATCHED_TOOLS: ReadonlySet<string> = new Set(["Bash", "Write", "Edit", "MultiEdit", "apply_patch", "exec_command"]);
export const FILE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

export function isBrainPath(path: string, root: string): boolean {
  const resolved = resolve(path);
  return resolved === root || parents(resolved).includes(root);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `sync` is a parameter so tests can stand in for the Git sync. */
export function agentEvent(event: unknown, config: Config, output: HookOutput,
                           sync: (config: Config) => void = syncRepository): number {
  if (!isObject(event)) return 0;
  const tool = event.tool_name;
  const sessionEnd = event.hook_event_name === "SessionEnd";
  if ((typeof tool !== "string" || !WATCHED_TOOLS.has(tool)) && !sessionEnd) return 0;
  const cwd = Object.hasOwn(event, "cwd") ? event.cwd : process.cwd();
  if (typeof cwd !== "string") return 0;
  const inputs = event.tool_input;
  const file = isObject(inputs) ? inputs.file_path : undefined;
  const edited = typeof tool === "string" && FILE_TOOLS.has(tool) && typeof file === "string"
    && isBrainPath(file, config.root);
  if (!isBrainPath(cwd, config.root) && !edited) return 0;
  try {
    sync(config);
  } catch (error) {
    output.err(say("hook_sync_failed", "plain", { reason: reason(error) }) + "\n");
    return 1;
  }
  return 0;
}

export function gitLines(config: Config, ...args: string[]): string[] {
  const done = run("git", args, { cwd: config.root, timeoutS: config.limits.gitTimeoutS });
  if (done.failed) {
    throw new Error("Command '[" + ["git", ...args].map(repr).join(", ") + "]' timed out after "
      + config.limits.gitTimeoutS + " seconds");
  }
  return done.code === 0 ? splitlines(done.stdout) : [];
}

/** Stage generated changes, but never a file with unstaged human edits: they would ride along. */
export function stage(config: Config, paths: readonly string[], unstaged: ReadonlySet<string>, output: HookOutput): void {
  for (const path of paths) {
    if (unstaged.has(path)) output.out(say("hook_unstaged", "plain", { path }) + "\n");
  }
  const ready = paths.filter((path) => !unstaged.has(path));
  if (ready.length > 0) gitLines(config, "add", "--", ...ready);
}

/** Regenerate the sensitive-paths list, complete frontmatter of staged notes, rebuild indexes. */
export function preCommit(config: Config, output: HookOutput): number {
  if (!isFile(join(config.root, config.layout.index))) return 0;
  try {
    const unstaged = new Set(gitLines(config, "diff", "--name-only"));
    const pathsFile = join(config.root, config.sensitive.pathsFile);
    const fresh = Sensitivity.generate(config);
    const current = isFile(pathsFile) ? readText(pathsFile) : null;
    if (fresh !== current && !isSymlink(pathsFile)) {
      fs.writeFileSync(pathsFile, fresh, "utf-8");
      fs.chmodSync(pathsFile, 0o600);
      stage(config, [config.sensitive.pathsFile], unstaged, output);
      output.out(say("out_paths_file_updated", "plain", { file: config.sensitive.pathsFile }) + "\n");
    }
    const notes = new Set(iterNoteFiles(config));
    const staged = gitLines(config, "diff", "--cached", "--name-only", "--diff-filter=ACMR")
      .filter((rel) => notes.has(rel) && !unstaged.has(rel) && !readText(join(config.root, rel)).startsWith("---"));
    if (staged.length > 0) stage(config, migrate(config, false, staged), unstaged, output);
    stage(config, generate(config), unstaged, output);
    const findings = report(config, null, true);
    if (findings) output.out(findings + "\n");
  } catch (error) {
    output.err(say("hook_index_failed", "plain", { reason: reason(error) }) + "\n");
  }
  return 0;
}
