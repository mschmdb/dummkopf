// The generated content (scripts/content.ts) with types, plus the navigation built from it.

import data from "./generated.json" with { type: "json" };

export interface Heading { depth: number; text: string; id: string }
export interface Page { slug: string; title: string; html: string; headings: Heading[]; text: string }
export interface Option { name: string; help: string; group: string }
export interface Command {
  name: string;
  usage: string;
  purpose: string;
  examples: string[];
  notes: string;
  positionals: { name: string; help: string }[];
  options: Option[];
}

export const version: string = data.version;
export const repo: string = data.repo;
export const docs: Page[] = data.docs;
export const changelog: Page = data.changelog;
export const commands: Command[] = data.commands;
export const globalOptions: { name: string; help: string }[] = data.globalOptions;

export interface NavGroup { title: string; items: { href: string; label: string }[] }

export const navigation: NavGroup[] = [
  { title: "Docs", items: docs.map((page) => ({ href: "/docs/" + page.slug, label: page.title })) },
  {
    title: "Commands",
    items: [{ href: "/commands", label: "All commands" }, ...commands.map((command) => ({
      href: "/commands/" + command.name, label: command.name,
    }))],
  },
  { title: "Project", items: [{ href: "/changelog", label: "Changelog" }] },
];

/** The groups that an option belongs to, in the order the CLI help shows them. */
export const OPTION_GROUPS: { key: string; title: string }[] = [
  { key: "access", title: "Access" }, { key: "output", title: "Output" }, { key: "options", title: "Options" },
  { key: "global", title: "Global" },
];
