/** One Git sync path for the CLI and every agent hook. Never echoes raw Git output. */

import type { Config } from "./config.ts";
import { SyncError } from "./errors.ts";
import { withRepositoryLock } from "./lock.ts";
import { type Done, run } from "./proc.ts";
import { sorted } from "./py.ts";
import { exists, join, resolve } from "./pyos.ts";

const OPEN_OPERATIONS = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD"];

export function git(config: Config, args: readonly string[], allowed: readonly number[] = [0]): Done {
  const done = run("git", args, { cwd: config.root, timeoutS: config.limits.gitTimeoutS });
  if (done.failed) throw new SyncError("git_unavailable");
  if (!allowed.includes(done.code!)) throw new SyncError("git_failed", { step: args[0] });
  return done;
}

/** Everything except sync_exclude; humans commit tooling and agent setup themselves. */
export function notePathspec(config: Config): string[] {
  return ["--", ".", ...config.repo.syncExclude.map((path) => ":(exclude)" + path)];
}

function remoteRef(config: Config): string {
  return "refs/remotes/" + config.repo.remoteName + "/" + config.repo.branch;
}

function verify(config: Config): void {
  const repo = config.repo;
  if (resolve(git(config, ["rev-parse", "--show-toplevel"]).stdout.trim()) !== config.root) {
    throw new SyncError("git_root");
  }
  if (git(config, ["symbolic-ref", "--short", "HEAD"]).stdout.trim() !== repo.branch) {
    throw new SyncError("git_branch", { branch: repo.branch });
  }
  if (git(config, ["remote", "get-url", repo.remoteName]).stdout.trim() !== repo.remote) {
    throw new SyncError("git_remote", { name: repo.remoteName });
  }
  for (const state of OPEN_OPERATIONS) {
    const location = git(config, ["rev-parse", "--git-path", state]).stdout.trim();
    if (exists(join(config.root, location))) throw new SyncError("git_open_operation");
  }
  if (git(config, ["diff", "--name-only", "--diff-filter=U"]).stdout.trim()) throw new SyncError("git_conflicts");
}

function count(config: Config, range: string): number {
  return Number.parseInt(git(config, ["rev-list", "--count", range]).stdout.trim(), 10);
}

function refresh(config: Config): void {
  const repo = config.repo;
  // --no-write-fetch-head: parallel fetches would otherwise race on FETCH_HEAD.
  git(config, ["fetch", "--no-write-fetch-head", repo.remoteName, "refs/heads/" + repo.branch + ":" + remoteRef(config)]);
  if (count(config, "HEAD.." + remoteRef(config))) {
    try {
      git(config, ["rebase", "--autostash", remoteRef(config)]);
    } catch (error) {
      if (!(error instanceof SyncError)) throw error;
      git(config, ["rebase", "--abort"]);
      throw new SyncError("git_diverged");
    }
  }
}

/** Before a write: clean tree, then catch up with the remote, so markers and scopes are current. */
export function prepareRepository(config: Config): void {
  verify(config);
  if (git(config, ["status", "--porcelain", "--untracked-files=all", ...notePathspec(config)]).stdout) {
    throw new SyncError("git_dirty");
  }
  if (config.repo.autoPush) refresh(config);
}

/**
 * Commit staged note changes. Anything a human staged under sync_exclude stays staged, uncommitted.
 *
 * `git commit -- <pathspec>` would do this too, but drops what the pre-commit hook stages. So the
 * foreign staged changes are parked as a patch and restored after the commit.
 */
function commitNotesOnly(config: Config): void {
  const staged = new Set(git(config, ["diff", "--cached", "--name-only", "-z"]).stdout.split("\0"));
  const notes = new Set(git(config, ["diff", "--cached", "--name-only", "-z", ...notePathspec(config)]).stdout.split("\0"));
  const foreign = sorted([...staged].filter((path) => path && !notes.has(path)));
  const parked = foreign.length > 0 ? git(config, ["diff", "--cached", "--binary", "--", ...foreign]).stdout : "";
  if (foreign.length > 0) git(config, ["reset", "-q", "--", ...foreign]);
  try {
    git(config, ["commit", "-m", config.repo.commitMessage]);
  } finally {
    if (parked) {
      const restore = run("git", ["apply", "--cached"], { cwd: config.root, input: parked, timeoutS: config.limits.gitTimeoutS });
      if (restore.failed || restore.code !== 0) throw new SyncError("git_failed", { step: "apply" });
    }
  }
}

export function syncLocked(config: Config, refreshRemote = false): void {
  verify(config);
  const spec = notePathspec(config);
  if (git(config, ["status", "--porcelain", "--untracked-files=all", ...spec]).stdout) {
    git(config, ["add", "-A", ...spec]);
    if (git(config, ["diff", "--cached", "--quiet", ...spec], [0, 1]).code === 1) commitNotesOnly(config);
  }
  if (!config.repo.autoPush) return;
  if (count(config, remoteRef(config) + "..HEAD") || refreshRemote) {
    refresh(config);
    if (count(config, remoteRef(config) + "..HEAD")) git(config, ["push", config.repo.remoteName, config.repo.branch]);
  }
}

export function syncRepository(config: Config, refreshRemote = false): void {
  withRepositoryLock(config.root, () => syncLocked(config, refreshRemote), config.limits.lockTimeoutS);
}
