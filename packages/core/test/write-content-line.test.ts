/** contentLine: rejection lines count in the caller's content, not in the completed note. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { contentLine } from "../src/validate.ts";

const GIVEN = "---\nkey_fact: A fact.\n---\n\n# T\n\n[x](gone.md)\n";
const STORED = "---\nupdated: 2026-10-11\nstatus: active\nkey_fact: A fact.\nsummary: A fact.\naliases: []\n"
  + "period: []\nentities: []\n---\n\n# T\n\n[x](gone.md)\n";

describe("contentLine", () => {
  test("a body line shifts back by the added frontmatter lines", () => {
    assert.equal(contentLine(GIVEN, STORED)(13), 7);
    assert.equal(contentLine(GIVEN, STORED)(10), 4);
  });

  test("a line inside the completed frontmatter has no counterpart", () => {
    const toContent = contentLine(GIVEN, STORED);
    assert.equal(toContent(1), null);
    assert.equal(toContent(9), null);
  });

  test("the sensitive marker above the body shifts like frontmatter", () => {
    const marked = STORED.replace("---\n\n# T", "---\n\n> SENSITIVE\n\n# T");
    assert.equal(contentLine(GIVEN, marked)(15), 7);
  });

  test("unchanged content maps every line to itself", () => {
    const toContent = contentLine(STORED, STORED);
    assert.equal(toContent(13), 13);
    assert.equal(toContent(1), 1);
  });

  test("stored text with a different body keeps the stored line", () => {
    assert.equal(contentLine(GIVEN, "---\nkey_fact: A fact.\n---\n\nOther.\n")(5), 5);
  });

  test("content without frontmatter or body still maps", () => {
    assert.equal(contentLine("# T\n\n[x](a.md)\n", "---\nstatus: active\n---\n# T\n\n[x](a.md)\n")(6), 3);
    assert.equal(contentLine("---\nkey_fact: A.\n---\n", "---\nstatus: active\nkey_fact: A.\n---\n")(4), null);
  });
});
