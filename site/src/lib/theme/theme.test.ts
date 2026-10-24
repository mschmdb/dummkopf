import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTheme } from "./theme.ts";

test("a stored theme wins over the system preference", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("without a valid stored theme the system preference decides", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme("purple", false), "light");
});
