# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-11

### Added

- dummkopf is written in TypeScript now: the library `@dummkopf/core` and the CLI `dummkopf` for Node 22.18+.
  Brains, config, frontmatter and hooks stay the same; output matches the Python release byte for byte,
  except `--help` and usage errors (see Changed).
- Local brains: without `repo.remote` dummkopf commits but never fetches, pushes or checks a remote.
  `dummkopf init` without `--remote` creates one. Only `schema_version` is required in `dummkopf.toml` now.
- The black-box suite runs on `node:test` (`packages/cli/test/blackbox`), against any build via `DUMMKOPF_BIN`.
- `pnpm test:toml` checks the TOML parser against the official toml-test suite (TOML 1.0 cases, pinned
  release, fetched into `.cache/`). CI runs it once per push.
- Release setup for npm: package metadata, `prepublishOnly` builds, `pnpm pack:check` (pack, install and run
  the tarballs, also in CI) and a tag-triggered publish workflow with provenance. Nothing is published yet.

### Changed

- `context` no longer prints "Partial match": a whole question almost never matches every word. `find` keeps
  the line, and the JSON `match` value stays the same.
- `find` and `context` rank curator reports below the notes they summarize: their score counts
  `search.weights.curator_report_percent` (default 25). A query naming the curator lifts the cut.
- `check` prints issues as `path:line: message (severity)` when it knows the line, so editors can jump there.
  It still never names a link target.
- `check` warns when `context.routes_file` or `links.entities_file` is set in `dummkopf.toml` but missing.
  The default names stay silent, and `context` never warns.
- The pre-commit hook prints one summary line instead of the full `meta report`, and nothing without findings.
- Shorter `--help` without argparse's layout (#21). `dummkopf --help` lists the commands with one line each,
  grouped as Read, Write, Setup and maintenance, and Extras. `dummkopf <command> --help` shows a one-line
  purpose, the examples, then the options grouped as Access, Output and the command's own options, one per
  line, wrapped at 100 columns. Usage errors print the usage line, a short error naming the argument and a
  pointer to `--help`; they still exit with code 2. Parsing is unchanged.

### Removed

- The Python release (`src/`, `pyproject.toml`, `uv.lock`) and its pytest suite. Install with Node instead; see
  "Coming from the Python version" in the README.

### Fixed

- `dummkopf.toml` with an impossible date or time (`2006-02-30`, `24:00:00`, offset `+24:00`) is rejected
  as unreadable instead of accepted.
- An integer beyond 2^53 in `dummkopf.toml` is rejected instead of silently rounded.

### Security

- A new `README.md` in a folder hidden from the writer answers `topic_unavailable`, like a missing topic. Before,
  it answered `scope_change` only when hidden notes sat below it.
- A link to a non-Markdown file listed in `.sensitive-paths` answers `link-unavailable`, like a missing file.
  Before, the check looked up the stand-in path `<file>.md` and let the link pass.
- The pre-commit hook no longer prints sensitive paths with unstaged edits. It names only their count.

### Documentation

- The README states the "path is taken" signal for writers in full: `path_denied` for a taken path,
  `topic_unavailable` for a free path in a hidden topic. A black-box test pins it.

## [0.2.0] - 2026-10-10

### Added

- `[links] allow_outside`: folders outside the note folders that notes may link to, e.g. `archive`.
- `dummkopf install --replace-command TEXT` removes old hook commands before adding its own.
- Security policy, Dependabot, CODEOWNERS, issue and PR templates.

### Changed

- A broken routes file names the file, the route number and the problem.
- `init --remote` no longer asks to set the remote again. The README explains how to put `dummkopf` on PATH.

### Security

- Link targets are normalized without following symlinks, so a symlink answers like any unavailable target.

## [0.1.0] - 2026-10-10

### Added

- CLI `dummkopf` with alias `dk`: `context`, `find`, `read`, `write`, `ingest`, `check`, `sync`, `init`,
  `install`, `hook`, `meta`, `links`, `curator`.
- `dummkopf.toml` with validated sections for repo, layout, scopes, status, sensitivity, frontmatter keys,
  locale, tone, limits, search weights, routes and extras. Unknown keys are rejected.
- Scope inheritance from topic READMEs, scope link barriers, and sensitivity through markers, folder READMEs,
  a generated paths list and always-sensitive prefixes.
- Atomic multi-file writes with revision checks and rollback; exit code 2 for rejected calls and 3 for
  saved-but-not-synced writes.
- One Git sync path with a process lock for the CLI, the Claude Code hook and the Codex hook.
- Pre-commit hook that regenerates the sensitive-paths list, completes frontmatter and rebuilds indexes.
- Locales `en` and `de` for generated headings and text heuristics; `cheeky` and `plain` tones.
- Extras: links map, curator scan with weekly LLM prompt, Codex hook.
- English agent rules (`AGENTS.md`) rendered from the brain configuration.
- `--scope` for `links`, `curator` and `meta report`; routes open sensitive plans only with `allow_sensitive`.

### Security

- Hidden notes answer like missing ones in `read`, `find`, `context`, link checks and new files in a topic.
- Paths must match the on-disk spelling; listed paths compare case-insensitively and in one Unicode form.
- Symlinks never count as notes, and generated files are never read or written through symlinks.
- Markers count with BOM, indentation, tabs and CR-only line breaks.
- A README may not shift the scope of notes below it; README tables list only notes of their own scope.
- Link regexes are bounded; malformed URLs are reported instead of crashing.
- The pre-commit hook never stages files with unstaged edits and never rewrites `sources/` or unreadable notes.
