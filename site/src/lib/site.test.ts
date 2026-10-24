import assert from "node:assert/strict";
import { test } from "node:test";

import { currentFor } from "./site.ts";

test("the exact page is the current page", () => {
  assert.equal(currentFor("/changelog", "/changelog"), "page");
  assert.equal(currentFor("/commands", "/commands"), "page");
});

test("a page inside a section marks the section's link as current, not as the page", () => {
  assert.equal(currentFor("/docs/agent-setup", "/docs/quickstart-5-minutes"), "true");
  assert.equal(currentFor("/commands/write", "/commands"), "true");
});

test("other sections and the home page are not current", () => {
  assert.equal(currentFor("/commands/write", "/changelog"), undefined);
  assert.equal(currentFor("/", "/docs/quickstart-5-minutes"), undefined);
  assert.equal(currentFor("/commandsx", "/commands"), undefined);
});
