// Fails when a command, a doc page or the changelog has no built page, or llms.txt and the sitemap are missing.

import { existsSync, readFileSync } from "node:fs";

const content = JSON.parse(readFileSync(new URL("../src/lib/content/generated.json", import.meta.url), "utf8"));
const build = new URL("../build/", import.meta.url);
const expected = ["index.html", "commands.html", "changelog.html", "llms.txt", "sitemap.xml",
  ...content.docs.map((page: { slug: string }) => "docs/" + page.slug + ".html"),
  ...content.commands.map((command: { name: string }) => "commands/" + command.name + ".html")];
const missing = expected.filter((file) => !existsSync(new URL(file, build)));
if (missing.length) {
  console.error("Pages missing from the build:\n" + missing.map((file) => "  " + file).join("\n"));
  process.exit(1);
}
console.log(`build complete: ${expected.length} files`);
