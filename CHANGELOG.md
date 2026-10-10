# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
