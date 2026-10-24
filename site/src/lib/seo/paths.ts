// Every page the site prerenders, for the sitemap and the SEO tests.

import { commands, docs } from "../content/index.ts";

export function sitePaths(): string[] {
  return ["/", "/commands", "/changelog", ...docs.map((page) => "/docs/" + page.slug),
    ...commands.map((command) => "/commands/" + command.name)];
}
