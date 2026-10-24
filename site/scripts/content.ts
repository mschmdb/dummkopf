// Builds src/lib/content/generated.json from the repository: README sections, CHANGELOG, the CLI help and the
// version. The site never keeps a second copy of these texts; this file is regenerated on every dev and build run.

import { readFileSync, writeFileSync } from "node:fs";

import { parser } from "../../packages/cli/src/main.ts";
import { optionName, positionalName, usage } from "../../packages/cli/src/help.ts";
import { createCodeHighlighter } from "../src/lib/content/highlight.ts";
import { type LinkMap, renderPage, slugify, splitSections } from "../src/lib/content/markdown.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const REPO = "https://github.com/mschmdb/rcllr";

const readme = splitSections(read("README.md"));

// Every README heading points to the doc page that holds it, so #anchors survive the split into pages.
const anchors = new Map<string, string>();
for (const section of readme.sections) {
  anchors.set(section.slug, "/docs/" + section.slug);
  let fenced = false;
  for (const line of section.markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && /^#{3,6} (.+)$/.exec(line);
    if (heading) anchors.set(slugify(heading[1]!), "/docs/" + section.slug);
  }
}
const links: LinkMap = { anchors, repoBlob: REPO + "/blob/main/" };
const highlight = await createCodeHighlighter();
const bash = (code: string): string => highlight(code, "bash")!;

const docs = readme.sections.map((section) => renderPage(section.slug, section.title, section.markdown, links, highlight));
const changelog = renderPage("changelog", "Changelog", read("CHANGELOG.md").replace(/^# .*\n/, ""), links, highlight);

const pages = parser().helpPages();
const commands = pages.slice(1).map((page) => {
  const name = page.prog.split(" ").slice(1).join(" ");
  return {
    name,
    usage: usage(page),
    usageHtml: bash(usage(page).replace(/^usage: /, "")),
    purpose: page.purpose,
    examples: page.examples ? page.examples.split("\n") : [],
    examplesHtml: page.examples ? bash(page.examples) : "",
    notes: page.notes,
    positionals: page.positionals.map((item) => ({ name: positionalName(item), help: item.help })),
    options: page.options.map((item) => ({ name: optionName(item), help: item.help, group: item.group })),
  };
});
const globalOptions = pages[0]!.options.map((item) => ({ name: optionName(item), help: item.help }));

const version = JSON.parse(read("packages/cli/package.json")).version as string;

writeFileSync(new URL("../src/lib/content/generated.json", import.meta.url), JSON.stringify({
  version, repo: REPO, docs, changelog, commands, globalOptions,
}, null, 1) + "\n");
console.log(`content: ${docs.length} doc pages, ${commands.length} commands, version ${version}`);
