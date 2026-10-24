import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPage, rewriteLink, slugify, splitSections } from "./markdown.ts";

const links = {
  anchors: new Map([["local-or-synced", "/docs/local-or-synced"], ["headless-agents", "/docs/agent-setup"]]),
  repoBlob: "https://github.com/me/repo/blob/main/",
};

test("slugs follow GitHub's anchors", () => {
  assert.equal(slugify("Why not built-in memory?"), "why-not-built-in-memory");
  assert.equal(slugify("Quickstart (5 minutes)"), "quickstart-5-minutes");
  assert.equal(slugify("Coming from dummkopf"), "coming-from-dummkopf");
});

test("the README splits at ## headings, never inside a code fence", () => {
  const { intro, sections } = splitSections("# Tool\n\nIntro.\n\n## One\n\nA\n\n```md\n## not a heading\n```\n\n## Two\n\nB\n");
  assert.equal(intro, "# Tool\n\nIntro.");
  assert.deepEqual(sections.map((section) => section.slug), ["one", "two"]);
  assert.ok(sections[0]!.markdown.includes("## not a heading"));
});

test("links to README sections go to their doc page, files go to GitHub, URLs stay", () => {
  assert.equal(rewriteLink("#local-or-synced", links), "/docs/local-or-synced");
  assert.equal(rewriteLink("#headless-agents", links), "/docs/agent-setup#headless-agents");
  assert.equal(rewriteLink("CONTRIBUTING.md", links), "https://github.com/me/repo/blob/main/CONTRIBUTING.md");
  assert.equal(rewriteLink("https://example.org", links), "https://example.org");
  assert.equal(rewriteLink("#unknown", links), "#unknown");
});

test("a page collects its headings with ids and links rewritten", () => {
  const page = renderPage("x", "X", "### Headless agents\n\nSee [sync](#local-or-synced).", links);
  assert.deepEqual(page.headings, [{ depth: 3, text: "Headless agents", id: "headless-agents" }]);
  assert.ok(page.html.includes('<h3 id="headless-agents">'));
  assert.ok(page.html.includes('href="/docs/local-or-synced"'));
  assert.equal(page.text, "Headless agents See sync.");
});

test("plain text unescapes entities once and leaves no tags behind", () => {
  assert.equal(renderPage("x", "X", "Write `&lt;` for <.", links).text, "Write &lt; for <.");
  assert.equal(renderPage("x", "X", "A <ifr<iframe>ame> b", links).text.includes("<iframe"), false);
});
