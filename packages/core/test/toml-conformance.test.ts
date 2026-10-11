/**
 * Conformance against the official toml-test suite (TOML 1.0 cases). Dev only: `pnpm test:toml`
 * fetches a pinned release and sets TOML_TEST_DIR. Without it, this file skips.
 *
 * Cases listed in toml-test-skip.txt still run. A skipped case that starts to pass fails the run,
 * so the skip list never goes stale.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isTable, parseToml, TomlDateTime, TomlError, TomlFloat } from "../src/toml.ts";
import type { TomlValue } from "../src/toml.ts";

const SUITE = process.env.TOML_TEST_DIR;
const SKIP_FILE = path.join(import.meta.dirname, "toml-test-skip.txt");

type Tagged = { type: string; value: string } | Tagged[] | { [key: string]: Tagged };

interface SkipRule {
  pattern: RegExp;
  glob: string;
  reason: string;
}

function globToRegExp(glob: string): RegExp {
  const body = glob.split("**").map((part) => part.split("*").map(escapeRegExp).join("[^/]*")).join(".*");
  return new RegExp("^" + body + "$");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** One rule per line: `<glob> <reason>`. Blank lines and `#` comments are ignored. */
function readSkips(): SkipRule[] {
  const rules: SkipRule[] = [];
  for (const raw of fs.readFileSync(SKIP_FILE, "utf-8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const space = line.search(/\s/);
    assert.ok(space > 0, "skip rule needs a reason: " + line);
    const glob = line.slice(0, space);
    rules.push({ glob, pattern: globToRegExp(glob), reason: line.slice(space).trim() });
  }
  return rules;
}

/** Strict UTF-8 like the config loader; a leading BOM is allowed and dropped. */
function decode(file: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
}

function dateTimeType(text: string): string {
  if (/^\d{2}:/.test(text)) return "time-local";
  if (text.length === 10) return "date-local";
  return /(?:[Zz]|[+-]\d{2}:\d{2})$/.test(text) ? "datetime" : "datetime-local";
}

/** The parser's value in toml-test's tagged JSON form. */
function tag(value: TomlValue): Tagged {
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "boolean") return { type: "bool", value: String(value) };
  if (typeof value === "number") return { type: "integer", value: String(value) };
  if (value instanceof TomlFloat) return { type: "float", value: floatText(value.value) };
  if (value instanceof TomlDateTime) return { type: dateTimeType(value.text), value: value.text };
  if (Array.isArray(value)) return value.map(tag);
  const out: { [key: string]: Tagged } = {};
  for (const [key, item] of Object.entries(value)) out[key] = tag(item);
  return out;
}

function floatText(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  return Object.is(value, -0) ? "-0" : String(value);
}

/** Puts both sides in one spelling: floats as numbers, date-times with `T`, `Z` and no trailing zeros. */
function normalize(tagged: Tagged): Tagged {
  if (Array.isArray(tagged)) return tagged.map(normalize);
  if (isLeaf(tagged)) {
    if (tagged.type === "float") {
      const number = Number(tagged.value.replace(/^\+/, "").replace(/^(-?)inf$/, "$1Infinity"));
      return { type: "float", value: floatText(number) };
    }
    if (tagged.type.startsWith("datetime") || tagged.type.endsWith("-local")) {
      const text = tagged.value.replace(/^(\d{4}-\d{2}-\d{2})[Tt ]/, "$1T").replace(/z$/, "Z")
        .replace(/(\.\d*?)0+(?=$|[Z+-])/, "$1").replace(/\.(?=$|[Z+-])/, "");
      return { type: tagged.type, value: text };
    }
    return tagged;
  }
  const out: { [key: string]: Tagged } = {};
  for (const [key, item] of Object.entries(tagged)) out[key] = normalize(item as Tagged);
  return out;
}

function isLeaf(tagged: Tagged): tagged is { type: string; value: string } {
  return !Array.isArray(tagged) && typeof tagged.type === "string" && typeof tagged.value === "string"
    && Object.keys(tagged).length === 2;
}

function runValid(dir: string, name: string): void {
  const expected = JSON.parse(fs.readFileSync(path.join(dir, name + ".json"), "utf-8")) as Tagged;
  const parsed = parseToml(decode(path.join(dir, name + ".toml")));
  assert.ok(isTable(parsed));
  assert.deepEqual(normalize(tag(parsed)), normalize(expected));
}

function runInvalid(dir: string, name: string): void {
  let text: string;
  try {
    text = decode(path.join(dir, name + ".toml"));
  } catch {
    return; // Invalid UTF-8: the config loader's strict decoder refuses it before the parser sees it.
  }
  assert.throws(() => parseToml(text), TomlError, "parser accepted an invalid document");
}

if (SUITE === undefined) {
  test("toml-test conformance", { skip: "TOML_TEST_DIR is not set; run `pnpm test:toml` to fetch the suite" }, () => {});
} else {
  const dir = path.join(SUITE, "tests");
  const names = fs.readFileSync(path.join(dir, "files-toml-1.0.0"), "utf-8").split("\n")
    .filter((line) => line.endsWith(".toml")).map((line) => line.slice(0, -".toml".length));
  const rules = readSkips();
  const used = new Set<SkipRule>();
  const unexpected: string[] = [];
  const counts = { valid: 0, invalid: 0, skipped: 0 };

  for (const kind of ["valid", "invalid"] as const) {
    test("toml-test " + kind, async (t) => {
      for (const name of names.filter((entry) => entry.startsWith(kind + "/"))) {
        const rule = rules.find((candidate) => candidate.pattern.test(name));
        if (rule) used.add(rule);
        await t.test(name, (sub) => {
          let passed = true;
          try {
            if (kind === "valid") runValid(dir, name);
            else runInvalid(dir, name);
          } catch (error) {
            passed = false;
            if (!rule) throw error;
          }
          if (!rule) {
            counts[kind]++;
            return;
          }
          if (passed) unexpected.push(name);
          counts.skipped++;
          sub.skip(rule.reason);
        });
      }
    });
  }

  test("toml-test skip list is current", (t) => {
    assert.deepEqual(unexpected, [], "these skipped cases pass now; remove them from toml-test-skip.txt");
    const stale = rules.filter((rule) => !used.has(rule)).map((rule) => rule.glob);
    assert.deepEqual(stale, [], "these skip rules match no case");
    t.diagnostic("toml-test: " + counts.valid + " valid and " + counts.invalid + " invalid cases pass, "
      + counts.skipped + " skipped");
  });
}
