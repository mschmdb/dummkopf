// Facts about the site that several pages share.

export const SITE = {
  name: "rcllr",
  url: "https://rcllr.schmidbauer.dev",
  repo: "https://github.com/mschmdb/rcllr",
  title: "rcllr: Long-term memory for Claude Code and Codex in Git",
  description: "rcllr is a CLI that gives Claude Code and Codex long-term memory as Markdown notes in a plain Git repo. "
    + "No server, no database. Private notes stay hidden.",
} as const;

/** Top-level navigation. Sections that do not exist yet stay out, so no link leads nowhere. */
export const NAV: readonly { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
];
