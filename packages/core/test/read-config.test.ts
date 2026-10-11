/** Port of tests/test_config.py. */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";

import { CONFIG_NAME, findRoot, loadConfig } from "../src/config.ts";
import { ConfigError, ConfigMissing } from "../src/errors.ts";
import { REPO, tempDir } from "./helpers.ts";

process.setMaxListeners(0);

const MINIMAL = 'schema_version = 1\n[repo]\nremote = "git@example.org:me/brain.git"\n';

function write(root: string, text: string): string {
  const target = path.join(root, CONFIG_NAME);
  fs.writeFileSync(target, text, "utf-8");
  return target;
}

/** The call throws a ConfigError whose message names the key. */
function rejects(root: string, key: string): void {
  assert.throws(() => loadConfig(root), (error: unknown) => error instanceof ConfigError && error.message.includes(key));
}

describe("config", () => {
  test("minimal config uses documented defaults", () => {
    const root = tempDir();
    write(root, MINIMAL);
    const config = loadConfig(root);
    assert.equal(config.root, fs.realpathSync(root));
    assert.equal(config.repo.remote, "git@example.org:me/brain.git");
    assert.equal(config.repo.branch, "main");
    assert.equal(config.repo.remoteName, "origin");
    assert.equal(config.repo.autoPush, true);
    assert.deepEqual(config.layout.roots, ["topics", "notes", "bookmarks"]);
    assert.equal(config.layout.sources, "sources");
    assert.deepEqual(config.scopes.values, ["private", "work"]);
    assert.equal(config.scopes.all, "both");
    assert.equal(config.sensitive.marker, "> SENSITIVE");
    assert.deepEqual(config.sensitive.always, []);
    assert.equal(config.frontmatter.keyFact, "key_fact");
    assert.equal(config.ui.tone, "cheeky");
    assert.equal(config.limits.maxChars, 6000);
    assert.equal(config.search.weights.aliases, 12);
    assert.equal(config.extras.links, true);
    assert.equal(config.links.output, "LINKS.md");
  });

  test("example config loads", () => {
    const root = tempDir();
    write(root, fs.readFileSync(path.join(REPO, "examples", "dummkopf.example.toml"), "utf-8"));
    assert.equal(loadConfig(root).curator.openDays, 28);
  });

  test("german hub mapping needs no note migration", () => {
    const root = tempDir();
    write(root, fs.readFileSync(path.join(REPO, "examples", "config-german-hub.toml"), "utf-8"));
    const config = loadConfig(root);
    const fm = config.frontmatter;
    assert.deepEqual([fm.keyFact, fm.summary, fm.aliases, fm.updated], ["kernfakt", "kurz", "aliase", "stand"]);
    assert.deepEqual([fm.period, fm.entities, fm.scope, fm.status], ["zeitraum", "entitaeten", "scope", "status"]);
    assert.deepEqual(config.scopes.values, ["privat", "work"]);
    assert.equal(config.scopes.mixedLabel, "gemischt");
    assert.equal(config.status.active, "aktiv");
    assert.equal(config.sensitive.marker, "> SENSIBEL");
    assert.deepEqual(config.sensitive.always, ["topics/vertraulich/"]);
    assert.equal(config.layout.sources, "quellen");
    assert.equal(config.ui.locale, "de");
    assert.equal(config.links.output, "KANTEN.md");
    assert.deepEqual(config.repo.syncExclude, ["scripts"]);
  });

  test("missing config is reported", () => {
    assert.throws(() => loadConfig(tempDir()), ConfigMissing);
  });

  test("unknown key is rejected so typos never disable rules", () => {
    const root = tempDir();
    write(root, MINIMAL + "[sensitive]\nmarkr = '> SECRET'\n");
    rejects(root, "sensitive.markr");
  });

  test("unknown section is rejected", () => {
    const root = tempDir();
    write(root, MINIMAL + "[sensitiv]\nmarker = '> SECRET'\n");
    rejects(root, "sensitiv");
  });

  test("required keys: schema_version", () => {
    const root = tempDir();
    write(root, '[repo]\nremote = "x"\n');
    rejects(root, "schema_version");
  });

  for (const text of ["schema_version = 1\n", "schema_version = 1\n[repo]\n", 'schema_version = 1\n[repo]\nremote = ""\n']) {
    test("a config without a remote is a local brain: " + JSON.stringify(text), () => {
      const root = tempDir();
      write(root, text);
      const config = loadConfig(root);
      assert.equal(config.repo.local, true);
    });
  }

  test("a config with a remote is not local", () => {
    const root = tempDir();
    write(root, 'schema_version = 1\n[repo]\nremote = "git@example.org:me/brain.git"\n');
    assert.equal(loadConfig(root).repo.local, false);
  });

  const invalid: readonly (readonly [string, string])[] = [
    ["[scopes]\nvalues = []\n", "scopes.values"],
    ["[scopes]\nvalues = ['a', 'a']\n", "scopes.values"],
    ["[scopes]\nvalues = ['a b']\n", "scopes.values"],
    ["[scopes]\nvalues = ['both']\n", "scopes.all"],
    ["[scopes]\nquery_default = 'nope'\n", "scopes.query_default"],
    ["[scopes]\nlink_barriers = ['work>nope']\n", "scopes.link_barriers"],
    ["[scopes]\nvalues = ['a', 'b']\n", "scopes.link_barriers"],
    ["[sensitive]\nmarker = ''\n", "sensitive.marker"],
    ['[sensitive]\nmarker = "a\\nb"\n', "sensitive.marker"],
    ["[sensitive]\nalways = ['../x/']\n", "sensitive.always"],
    ["[sensitive]\nalways = ['./topics/health/']\n", "sensitive.always"],
    ["[sensitive]\nalways = ['notes//secret.md']\n", "sensitive.always"],
    ["[links]\noutput = 'dummkopf.toml'\n", "links.output"],
    ["[layout]\ntopics = 'a/b'\n", "layout.topics"],
    ["[layout]\nnotes = 'topics'\n", "layout"],
    ["[frontmatter]\nkey_fact = 'has space'\n", "frontmatter.key_fact"],
    ["[frontmatter]\nsummary = 'key_fact'\n", "frontmatter"],
    ["[ui]\ntone = 'rude'\n", "ui.tone"],
    ["[ui]\nlocale = 'fr'\n", "ui.locale"],
    ["[limits]\nmax_chars = 'many'\n", "limits.max_chars"],
    ["[limits]\nfind_limit = 0\n", "limits.find_limit"],
    ["[extras]\nlinks = 'yes'\n", "extras.links"],
    ["[links]\noutput = '/etc/passwd'\n", "links.output"],
  ];
  for (const [snippet, key] of invalid) {
    test("invalid values name the key: " + JSON.stringify(snippet), () => {
      const root = tempDir();
      write(root, MINIMAL + snippet);
      rejects(root, key);
    });
  }

  test("booleans are not accepted as integers", () => {
    const root = tempDir();
    write(root, MINIMAL + "[limits]\nmax_chars = true\n");
    rejects(root, "limits.max_chars");
  });

  test("unsupported schema version", () => {
    const root = tempDir();
    write(root, MINIMAL.replace("= 1", "= 2"));
    rejects(root, "schema_version");
  });

  test("broken toml is a config error", () => {
    const root = tempDir();
    write(root, "schema_version = = 1\n");
    assert.throws(() => loadConfig(root), ConfigError);
  });

  test("find root walks up from cwd", () => {
    const root = tempDir();
    write(root, MINIMAL);
    const nested = path.join(root, "topics", "a");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findRoot(nested, null, {}), fs.realpathSync(root));
  });

  test("find root prefers explicit then env", () => {
    const base = tempDir();
    const first = path.join(base, "one");
    const second = path.join(base, "two");
    for (const directory of [first, second]) {
      fs.mkdirSync(directory);
      write(directory, MINIMAL);
    }
    assert.equal(findRoot(base, first, { DUMMKOPF_ROOT: second }), fs.realpathSync(first));
    assert.equal(findRoot(base, null, { DUMMKOPF_ROOT: second }), fs.realpathSync(second));
  });

  test("find root without config raises", () => {
    const base = tempDir();
    assert.throws(() => findRoot(base, null, {}), ConfigMissing);
    assert.throws(() => findRoot(base, base, {}), ConfigMissing);
  });

  test("config symlink is rejected", () => {
    const root = tempDir();
    const real = path.join(root, "real.toml");
    fs.writeFileSync(real, MINIMAL, "utf-8");
    fs.symlinkSync(real, path.join(root, CONFIG_NAME));
    assert.throws(() => loadConfig(root), ConfigError);
  });

  test("config with CRLF line endings loads like LF", () => {
    const text = MINIMAL + "# comment\n[ui]\ntone = 'plain'\n";
    const lf = tempDir();
    write(lf, text);
    const crlf = tempDir();
    write(crlf, text.replace(/\n/g, "\r\n"));
    const a = loadConfig(lf);
    const b = loadConfig(crlf);
    assert.equal(b.repo.remote, a.repo.remote);
    assert.equal(b.ui.tone, "plain");
    assert.deepEqual({ ...b, root: "" }, { ...a, root: "" });
  });

  test("bare carriage return is config_unreadable", () => {
    for (const text of [
      MINIMAL.replace("\n[repo]", "\r[repo]"),
      MINIMAL + "# comment\rmore\n",
      MINIMAL + "x = 1\r",
    ]) {
      const root = tempDir();
      write(root, text);
      assert.throws(() => loadConfig(root),
                    (error: unknown) => error instanceof ConfigError && error.key === "config_unreadable",
                    JSON.stringify(text));
    }
  });

  test("branch must not look like an option", () => {
    const root = tempDir();
    write(root, MINIMAL + "branch = '-x'\n");
    rejects(root, "repo.branch");
  });
});
