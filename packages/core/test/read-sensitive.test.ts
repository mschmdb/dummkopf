/** Port of tests/test_sensitive.py. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { iterNoteFiles, topicOf } from "../src/files.ts";
import { splitlines } from "../src/py.ts";
import { markerPattern, Sensitivity, textHasMarker } from "../src/sensitive.ts";
import { brain, german } from "./helpers.ts";

process.setMaxListeners(0);

describe("sensitive", () => {
  test("marker matches at line start only", () => {
    const pattern = markerPattern("> SENSITIVE");
    const search = (text: string): boolean => textHasMarker(text, pattern);
    assert.ok(search("# A\n\n> SENSITIVE\n"));
    assert.ok(search("# A\n\n>SENSITIVE\n"));
    assert.ok(search("# A\n\n>   sensitive\n"));
    assert.ok(!search("A word SENSITIVE mid-sentence.\n"));
    assert.ok(!search("# A\n>\nSENSITIVE\n"), "marker must not span lines");
    assert.ok(search("# A\n> SENSITIVE\n"), "a non-breaking space looks like a space");
    assert.ok(search("# A\n> SENSITIVE\n"));
  });

  test("custom marker is escaped", () => {
    const pattern = markerPattern("!! private (do not share)");
    assert.ok(textHasMarker("x\n!! private (do not share)\n", pattern));
    assert.ok(!textHasMarker("x\n!! private do not share\n", pattern));
  });

  test("marker in file", () => {
    const b = brain();
    b.write("notes/a.md", "# A\n\n> SENSITIVE\n");
    assert.ok(Sensitivity.load(b.config).isSensitive("notes/a.md"));
  });

  test("marker in any ancestor readme", () => {
    const b = brain();
    b.write("topics/s/README.md", "# S\n\n> SENSITIVE\n");
    b.write("topics/s/a.md", "# A\n");
    b.write("topics/s/deep/b.md", "# B\n");
    const sensitivity = Sensitivity.load(b.config);
    assert.ok(sensitivity.isSensitive("topics/s/a.md"));
    assert.ok(sensitivity.isSensitive("topics/s/README.md"));
    assert.ok(sensitivity.isSensitive("topics/s/deep/b.md"));
  });

  test("word in prose is not a marker", () => {
    const b = brain();
    b.write("notes/a.md", "# A\n\nA word SENSITIVE mid-sentence.\n");
    assert.ok(!Sensitivity.load(b.config).isSensitive("notes/a.md"));
  });

  test("paths file lists files and folders", () => {
    const b = brain();
    b.write(".sensitive-paths", "# comment\nnotes/listed.md\ntopics/locked/\n\n");
    b.write("notes/listed.md", "# L\n");
    b.write("topics/locked/a.md", "# A\n");
    b.write("topics/lockedness/a.md", "# A\n");
    const sensitivity = Sensitivity.load(b.config);
    assert.deepEqual(sensitivity.files, new Set(["notes/listed.md"]));
    assert.deepEqual(sensitivity.dirs, new Set(["topics/locked"]));
    assert.ok(sensitivity.isListed("notes/listed.md"));
    assert.ok(sensitivity.isListed("topics/locked/a.md"));
    assert.ok(!sensitivity.isListed("topics/lockedness/a.md"));
  });

  test("always sensitive prefix needs no marker", () => {
    const g = german();
    g.write("topics/vertraulich/a.md", "# A\n");
    const sensitivity = Sensitivity.load(g.config);
    assert.ok(sensitivity.isListed("topics/vertraulich/a.md"));
    assert.ok(sensitivity.isSensitive("topics/vertraulich/a.md"));
    assert.ok(!sensitivity.isSensitive("topics/ernaehrung/a.md"));
  });

  test("german marker", () => {
    const g = german();
    g.write("notes/a.md", "# A\n\n> SENSIBEL\n");
    g.write("notes/b.md", "# B\n\n> SENSITIVE\n");
    const sensitivity = Sensitivity.load(g.config);
    assert.ok(sensitivity.isSensitive("notes/a.md"));
    assert.ok(!sensitivity.isSensitive("notes/b.md"));
  });

  test("generate paths file from markers", () => {
    const b = brain();
    b.configure("[sensitive]\nalways = ['topics/health/']\n");
    b.write("topics/s/README.md", "# S\n\n> SENSITIVE\n");
    b.write("topics/s/a.md", "# A\n");
    b.write("topics/s/deep/b.md", "# B\n");
    b.write("topics/open/README.md", "# O\n");
    b.write("topics/open/secret.md", "# X\n\n> SENSITIVE\n");
    b.write("notes/n.md", "# N\n\n> sensitive\n");
    b.write("notes/plain.md", "# P\n");
    const text = Sensitivity.generate(b.config);
    const entries = splitlines(text).filter((line) => line && !line.startsWith("#"));
    assert.deepEqual(entries, ["notes/n.md", "topics/health/", "topics/open/secret.md", "topics/s/"]);
    assert.ok(text.startsWith("# "));
  });

  test("iter note files skips skill folders and other roots", () => {
    const b = brain();
    b.write("topics/t/normal.md", "# N\n");
    b.write("topics/t/skill/SKILL.md", "# S\n");
    b.write("topics/t/skill/references/x.md", "# X\n");
    b.write("notes/a.md", "# A\n");
    b.write("bookmarks/b.md", "# B\n");
    b.write("archive/old.md", "# O\n");
    b.write("sources/raw.md", "# R\n");
    b.write("topics/t/data.txt", "x\n");
    assert.deepEqual(iterNoteFiles(b.config), ["bookmarks/b.md", "notes/a.md", "topics/t/normal.md"]);
  });

  test("iter note files with renamed folders", () => {
    const b = brain();
    const config = b.configure("[layout]\ntopics = 'areas'\nnotes = 'inbox'\n");
    b.write("areas/x/README.md", "# X\n");
    b.write("inbox/y.md", "# Y\n");
    b.write("topics/ignored.md", "# I\n");
    assert.deepEqual(iterNoteFiles(config), ["areas/x/README.md", "inbox/y.md"]);
    assert.equal(topicOf("areas/x/README.md", config.layout), "areas/x");
    assert.equal(topicOf("inbox/y.md", config.layout), "inbox/y.md");
  });
});
