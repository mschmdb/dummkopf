import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodeHighlighter } from "./highlight.ts";
import { renderPage } from "./markdown.ts";

const links = { anchors: new Map<string, string>(), repoBlob: "https://example.org/" };

test("code blocks get Shiki colors as CSS variables, so they follow the theme tokens", async () => {
  const highlight = await createCodeHighlighter();
  const html = renderPage("x", "X", "```bash\nrcllr write notes/a.md --expected new\n```", links, highlight).html;
  assert.ok(html.includes('class="shiki'), html);
  assert.ok(html.includes("var(--shiki-"), html);
  assert.ok(!/#[0-9a-f]{6}/i.test(html), "no raw colors");
});

test("an unknown language falls back to escaped plain text", async () => {
  const highlight = await createCodeHighlighter();
  const html = renderPage("x", "X", "```nope\n<b>hi</b>\n```", links, highlight).html;
  assert.ok(html.includes("&lt;b&gt;hi&lt;/b&gt;"), html);
});

test("the sshconfig fence uses Shiki's ssh-config grammar", async () => {
  const highlight = await createCodeHighlighter();
  assert.ok(highlight("Host github\n  User git\n", "sshconfig")?.includes("var(--shiki-"));
});
