/** `check` warns when a file named explicitly in rcllr.toml is missing; defaults stay silent. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { type Brain, fullNote, Sandbox } from "./harness.ts";

const ROUTES_MISSING = "rcllr.toml: Routes file hub-routes.json is missing; routes are off. (warning)";
const ENTITIES_MISSING = "rcllr.toml: Entities file scripts/entities.txt is missing; entity links are off. (warning)";

function brain(extra = ""): Brain {
  const target = new Sandbox().brain("brain", extra);
  target.write("notes/a.md", fullNote({ title: "A" }));
  return target;
}

test("check warns about an explicit routes file that is missing", () => {
  const result = brain('[context]\nroutes_file = "hub-routes.json"\n').run(["check"]);
  assert.equal(result.code, 0, result.err);
  assert.ok(result.out.split("\n").includes(ROUTES_MISSING), result.out);
});

test("check stays silent about the default routes file", () => {
  const result = brain().run(["check"]);
  assert.equal(result.out, "Checked files: 1; status: ok\n");
});

test("check stays silent when the explicit routes file exists", () => {
  const target = brain('[context]\nroutes_file = "hub-routes.json"\n');
  target.write("hub-routes.json", '{"routes": []}\n');
  assert.equal(target.run(["check"]).out, "Checked files: 1; status: ok\n");
});

test("check warns about an explicit entities file that is missing", () => {
  const result = brain('[links]\nentities_file = "scripts/entities.txt"\n').run(["check"]);
  assert.equal(result.code, 0, result.err);
  assert.ok(result.out.split("\n").includes(ENTITIES_MISSING), result.out);
});

test("check stays silent when the explicit entities file exists", () => {
  const target = brain('[links]\nentities_file = "scripts/entities.txt"\n');
  target.write("scripts/entities.txt", "Docker\n");
  assert.equal(target.run(["check"]).out, "Checked files: 1; status: ok\n");
});

test("check JSON lists the missing file as a warning on rcllr.toml", () => {
  const data = JSON.parse(brain('[context]\nroutes_file = "hub-routes.json"\n').run(["check", "--json"]).out);
  assert.equal(data.ok, true);
  assert.deepEqual(data.issues, [{ path: "rcllr.toml", code: "routes-file-missing", severity: "warning",
    message: "Routes file hub-routes.json is missing; routes are off." }]);
});

test("check of single paths leaves the config alone", () => {
  const result = brain('[context]\nroutes_file = "hub-routes.json"\n').run(["check", "notes/a.md"]);
  assert.equal(result.out, "Checked files: 1; status: ok\n");
});

test("context stays quiet about a missing routes file", () => {
  const result = brain('[context]\nroutes_file = "hub-routes.json"\n').run(["context", "test"]);
  assert.equal(result.code, 0);
  assert.equal(result.err, "");
  assert.ok(!result.out.includes("hub-routes.json"), result.out);
});
