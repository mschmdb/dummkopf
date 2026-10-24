// Syntax highlighting at build time with Shiki. The css-variables theme emits var(--shiki-…) instead of colors;
// app.css maps those onto the design tokens, so code follows light and dark mode and the contrast test covers it.

import { createCssVariablesTheme, createHighlighter } from "shiki";

/** Highlighted HTML for a code block, or null when the language is unknown. */
export type Highlight = (code: string, lang: string) => string | null;

const LANGS = ["bash", "json", "markdown", "toml", "ssh-config", "typescript", "yaml"] as const;
/** Fence names in the README that Shiki spells differently. */
const ALIASES: Record<string, string> = { sh: "bash", shell: "bash", sshconfig: "ssh-config", ts: "typescript" };

export async function createCodeHighlighter(): Promise<Highlight> {
  const theme = createCssVariablesTheme({ name: "tokens", variablePrefix: "--shiki-" });
  const shiki = await createHighlighter({ themes: [theme], langs: [...LANGS] });
  return (code, lang) => {
    const name = ALIASES[lang] ?? lang;
    if (!(LANGS as readonly string[]).includes(name)) return null;
    return shiki.codeToHtml(code, { lang: name, theme: "tokens" });
  };
}
