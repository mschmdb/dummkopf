/** Child processes, synchronous like the CLI: Git calls and the like. */

import { spawnSync } from "node:child_process";

export interface Done {
  /** Exit code, or null when the process could not start or was killed. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the program is missing or the timeout hit, like OSError or TimeoutExpired. */
  readonly failed: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutS?: number;
  input?: string;
}

export function run(program: string, args: readonly string[], options: RunOptions): Done {
  const done = spawnSync(program, args, {
    cwd: options.cwd,
    input: options.input ?? "",
    encoding: "utf-8",
    timeout: options.timeoutS === undefined ? undefined : options.timeoutS * 1000,
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    code: done.status,
    stdout: done.stdout ?? "",
    stderr: done.stderr ?? "",
    failed: done.error !== undefined || done.status === null,
  };
}
