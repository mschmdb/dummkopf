// llms.txt (https://llmstxt.org): what rcllr is and where each page lives, as plain text.

import { commands, docs, version } from "#lib/content/index.js";
import { metaFor } from "#lib/seo/meta.js";
import { SITE } from "#lib/site.js";

export const prerender = true;

export function GET() {
  const lines = [
    "# rcllr",
    "",
    "> " + SITE.description,
    "",
    `Current version: ${version}. Source: ${SITE.repo}`,
    "",
    "## Docs",
    ...docs.map((page) => `- [${page.title}](${SITE.url}/docs/${page.slug}): ${metaFor("/docs/" + page.slug).description}`),
    "",
    "## Commands",
    ...commands.map((command) => `- [rcllr ${command.name}](${SITE.url}/commands/${command.name}): ${metaFor("/commands/" + command.name).description}`),
    "",
    "## Optional",
    `- [Changelog](${SITE.url}/changelog): ${metaFor("/changelog").description}`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
