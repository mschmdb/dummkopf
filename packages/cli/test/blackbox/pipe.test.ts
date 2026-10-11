/** A reader that closes the pipe early, like `| head -1`, ends the output quietly. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { binary, fullNote, Sandbox } from "./harness.ts";

/** Run `dummkopf args` into a pipe whose reader has already exited; return its stderr and exit code. */
function intoClosedPipe(args: string, cwd: string): { err: string; code: string } {
  // `true` exits at once; the sleep makes sure dummkopf writes only after that.
  const script = '( sleep 0.5; "$BIN" ' + args + ' 2>"$ERR"; echo $? >"$CODE" ) | true';
  const env = { ...process.env, BIN: binary(), ERR: cwd + "/stderr.txt", CODE: cwd + "/code.txt" };
  spawnSync("sh", ["-c", script], { cwd, env, encoding: "utf-8" });
  const read = (file: string): string => spawnSync("cat", [file], { encoding: "utf-8" }).stdout;
  return { err: read(env.ERR), code: read(env.CODE).trim() };
}

test("help into a closed pipe exits 0 without a stack trace", () => {
  const sandbox = new Sandbox();
  assert.deepEqual(intoClosedPipe("--help", sandbox.tmp), { err: "", code: "0" });
});

test("find into a closed pipe keeps its exit code and prints nothing on stderr", () => {
  const brain = new Sandbox().brain();
  brain.write("notes/docker.md", fullNote({ title: "Docker", body: "pnpm esbuild fails" }));
  assert.deepEqual(intoClosedPipe("--root '" + brain.root + "' find docker", brain.sandbox.tmp), { err: "", code: "0" });
});
