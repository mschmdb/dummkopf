# Contributing

Thanks for helping. A few rules keep ˈdʊmkɔpf small and safe.

## Setup

The project uses [uv](https://docs.astral.sh/uv/) for everything: environment, lock file, tools.

```bash
uv sync
```

Then run the checks before every commit:

```bash
uv run pytest && uv run mypy && uv run ruff check .
```

Add dependencies with `uv add` (runtime) or `uv add --dev` (tooling) and commit `uv.lock`.

## TypeScript port

`packages/core` (library) and `packages/cli` (CLI) hold the TypeScript port. It needs Node 22.18+ and pnpm.

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm test:blackbox
```

`pnpm test:blackbox` runs `tests/blackbox` against the TypeScript sources through `packages/cli/dev/dummkopf`;
`pnpm test:blackbox:dist` builds first and tests the built CLI. The Python code stays the reference until the
switch: a change in behavior lands in both, and the black-box suite proves they agree.

To compare both on a real brain without touching it:

```bash
node scripts/compare-brain.ts ~/brain
```

The script works on two copies in a temporary folder and prints where the report lives. The report contains note
text; delete it when done.

## Rules

- Write the test first, then the code. Bug fixes start with a failing test.
- Type hints everywhere; `mypy --strict` must pass.
- Keep files under 500 lines. Split a module before it grows past that.
- No new runtime dependencies. ˈdʊmkɔpf uses the Python standard library only.
- Every user-facing message goes into `src/dummkopf/messages.py`. A cheeky variant must embed `{plain}`,
  so the joke never hides what failed or what to do.
- Generated headings and text heuristics for a language go into `src/dummkopf/locale.py`.
- Never print raw Git output or note text in an error. Errors for sensitive or missing paths look identical.
- No `print` debugging in committed code.
- Commit messages in imperative mood ("Add feature"), one logical change per commit.

## Tests

Tests build real temporary brains and Git repositories, so `git` must be installed. No test touches the
network or your home folder.

## Translations

A new locale needs an entry in `LOCALES` in `locale.py` and in `config.LOCALES`, plus a test that generates
an index with it. CLI messages are English only for now.
