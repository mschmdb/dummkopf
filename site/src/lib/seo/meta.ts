// Title and description of every page, written by hand. The README headings make poor titles ("Extras",
// "License"), and a description cut from the page text reads like one. The tests fail when a page has no entry.

export interface PageMeta {
  title: string;
  description: string;
}

const PAGES: Record<string, PageMeta> = {
  "/": {
    title: "rcllr: Shared long-term memory for Claude Code and Codex",
    description: "rcllr gives Claude Code and Codex one shared long-term memory. What one agent learns, the other finds: Markdown notes in your own Git repo.",
  },
  "/commands": {
    title: "rcllr commands: CLI reference for agent memory",
    description: "Every rcllr command with its purpose, options and examples, generated from the CLI's own help: context, find, write, ingest, sync and more.",
  },
  "/changelog": {
    title: "rcllr changelog: every release and what changed",
    description: "Every rcllr release and what changed in it, from the first Python version to today's TypeScript CLI for macOS, Linux and Windows.",
  },
  "/docs/why-not-built-in-memory": {
    title: "rcllr vs. built-in memory in Claude Code and Codex",
    description: "When the built-in memory of Claude Code or Codex is enough, and when you need rcllr: one memory across projects, agents and machines.",
  },
  "/docs/quickstart-5-minutes": {
    title: "Install rcllr: quickstart in 5 minutes",
    description: "Install rcllr with npm, create a brain, wire up the hooks and give Claude Code and Codex a shared memory. Every command to type, step by step.",
  },
  "/docs/local-or-synced": {
    title: "Local or synced brain: where rcllr keeps your notes",
    description: "A local rcllr brain never leaves your machine. A synced brain pushes to your private Git remote. What differs between the two modes.",
  },
  "/docs/how-a-brain-looks": {
    title: "How an rcllr brain looks: folders, notes, frontmatter",
    description: "The layout of an rcllr brain: rcllr.toml, AGENTS.md, topic folders, notes with frontmatter and the generated INDEX.md, file by file.",
  },
  "/docs/scope-and-sensitivity": {
    title: "How scopes and sensitive notes work in rcllr",
    description: "Scopes keep work and private notes apart in rcllr answers. Sensitive notes stay hidden from agents until you name the topic yourself.",
  },
  "/docs/commands": {
    title: "rcllr command overview: what each command does",
    description: "Every rcllr command in one table with what it does, from context and find to write, sync and import-memory. A quick map before the reference.",
  },
  "/docs/agent-setup": {
    title: "Set up Claude Code and Codex with rcllr",
    description: "How rcllr wires into Claude Code and Codex: AGENTS.md rules, the CLAUDE.md import, Git and agent hooks, and permissions for headless agents.",
  },
  "/docs/configuration-reference": {
    title: "rcllr.toml configuration reference",
    description: "Every key in rcllr.toml with its default: repo, scopes, hooks, UI tone and extras. Unknown keys are an error, so a typo never passes silently.",
  },
  "/docs/extras": {
    title: "rcllr extras: links, curator and memory import",
    description: "Optional rcllr features: a cross-reference map of topics, a curator scan for stale notes and open loops, and the import of agent memory.",
  },
  "/docs/faq": {
    title: "rcllr FAQ: privacy, work use, speed and Windows",
    description: "Answers about rcllr: notes off GitHub, use at work, where notes go, speed, Windows, two agents writing at once and building your own frontend.",
  },
  "/docs/coming-from-dummkopf": {
    title: "Upgrade from dummkopf to rcllr",
    description: "rcllr was called dummkopf up to version 0.4. Old brains keep working, and rcllr migrate-name moves a brain to the new name with one command.",
  },
  "/docs/coming-from-the-python-version": {
    title: "Upgrade from the Python version of rcllr",
    description: "rcllr releases up to 0.2.0 were written in Python. The TypeScript version reads the same brains, so nothing needs converting. How to switch.",
  },
  "/docs/development": {
    title: "Develop rcllr: code layout and contributing",
    description: "rcllr is a TypeScript monorepo: packages/core holds the library, packages/cli the command line. Where the code lives and how to contribute.",
  },
  "/docs/license": {
    title: "rcllr license: open source under MIT",
    description: "rcllr is open source under the MIT license. Use, change and share it freely, at work and in private, as long as the copyright notice stays.",
  },
  "/commands/context": {
    title: "rcllr context: ask your agent memory a question",
    description: "rcllr context answers a question from your brain. It drops filler words, searches the notes and follows routes. The best entry point for agents.",
  },
  "/commands/find": {
    title: "rcllr find: keyword search in agent memory",
    description: "rcllr find searches titles, aliases, key facts, paths and text of your notes. Use it when you know the keywords, and context for questions.",
  },
  "/commands/read": {
    title: "rcllr read: read a note, line range or section",
    description: "rcllr read prints a note from your brain, a line range or one section, with its revision, so the next write can detect conflicting changes.",
  },
  "/commands/ingest": {
    title: "rcllr ingest: write several notes at once",
    description: "rcllr ingest writes several files atomically from a JSON package. Index, commit and push run automatically, and stale revisions stop the write.",
  },
  "/commands/write": {
    title: "rcllr write: save a note from Markdown",
    description: "rcllr write saves one note from Markdown on stdin. Metadata comes from the frontmatter, and the expected revision guards against lost changes.",
  },
  "/commands/check": {
    title: "rcllr check: validate frontmatter and links",
    description: "rcllr check validates the frontmatter and links of the notes in your brain and reports what is broken, so bad references do not spread.",
  },
  "/commands/sync": {
    title: "rcllr sync: commit, rebase and push the brain",
    description: "rcllr sync commits note changes. In a synced brain it also rebases onto the remote and pushes, so every machine shares the same memory.",
  },
  "/commands/init": {
    title: "rcllr init: create a new brain for your agents",
    description: "rcllr init creates a brain: rcllr.toml, AGENTS.md, CLAUDE.md, INDEX.md and folders. Without --remote the brain stays local and never pushes.",
  },
  "/commands/install": {
    title: "rcllr install: hooks for Git, Claude Code, Codex",
    description: "rcllr install adds the Git pre-commit hook and the Claude Code and Codex hooks, including permission rules for headless agents.",
  },
  "/commands/import-memory": {
    title: "rcllr import-memory: bring in built-in memory",
    description: "rcllr import-memory mirrors the built-in memory of Claude Code and Codex into your brain, so each agent can search what the other remembered.",
  },
  "/commands/migrate-name": {
    title: "rcllr migrate-name: move a brain from dummkopf",
    description: "rcllr migrate-name lists the steps to move a brain from the old name dummkopf to rcllr. With --apply it carries them out; notes stay untouched.",
  },
  "/commands/hook": {
    title: "rcllr hook: entry point for Git and agent hooks",
    description: "rcllr hook runs from the Git pre-commit hook and the Claude Code and Codex hooks. It regenerates indexes, syncs notes and never blocks.",
  },
  "/commands/meta": {
    title: "rcllr meta: maintain frontmatter and indexes",
    description: "rcllr meta adds missing frontmatter, rebuilds INDEX.md and README tables, and reports notes without a date, stale notes and missing key facts.",
  },
  "/commands/links": {
    title: "rcllr links: map the links between your topics",
    description: "rcllr links builds a cross-reference map of topics that share a month or an entity, in LINKS.md. Sensitive notes stay out of the map.",
  },
  "/commands/curator": {
    title: "rcllr curator: find stale notes and open loops",
    description: "rcllr curator scans your brain for open loops, quiet topics, conflicting dates and stale notes. With --prompt it prints a weekly LLM prompt.",
  },
};

export function metaFor(path: string): PageMeta {
  const meta = PAGES[path];
  if (!meta) throw new Error(`${path} has no SEO entry in src/lib/seo/meta.ts`);
  return meta;
}
