// llms.txt (https://llmstxt.org): what rcllr is and where each page lives, as plain text.

import { commands, docs, version } from "#lib/content/index.js";
import { SITE } from "#lib/site.js";

export const prerender = true;

/** The first sentence, so no description ends in the middle of a word. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

export function GET() {
  const lines = [
    "# rcllr",
    "",
    "> " + SITE.description,
    "",
    `Current version: ${version}. Source: ${SITE.repo}`,
    "",
    "## Docs",
    ...docs.map((page) => `- [${page.title}](${SITE.url}/docs/${page.slug}): ${firstSentence(page.text)}`),
    "",
    "## Commands",
    ...commands.map((command) => `- [rcllr ${command.name}](${SITE.url}/commands/${command.name}): ${command.purpose}`),
    "",
    "## Optional",
    `- [Changelog](${SITE.url}/changelog)`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
