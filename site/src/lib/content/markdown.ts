// Turns the repo's Markdown (README, CHANGELOG) into site pages. Pure functions; scripts/content.ts does the I/O.

import { Marked, type Tokens } from "marked";

import type { Highlight } from "./highlight.ts";

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface Section {
  slug: string;
  title: string;
  markdown: string;
}

export interface RenderedPage {
  slug: string;
  title: string;
  html: string;
  /** H2 and H3 inside the page, for its table of contents. */
  headings: Heading[];
  /** Plain text for search and llms.txt. */
  text: string;
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces as hyphens. */
export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
}

/** The README split at its `## ` headings, outside code fences. Text before the first one is the intro. */
export function splitSections(markdown: string): { intro: string; sections: Section[] } {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const intro: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && /^## (.+)$/.exec(line);
    if (heading) {
      if (current) sections.push({ slug: slugify(current.title), title: current.title, markdown: current.lines.join("\n").trim() });
      current = { title: heading[1]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push({ slug: slugify(current.title), title: current.title, markdown: current.lines.join("\n").trim() });
  return { intro: intro.join("\n").trim(), sections };
}

export interface LinkMap {
  /** README heading anchor to the site path that holds it, e.g. `local-or-synced` to `/docs/local-or-synced`. */
  anchors: ReadonlyMap<string, string>;
  /** Base for links to repository files, e.g. `https://github.com/me/repo/blob/main/`. */
  repoBlob: string;
}

/** Where a link from the README points on the site: section anchors to doc pages, files to GitHub. */
export function rewriteLink(href: string, links: LinkMap): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("#")) {
    const anchor = href.slice(1);
    const page = links.anchors.get(anchor);
    if (!page) return href;
    return page.endsWith("/" + anchor) ? page : page + "#" + anchor;
  }
  return links.repoBlob + href.replace(/^\.\//, "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plain(html: string): string {
  // Inline tags vanish without a gap ("<code>x</code>." stays "x."); block tags become spaces. Strip until
  // nothing changes, so a nested "<ifr<iframe>ame>" cannot leave a tag behind.
  let text = html;
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/<\/?(?:a|code|strong|em|b|i)\b[^>]*>/g, "").replace(/<[^>]+>/g, " ");
  }
  // &amp; last, so "&amp;lt;" becomes "&lt;" and not "<".
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** Render one page. Headings get GitHub-style ids; the page title is not repeated as a heading. */
export function renderPage(slug: string, title: string, markdown: string, links: LinkMap, highlight?: Highlight): RenderedPage {
  const headings: Heading[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const id = slugify(plain(inner));
        if (token.depth <= 3) headings.push({ depth: token.depth, text: plain(inner), id });
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        const highlighted = highlight?.(token.text, (token.lang ?? "").trim().split(/\s/)[0]!);
        if (highlighted) return highlighted + "\n";
        return "<pre><code>" + escapeHtml(token.text) + "</code></pre>\n";
      },
      link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        const href = rewriteLink(token.href, links).replace(/"/g, "&quot;");
        return `<a href="${href}">${inner}</a>`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  return { slug, title, html, headings, text: plain(html) };
}
