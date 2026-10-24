import { commands, docs } from "#lib/content/index.js";
import { SITE } from "#lib/site.js";

export const prerender = true;

export function GET() {
  const paths = ["", "/commands", "/changelog", ...docs.map((page) => "/docs/" + page.slug),
    ...commands.map((command) => "/commands/" + command.name)];
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + paths.map((path) => `  <url><loc>${SITE.url}${path}</loc></url>`).join("\n") + "\n</urlset>\n";
  return new Response(body, { headers: { "content-type": "application/xml" } });
}
