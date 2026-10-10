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
