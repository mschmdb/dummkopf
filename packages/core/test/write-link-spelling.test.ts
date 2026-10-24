/** Link checks look at the exact target spelling before they touch the disk (security review of #88). */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Access } from "../src/access.ts";
import { check } from "../src/write.ts";
import { brain } from "./helpers.ts";

function codes(target: ReturnType<typeof brain>, rel: string): string[] {
  return check(new Access(target.config), [rel]).issues.map((issue) => issue.code);
}

test("a link with a backslash is invalid, so it can never walk out of an allowed folder", () => {
  const target = brain();
  target.configure('[links]\nallow_outside = ["public"]\n');
  target.write("public/page.txt", "public\n");
  target.note("notes/escape.md", { body: "See [x](../public/..%5Cnotes%5Csecret.md)." });
  assert.ok(codes(target, "notes/escape.md").includes("link-invalid"));
});

test("a link to another spelling of a sensitive note answers like a link to a missing one", () => {
  const target = brain();
  target.note("notes/secret.md", { body: "> SENSITIVE\n\nHidden." });
  target.write(".sensitive-paths", "notes/secret.md\n");
  target.note("notes/other-spelling.md", { body: "See [x](Secret.md)." });
  target.note("notes/missing.md", { body: "See [x](absent.md)." });
  assert.deepEqual(codes(target, "notes/other-spelling.md").filter((code) => code.startsWith("link")),
    codes(target, "notes/missing.md").filter((code) => code.startsWith("link")));
});
