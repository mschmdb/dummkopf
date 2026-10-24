// Text of the landing page. It exists only here: the docs come from the README, this page speaks to people who
// have not read it yet. Facts must match the README; numbers come from its FAQ.

/** How a note travels from one agent to the other. A real sequence, so the steps are numbered. */
export const STEPS: readonly { title: string; text: string; code?: string }[] = [
  {
    title: "Claude Code learns something",
    text: "It writes a note to your brain. What Claude Code keeps in its own memory, rcllr imports as well.",
  },
  {
    title: "A hook commits it",
    text: "The brain is a Git repository. With a private remote, the hook pushes the note to your other machines.",
  },
  {
    title: "Codex finds it",
    text: "In its next session, Codex asks the brain before it answers, and gets the note.",
    code: 'rcllr context "How does the deploy work?"',
  },
];

export const FEATURES: readonly { title: string; text: string }[] = [
  {
    title: "Plain Markdown in Git",
    text: "No server, no database, no account. Your notes are Markdown files in a Git repository you own and can read without rcllr.",
  },
  {
    title: "On every machine, or on none",
    text: "Hooks commit every change. With a private remote they push it too, so your memory follows you. Without one, nothing leaves your machine.",
  },
  {
    title: "Work and private stay apart",
    text: "Scopes keep a work answer free of private notes. Sensitive notes stay hidden from agents until you name the topic yourself.",
  },
  {
    title: "Brings what they already remember",
    text: "rcllr imports what each agent remembers on its own, so the other one can search it too.",
  },
  {
    title: "Fast enough to ask every time",
    text: "A search takes about 0.13 seconds in a brain of 200 notes, so agents can check their memory before every answer.",
  },
  {
    title: "Open to the next agent",
    text: "Any agent that can run a shell command can read and write the brain. rcllr ships hooks for Claude Code and Codex.",
  },
];

export const NEEDS: readonly string[] = [
  "A terminal on macOS, Linux or Windows (with Git for Windows)",
  "Node.js 22.18 or newer and Git",
  "A coding agent such as Claude Code or Codex",
];

export const FAQ: readonly { question: string; answer: string; link?: { href: string; label: string } }[] = [
  {
    question: "How do I give Claude Code long-term memory?",
    answer: "Install rcllr, create a brain with `rcllr init` and run `rcllr install` inside it. Then tell Claude Code in your global CLAUDE.md to ask the brain with `rcllr context` before it answers questions about earlier work.",
    link: { href: "/docs/quickstart-5-minutes", label: "Quickstart" },
  },
  {
    question: "Can Claude Code and Codex share the same memory?",
    answer: "Yes, that is what rcllr is for. Both call the same CLI on the same brain, and the hooks keep it in sync. Codex reads the rules from AGENTS.md, Claude Code from CLAUDE.md, which points to the same file.",
    link: { href: "/docs/agent-setup", label: "Agent setup" },
  },
  {
    question: "How is rcllr different from CLAUDE.md, AGENTS.md or built-in memory?",
    answer: "CLAUDE.md and AGENTS.md hold rules that load into every session. Built-in memory works per project, for one agent, on one machine. rcllr is searchable knowledge across projects, agents and machines. If you work on one project on one machine, the agent's own memory is enough.",
    link: { href: "/docs/why-not-built-in-memory", label: "Why not built-in memory?" },
  },
  {
    question: "How is it different from memory servers like mem0 or claude-mem?",
    answer: "rcllr runs no server and keeps no database. A note is a Markdown file in your own Git repository, so you can read, edit and review every line of your agents' memory.",
  },
  {
    question: "Can I keep private notes away from my agent?",
    answer: "Yes. Mark a note or a folder as sensitive and agents never see it, not even in search results, unless you name the topic in your prompt. Scopes keep work and private apart.",
    link: { href: "/docs/scope-and-sensitivity", label: "Scope and sensitivity" },
  },
  {
    question: "Does my memory leave my computer?",
    answer: "Only if you want it to. A synced brain pushes to the private Git remote you choose. A local brain never talks to any remote.",
    link: { href: "/docs/local-or-synced", label: "Local or synced" },
  },
  {
    question: "Can I import the memory my agents already have?",
    answer: "Yes. `rcllr import-memory` mirrors what your agents remember on their own into your brain, in a scope you choose, and keeps it up to date after each session.",
    link: { href: "/docs/extras", label: "Extras" },
  },
];
