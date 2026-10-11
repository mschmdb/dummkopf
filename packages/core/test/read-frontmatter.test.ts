/** Port of tests/test_frontmatter.py. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type Data, dumpFrontmatter, dumpScalar, parseFrontmatter, shorten } from "../src/frontmatter.ts";
import { len, strip } from "../src/py.ts";

const map = (entries: Record<string, string | string[]>): Data => new Map(Object.entries(entries));

describe("frontmatter", () => {
  test("parse scalar", () => {
    const { data, body, present } = parseFrontmatter("---\nscope: work\n---\n\n# Title\n");
    assert.ok(present);
    assert.equal(data.get("scope"), "work");
    assert.equal(body, "\n# Title\n");
  });

  test("parse without frontmatter", () => {
    const { data, body, present } = parseFrontmatter("# Title\n\nText\n");
    assert.ok(!present);
    assert.deepEqual(data, new Map());
    assert.equal(body, "# Title\n\nText\n");
  });

  test("unclosed frontmatter is body", () => {
    const text = "---\nscope: work\n# Title\n";
    assert.deepEqual(parseFrontmatter(text), { data: new Map(), body: text, present: false });
  });

  test("parse inline list", () => {
    assert.deepEqual(parseFrontmatter('---\naliases: [a, b, "c, d"]\n---\n').data.get("aliases"), ["a", "b", "c, d"]);
  });

  test("parse empty inline list", () => {
    assert.deepEqual(parseFrontmatter("---\nperiod: []\n---\n").data.get("period"), []);
  });

  test("parse block list", () => {
    assert.deepEqual(parseFrontmatter("---\nrelated:\n  - docs/a.md\n  - docs/b.md\n---\n").data.get("related"),
      ["docs/a.md", "docs/b.md"]);
  });

  test("empty value without items is empty string", () => {
    assert.deepEqual(parseFrontmatter("---\nsummary:\nscope: work\n---\n").data, map({ summary: "", scope: "work" }));
  });

  test("parse quoted with colon", () => {
    assert.equal(parseFrontmatter('---\nsummary: "a: b"\n---\n').data.get("summary"), "a: b");
  });

  test("parse single quotes", () => {
    assert.equal(parseFrontmatter("---\nsummary: 'it''s'\n---\n").data.get("summary"), "it's");
  });

  test("parse unquoted url", () => {
    assert.equal(parseFrontmatter("---\nsource: https://example.org/a\n---\n").data.get("source"), "https://example.org/a");
  });

  test("comments and garbage lines are skipped", () => {
    assert.deepEqual(parseFrontmatter("---\n# comment\nnot a key\nscope: work\n---\n").data, map({ scope: "work" }));
  });

  test("dump quoting", () => {
    assert.equal(dumpScalar("work"), "work");
    assert.equal(dumpScalar("a: b"), '"a: b"');
    assert.equal(dumpScalar("x # y"), '"x # y"');
    assert.equal(dumpScalar('says "hi"'), '"says \\"hi\\""');
    assert.equal(dumpScalar("- leading"), '"- leading"');
    assert.equal(dumpScalar(""), '""');
    assert.equal(dumpScalar(" padded"), '" padded"');
    assert.equal(dumpScalar("a, b"), "a, b");
    assert.equal(dumpScalar("a, b", true), '"a, b"');
  });

  test("roundtrip special characters", () => {
    const original = map({
      key_fact: 'As of 08/2026: **live**, "test" # 1 | two',
      aliases: ["a, b", "c"],
      period: [],
      note: "back\\slash and\nnewline",
    });
    const { data, body, present } = parseFrontmatter(dumpFrontmatter(original) + "\nBody\n");
    assert.ok(present);
    assert.deepEqual(data, original);
    assert.equal(body, "\nBody\n");
  });

  test("dump keeps key order", () => {
    assert.equal(dumpFrontmatter(map({ b: "1", a: ["x"] })), "---\nb: 1\na: [x]\n---\n");
  });

  test("shorten keeps short text", () => {
    assert.equal(shorten("Short key fact"), "Short key fact");
  });

  test("shorten cuts at word boundary", () => {
    const text = strip("word ".repeat(60));
    const out = shorten(text);
    assert.ok(len(out) <= 160);
    assert.ok(out.endsWith("…"));
    assert.ok(!out.slice(0, -1).endsWith(" "));
    assert.ok(text.startsWith(out.slice(0, -1)));
  });

  test("shorten exact limit and custom limit", () => {
    assert.equal(shorten("a".repeat(160)), "a".repeat(160));
    assert.equal(shorten("a".repeat(30), 20), "a".repeat(19) + "…");
  });
});
