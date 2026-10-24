import assert from "node:assert/strict";
import { test } from "node:test";

import { metaFor } from "./meta.ts";
import { sitePaths } from "./paths.ts";

test("every page has its own title and description", () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of sitePaths()) {
    const meta = metaFor(path);
    titles.add(meta.title);
    descriptions.add(meta.description);
  }
  assert.equal(titles.size, sitePaths().length, "titles repeat");
  assert.equal(descriptions.size, sitePaths().length, "descriptions repeat");
});

test("titles name rcllr and fit a search result", () => {
  for (const path of sitePaths()) {
    const { title } = metaFor(path);
    assert.match(title, /rcllr/, path);
    assert.ok(title.length >= 25 && title.length <= 60, `${path}: title has ${title.length} characters`);
  }
});

test("descriptions fit a search result", () => {
  for (const path of sitePaths()) {
    const { description } = metaFor(path);
    assert.ok(description.length >= 100 && description.length <= 160, `${path}: description has ${description.length} characters`);
  }
});

test("a page without an entry fails loudly instead of shipping a weak title", () => {
  assert.throws(() => metaFor("/docs/does-not-exist"), /no SEO entry/);
});
