# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

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
