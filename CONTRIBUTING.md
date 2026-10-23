# Contributing

Thanks for helping. A few rules keep rcllr small and safe.

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
  through `packages/cli/dev/rcllr`. No build needed.
- `pnpm test:blackbox:dist` builds first and tests the built CLI, like CI does.

The black-box suite only talks to a binary, so `RCLLR_BIN=/path/to/rcllr` runs it against any build.

When you touch `packages/core/src/toml.ts`, also run `pnpm test:toml`. It fetches a pinned release of the
official [toml-test](https://github.com/toml-lang/toml-test) suite into `.cache/` (needs network and Git) and
runs the parser against its TOML 1.0 cases. Cases rcllr leaves out on purpose are listed with a reason in
`packages/core/test/toml-test-skip.txt`; a listed case that starts to pass fails the run. `pnpm test` skips
the suite unless `TOML_TEST_DIR` points at a toml-test checkout.

## Benchmark

`pnpm bench` builds the CLI, generates two synthetic local brains (200 and 2000 notes, fixed seed) in a
temporary folder and runs `context`, `find` and `read` ten times each. It prints the median and the min–max
in milliseconds next to a bare `node -e ""` start, plus the Node version, OS and CPU. `--no-build` reuses the
existing `dist/`, `--runs N` changes the number of runs: `pnpm bench --no-build --runs 20`. Compare numbers
only from the same machine.

## Layout

- `packages/core` is the library `@rcllr/core`: config, frontmatter, the read gate `Access`, search, writes,
  Git sync, hooks and the extras.
- `packages/cli` is the CLI `rcllr`: argument parsing, output and the command handlers.
- Node runs the TypeScript sources directly. Use only erasable syntax (no enums, no parameter properties) and
  `import type` for types.

## Rules

- Write the test first, then the code. Bug fixes start with a failing test.
- `pnpm typecheck` must pass with the strict settings in `tsconfig.base.json`.
- Keep files under 500 lines. Split a module before it grows past that.
- No runtime dependencies. rcllr uses Node's built-in modules only.
- Every user-facing message goes into `packages/core/src/messages.ts`. A cheeky variant must embed `{plain}`,
  so the joke never hides what failed or what to do.
- Generated headings and text heuristics for a language go into `packages/core/src/locale.ts`.
- Never print raw Git output or note text in an error. Errors for sensitive or missing paths look identical.
- No `console.log` debugging in committed code; the CLI writes through `packages/cli/src/io.ts`.
- Commit messages in imperative mood ("Add feature"), one logical change per commit.

## Tests

Tests build real temporary brains and Git repositories, so `git` must be installed. No test touches the
network or your home folder.

## Releases

`pnpm pack:check` packs both packages like `pnpm publish`, installs the tarballs with npm into a temporary
folder and runs the installed CLI. It also lints both tarballs with [publint](https://publint.dev) and checks
the types of `@rcllr/core` with [arethetypeswrong](https://arethetypeswrong.github.io) (`--profile esm-only`,
since both packages are ESM-only). CI runs it on every push. The `source` condition in `@rcllr/core`'s
`exports` points into `src/` for the dev binary; `publishConfig.exports` drops it from the published manifest.

A release goes out from GitHub Actions (`.github/workflows/release.yml`), never from a laptop. It uses npm
Trusted Publishing: GitHub proves the workflow's identity to npm, so no npm token exists. On npmjs.com, both
`rcllr` and `@rcllr/core` name `mschmdb/dummkopf` and `release.yml` as their Trusted Publisher.

1. Set the same version in `packages/core/package.json`, `packages/cli/package.json` and `VERSION` in
   `packages/core/src/index.ts`, and move the changelog entries from "Unreleased" to that version.
2. Merge, then tag the commit: `git tag v0.5.0 && git push origin v0.5.0`.

The `build` job checks that the tag matches both versions, runs all checks and packs the tarballs. pnpm turns
the `workspace:*` dependency into the exact core version. The `publish` job then stages only those tarballs
on npm, core first, with provenance. It runs no project code. Last, the `github-release` job creates the GitHub
release: its text is the version's section of `CHANGELOG.md` (`scripts/release-notes.sh`), and it attaches
both tarballs. A tag without a changelog section fails in the `build` job, before anything is published.
The Trusted Publishers allow only `npm stage publish`, so every release waits on npmjs.com under "Staged
Packages" until a maintainer approves it with 2FA, core first (or `npm stage approve <stage-id>`). The GitHub
release appears right away; the npm versions follow once approved.

## Translations

A new locale needs an entry in `LOCALES` in `packages/core/src/locale.ts` and in `LOCALES` in
`packages/core/src/config.ts`, plus a test that generates an index with it. CLI messages are English only for now.
