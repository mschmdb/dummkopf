# Contributing

Thanks for helping. A few rules keep ˈdʊmkɔpf small and safe.

## Setup

You need Node.js 22.18 or newer, pnpm and Git.

```bash
pnpm install
```

Then run the checks before every commit:

```bash
pnpm typecheck && pnpm test && pnpm test:blackbox
```

- `pnpm test` runs the unit tests in `packages/*/test` with `node:test`.
- `pnpm test:blackbox` runs the black-box suite in `packages/cli/test/blackbox` against the TypeScript sources,
  through `packages/cli/dev/dummkopf`. No build needed.
- `pnpm test:blackbox:dist` builds first and tests the built CLI, like CI does.

The black-box suite only talks to a binary, so `DUMMKOPF_BIN=/path/to/dummkopf` runs it against any build.

## Layout

- `packages/core` is the library `@dummkopf/core`: config, frontmatter, the read gate `Access`, search, writes,
  Git sync, hooks and the extras.
- `packages/cli` is the CLI `dummkopf`: argument parsing, output and the command handlers.
- Node runs the TypeScript sources directly. Use only erasable syntax (no enums, no parameter properties) and
  `import type` for types.

## Rules

- Write the test first, then the code. Bug fixes start with a failing test.
- `pnpm typecheck` must pass with the strict settings in `tsconfig.base.json`.
- Keep files under 500 lines. Split a module before it grows past that.
- No runtime dependencies. ˈdʊmkɔpf uses Node's built-in modules only.
- Every user-facing message goes into `packages/core/src/messages.ts`. A cheeky variant must embed `{plain}`,
  so the joke never hides what failed or what to do.
- Generated headings and text heuristics for a language go into `packages/core/src/locale.ts`.
- Never print raw Git output or note text in an error. Errors for sensitive or missing paths look identical.
- No `console.log` debugging in committed code; the CLI writes through `packages/cli/src/io.ts`.
- Commit messages in imperative mood ("Add feature"), one logical change per commit.

## Tests

Tests build real temporary brains and Git repositories, so `git` must be installed. No test touches the
network or your home folder.

## Translations

A new locale needs an entry in `LOCALES` in `packages/core/src/locale.ts` and in `LOCALES` in
`packages/core/src/config.ts`, plus a test that generates an index with it. CLI messages are English only for now.
