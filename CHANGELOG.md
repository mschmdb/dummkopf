# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- A sync that fails because the remote refuses the login (SSH key, host key or HTTPS credentials) now says so,
  instead of only "Git step failed". Git's own output still never leaves the process. After `write` or `ingest`,
  `--json` reports the reason in `syncError`.
- `dummkopf install` adds permission rules to `.claude/settings.json`: `allow` for `dummkopf` and `dk`, `ask` for
  any call with `--allow-sensitive`. Headless agents (`claude -p`, the GitHub Action) can call dummkopf without
  a prompt, but never open a sensitive note.
- `curator_keep: <date>` in a note's frontmatter keeps it out of the `curator` scan until that day, so a "keep"
  verdict stops coming back every week. On a topic README it also hides the quiet topic. `curator.keep_key`
  renames the field.

### Changed

- The `curator` Markdown report lists each note once, under its first finding, and names its other findings on
  the same line. `--json` is unchanged.
- The curator prompt picks striking links from entity links and collisions, skips links that only share a
  month, and asks for fresh reasons instead of copying earlier reports.
- A README in a sub-folder of a topic gets its own file table. The topic README lists that sub-folder README
  instead of the files below it.

- `curator` reports a date conflict only when the text names a newer "as of" day than the note's own date
  (`updated`, else the Git date). A dated history up to that day is no conflict anymore. Each entry in
  `--json` gains `updated`.

### Fixed

- Two machines that sync at the same moment no longer report "Git step failed: push". A push that loses the
  race fetches, rebases and pushes again, up to three times.
- `curator` compares "as of" dates by calendar day, so `2026-09-25` and `25.09.2026` are the same date.

## [0.4.1] - 2026-10-11

### Added

- `dummkopf --version` prints the version and exits 0. Before, it failed with `missing <command>`.

### Fixed

- A rejected `write` or `ingest` names the line in the content the agent sent. Before, it counted in the note
  after `dummkopf` had added missing frontmatter keys and the sensitive marker.
  Lines in `append` and `replace` still count in the stored note.

### Documentation

- The README FAQ states the speed, measured with `pnpm bench` on an Apple M5 Pro.

## [0.4.0] - 2026-10-11

### Added

- `pnpm bench` times `context`, `find` and `read` on generated brains of 200 and 2000 notes.
- A wikilink that matches several readable notes reports `link-ambiguous` and names up to three of them
  (`candidates` in `--json`). Before, it said "missing or not released". Hidden notes are never named or
  counted.
- `write` and `ingest` take `--message TEXT`, a one-line commit subject of at most 200 characters, in place of
  `repo.commit_message`. An empty or multi-line message is rejected with exit code 2 before anything is saved.
- `[hooks] report` sets when the pre-commit hook prints its report line: `changes` (default), `always` or
  `never`.

### Changed

- `pnpm pack:check` also lints both tarballs with publint and checks the types of `@dummkopf/core` with
  arethetypeswrong.
- `write`, `ingest`, `sync` and the agent hooks commit only the note folders (`topics/`, `notes/`,
  `bookmarks/`, `sources/`, `archive/`) and the generated files (`INDEX.md`, `.sensitive-paths`,
  `links.output`, `curator.report_dir`), plus the routes and entities files named in `dummkopf.toml`.
  Changes to `dummkopf.toml`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/` and other files stay
  uncommitted for a human commit, and no longer block a write.
  `repo.sync_exclude` still keeps paths inside those folders out.
- The pre-commit hook prints its `Report: ...` line only when the counts changed since the last time it
  printed them. It keeps them in `.git/dummkopf-report`, outside the working tree. `dummkopf meta report`
  is unchanged.

### Fixed

- `check` names the real line of every link. Before, each occurrence of a repeated link carried the line of
  the first one, and code blocks shifted the count. Issues are sorted by path and line.
- An edit next to a link that already crosses a scope or sensitivity barrier is saved with a warning instead
  of being rejected. A write that adds such a link is still rejected, and `check` still reports old ones
  as errors.
- The published `@dummkopf/core` manifest no longer has a `source` export condition that pointed at `src/`,
  which is not in the tarball.
- `dummkopf.toml` reaches the TOML parser as read, without newline normalisation. CRLF files load as before;
  a bare carriage return, which TOML 1.0 forbids, now fails with `config_unreadable`.
- The TOML parser no longer accepts the `\e` escape, which only TOML 1.1 has. dummkopf reads strict
  TOML 1.0; write `\u001B` instead.

## [0.3.1] - 2026-10-11

### Added

- A release tag also creates the GitHub release, with the version's changelog section and both tarballs.

### Fixed

- The release workflow passes the tarballs to `npm publish` as `./release/…`. Without `./`, npm took the
  path for a GitHub repository and the first 0.3.1 publish failed.
- The release workflow runs `npm stage publish`, the only command the Trusted Publishers allow. Each version
  waits on npmjs.com until a maintainer approves it with 2FA.
- Output into a pipe that closes early, like `dummkopf --help | head -1`, ends quietly. Before, dummkopf
  crashed with an EPIPE stack trace. The command keeps its exit code.

### Security

- Releases use npm Trusted Publishing instead of an npm token. A build job runs every check and packs the
  tarballs; a separate publish job, the only one with `id-token: write`, uploads them. Its actions are pinned
  to commit SHAs, and installs skip lifecycle scripts.

### Documentation

- The README installs dummkopf with `npm install -g dummkopf` and links both commands into `~/.local/bin`.

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
  the tarballs, also in CI) and a tag-triggered publish workflow with provenance. 0.3.0 is the first release on npm.

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
