/** Windows path spelling in the path helpers, tested on every platform with explicit flags. */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { anchor, asPosix, isAbsolute, join, name, parent, parents, parts, posixSeparators, windowsUnsafe } from "../src/pyos.ts";

describe("windows path helpers", () => {
  test("posixSeparators turns backslashes into slashes only on Windows", () => {
    assert.equal(posixSeparators("C:\\Users\\a\\brain", true), "C:/Users/a/brain");
    assert.equal(posixSeparators("a\\b", false), "a\\b");
  });

  test("a drive letter with a slash anchors a path on Windows only", () => {
    assert.equal(anchor("C:/Users", true), "C:/");
    assert.equal(anchor("c:/", true), "c:/");
    assert.equal(anchor("/srv", true), "/");
    assert.equal(anchor("C:/Users", false), "");
    assert.equal(anchor("C:relative", true), "");
    assert.equal(anchor("topics/a.md", true), "");
    assert.equal(isAbsolute("D:/brain", true), true);
    assert.equal(isAbsolute("D:brain", true), false);
    assert.equal(isAbsolute("D:/brain", false), false);
  });

  test("parts, asPosix, parent and name keep the drive anchor", () => {
    assert.deepEqual(parts("C:/Users//a/./b", true), ["C:/", "Users", "a", "b"]);
    assert.deepEqual(parts("C:/Users/a", false), ["C:", "Users", "a"]);
    assert.equal(asPosix("C:/Users//a/", true), "C:/Users/a");
    assert.equal(asPosix("C:/", true), "C:/");
    assert.equal(parent("C:/Users/a", true), "C:/Users");
    assert.equal(parent("C:/Users", true), "C:/");
    assert.equal(parent("C:/", true), "C:/");
    assert.deepEqual(parents("C:/a/b", true), ["C:/a", "C:/"]);
    assert.equal(name("C:/", true), "");
    assert.equal(name("C:/a/b.md", true), "b.md");
    assert.equal(join("C:/brain", "topics", "a.md"), "C:/brain/topics/a.md");
  });

  test("POSIX results stay unchanged", () => {
    assert.deepEqual(parts("/a//b/./c", false), ["/", "a", "b", "c"]);
    assert.equal(asPosix("/", false), "/");
    assert.equal(parent("/a", false), "/");
    assert.equal(parent("a", false), ".");
    assert.deepEqual(parents("a/b", false), ["a", "."]);
  });

  test("windowsUnsafe rejects stream, device and trailing-dot spellings", () => {
    for (const value of [
      "topics/a.md:secret", "topics/a.md::$DATA", "topics/x:y.md", "notes/a.md.", "notes/a.md ",
      "notes/dir./a.md", "notes/ dir /a.md", "notes/CON.md", "notes/nul", "notes/Com1.md", "notes/lpt9.txt",
      "notes/a<b.md", "notes/a>b.md", "notes/a|b.md", "notes/a?.md", "notes/a*.md", 'notes/a"b.md',
      "notes/a\u0001b.md", "notes/con .md", "notes/AUX.tar.gz", "notes/COM\u00b9.md",
    ]) {
      assert.equal(windowsUnsafe(value, true), true, value);
    }
    for (const value of ["topics/a.md", "notes/console.md", "notes/con-notes.md", "notes/.hidden.md",
      "notes/über.md", "notes/com10.md", "notes/a b.md"]) {
      assert.equal(windowsUnsafe(value, true), false, value);
    }
    assert.equal(windowsUnsafe("topics/a.md:secret", false), false);
  });
});
