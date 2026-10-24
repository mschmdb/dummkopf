// Reads the real tokens from src/tokens.css and checks the WCAG pairs, as schmidbauer.dev does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { contrastRatio, oklchToSrgb, parseOklch } from "./oklch.ts";

const css = readFileSync(new URL("../../tokens.css", import.meta.url), "utf8");

/** The `--token: oklch(...)` pairs of one selector block. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  assert.notEqual(start, -1, "selector not in tokens.css: " + selector);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(oklch\([^;]+\));/g)].map((m) => [m[1], m[2]]));
}

const ratio = (a: string, b: string): number => contrastRatio(oklchToSrgb(parseOklch(a)), oklchToSrgb(parseOklch(b)));

for (const [mode, selector] of [["light", ":root"], ["dark", "[data-theme='dark']"]] as const) {
  const t = tokens(selector);
  for (const name of ["--ink", "--ink-muted", "--ink-subtle", "--accent", "--focus", "--success", "--warning", "--error"]) {
    test(`${mode}: ${name} on --bg and --bg-elevated reaches 4.5:1 (AA text)`, () => {
      assert.ok(ratio(t[name]!, t["--bg"]!) >= 4.5, `${name} on --bg: ${ratio(t[name]!, t["--bg"]!).toFixed(2)}`);
      assert.ok(ratio(t[name]!, t["--bg-elevated"]!) >= 4.5, `${name} on --bg-elevated`);
    });
  }
  test(`${mode}: --rule-strong on --bg reaches 3:1 (non-text)`, () => {
    assert.ok(ratio(t["--rule-strong"]!, t["--bg"]!) >= 3);
  });
  test(`${mode}: button text (--bg) on --accent reaches 4.5:1`, () => {
    assert.ok(ratio(t["--bg"]!, t["--accent"]!) >= 4.5);
  });
}
