// Renders the share image (static/og.png, 1200x630) from HTML with Playwright. The colours come
// from src/tokens.css, the fonts from @fontsource, so the images match the site. Run after a design change:
// `pnpm og-image`. Needs a Chromium for Playwright (`pnpm exec playwright install chromium`).

import { readFileSync } from "node:fs";

import { chromium } from "playwright";

const site = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, site), "utf8");
const font = (path: string): string => readFileSync(new URL("node_modules/@fontsource/" + path, site)).toString("base64");

const tokens = read("src/tokens.css");
// The schmidbauer.dev mark: the <svg> element of the component, without its Svelte class binding.
const component = read("src/lib/components/BrandMark.svelte");
const mark = component
  .slice(component.indexOf("<svg"), component.lastIndexOf("</svg>") + "</svg>".length)
  .replace("class={className}", "");

const STYLE = `
${tokens}
@font-face { font-family: "Plex Sans"; font-weight: 400; src: url(data:font/woff2;base64,${font("ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2")}); }
@font-face { font-family: "Plex Sans"; font-weight: 600; src: url(data:font/woff2;base64,${font("ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2")}); }
@font-face { font-family: "Plex Mono"; font-weight: 600; src: url(data:font/woff2;base64,${font("ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2")}); }
* { margin: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); }
.card { width: 1200px; height: 630px; padding: 88px 96px; display: flex; flex-direction: column; position: relative; }
.card::after { content: ""; position: absolute; inset: 32px; border: 1px solid var(--rule); }
.word { font: 600 104px/1 "Plex Mono"; letter-spacing: -0.03em; }
.rule { width: 120px; height: 6px; background: var(--accent); margin: 40px 0 36px; }
.claim { font: 600 52px/1.15 "Plex Sans"; letter-spacing: -0.01em; max-width: 900px; }
.sub { font: 400 30px/1.3 "Plex Sans"; color: var(--ink-muted); margin-top: 20px; }
.by { position: absolute; right: 96px; bottom: 80px; display: flex; align-items: center; gap: 14px;
  font: 400 24px "Plex Sans"; color: var(--ink-muted); }
.by svg { width: 40px; height: 40px; color: var(--ink); }
`;

const OG = `<div class="card">
  <div class="word">rcllr</div>
  <div class="rule"></div>
  <div class="claim">One memory for all your coding agents</div>
  <div class="sub">What Claude Code learns, Codex knows too.</div>
  <div class="by">${mark}<span>schmidbauer.dev</span></div>
</div>`;

const browser = await chromium.launch();
async function render(html: string, width: number, height: number, out: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><html><head><style>${STYLE}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(out, site).pathname });
  await page.close();
}

await render(OG, 1200, 630, "static/og.png");
await browser.close();
console.log("og-image: static/og.png");
