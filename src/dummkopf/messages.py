"""Every user-facing message lives here, so translating means editing one file.

PLAIN holds the precise text. CHEEKY overrides a few keys; error overrides must
embed `{plain}` so the joke never hides what failed or what to do next.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from dummkopf.errors import DummkopfError

PLAIN: dict[str, str] = {
    # config
    "config_missing": (
        "No dummkopf.toml found in {start} or its parents. "
        "Run `dummkopf init` to create a brain, or pass --root."
    ),
    "config_unreadable": "dummkopf.toml is not readable: {detail}",
    "config_invalid": "dummkopf.toml: {key}: {problem}",
    # access
    "path_denied": "Path unavailable or access excluded.",
    "invalid_scope": "Invalid scope. Use one of: {choices}.",
    "invalid_topic": "Invalid topic name. Use letters, digits and hyphens.",
    "grant_needs_path": "--allow-sensitive needs a topic folder or a concrete .md file.",
    "sensitive_list_missing": (
        "The sensitive-paths list {file} is missing or unreadable. "
        "Run `dummkopf meta index` to regenerate it."
    ),
    "busy": "The brain is busy. Retry the call.",
    "routes_invalid": "The routes file is invalid or unavailable.",
    # validation
    "missing_frontmatter": "Frontmatter is missing.",
    "bad_updated": "{key} needs a valid ISO date (YYYY-MM-DD).",
    "missing_text": "{key} is missing or has no valid text.",
    "needs_list": "{key} needs a list of strings.",
    "missing_body": "Content and an H1 heading are missing.",
    "bad_metadata": "Metadata needs valid keys and string or string-list values.",
    "version_conflict": "A file changed since you read it (current rev={rev}). Read it again, then retry.",
    "append_needs": "append needs an existing file and non-empty text.",
    "replace_needs": "replace needs an existing file and 1 to {max} text pairs.",
    "replace_pair": "Each text pair needs a non-empty old text and a new text.",
    "replace_ambiguous": "The old text is missing or ambiguous. Read the original passage again.",
    "flat_path": "Notes and bookmarks need a flat target path, e.g. {root}/<name>.md.",
    "topic_path": "Topic files need a topic folder, e.g. {root}/<topic>/<file>.md.",
    "kebab_case": "Target paths need kebab-case names and .md files.",
    "link_scheme": "This link scheme is not allowed.",
    "link_escapes": "A local link leaves the brain.",
    "link_unavailable": "A link target is missing or not released.",
    "link_scope": "A link crosses a sensitivity or scope boundary.",
    "hint_link_scope": "A non-sensitive or work note must not link to sensitive or private targets.",
    "hint_link_unavailable": (
        "Check the target path relative to the note, --scope and --allow-sensitive, or remove the link."
    ),
    "packet_shape": "A write package must contain only `changes`.",
    "changes_count": "changes needs 1 to {max} file entries.",
    "entry_shape": (
        "Each entry needs path, expected and exactly one of content, replace or append; "
        "metadata is optional."
    ),
    "duplicate_path": "A target path may appear only once per package.",
    "expected_format": (
        "expected must be null for new files or a revision (at least 12 hex characters of rev)."
    ),
    "new_sensitive": (
        "New sensitive note. Release it with --allow-sensitive {path}, "
        "but only after the user named the topic in the current prompt."
    ),
    "sources_readonly": "Originals under {sources}/ stay unchanged.",
    "marker_removal": "A write package must not remove a sensitivity marker.",
    "expected_missing": "An expected file is missing. Check the current state.",
    "scope_change": "Changing a scope needs a separate review.",
    "topic_needs_readme": "A new topic needs a {readme} in the same package.",
    "topic_needs_scope": "A new topic needs an explicit scope: {choices}.",
    "packet_rules": "The write package breaks the rules: {codes}.\n{details}",
    "issue_line": "line {line}",
    # writing
    "write_race": "A file changed while writing.",
    "rollback_failed": "Write failed. A foreign change blocks a full rollback.",
    "not_saved": "The write package was not saved. Check the current state.",
    "sync_failed_after_save": "Markdown saved, but Git sync failed. Retry with `dummkopf sync`.",
    # sync
    "git_unavailable": "Git is not available or does not answer.",
    "git_failed": "Git step failed: {step}. Local data is kept.",
    "git_root": "The Git root does not match the brain root.",
    "git_branch": "Sync needs branch {branch}.",
    "git_remote": "Remote {name} does not match repo.remote in dummkopf.toml.",
    "git_open_operation": "A Git operation is in progress. Resolve it first.",
    "git_conflicts": "Git has unresolved conflicts.",
    "git_diverged": "The remote contradicts local changes. Local commits are kept.",
    "git_dirty": "The brain has uncommitted note changes. Run `dummkopf sync` first.",
    "hook_sync_failed": "dummkopf sync failed: {reason}",
    "hook_index_failed": "dummkopf pre-commit step failed: {reason}. The commit continues.",
    "hook_exists": (
        "{path} exists and was not written by dummkopf. Merge it by hand: call `dummkopf hook pre-commit` "
        "from your hook, or move it away and run `dummkopf install` again."
    ),
    "not_a_git_repo": "{path} is not a Git repository. Run `git init -b main` first.",
    "settings_unreadable": "{path} is not valid JSON. Fix or remove it, then run `dummkopf install` again.",
    "brain_exists": "{path} already holds a dummkopf.toml. Nothing changed.",
    "sync_ok": "Synced.",
    # cli input
    "max_chars_range": "--max-chars must be between {low} and {high}.",
    "limit_range": "--limit must be between {low} and {high}.",
    "bad_line_range": "Invalid line range.",
    "section_with_range": "Do not combine --section with a line range.",
    "section_needs_heading": "A section needs a heading.",
    "section_ambiguous": "The section is missing or ambiguous. Give a more precise heading.",
    "query_needs_word": "The query needs at least one word.",
    "search_needs_term": "The search needs at least one keyword.",
    "input_unreadable": "The input is not readable.",
    "input_too_large": "The write package is too large.",
    "json_unreadable": (
        "The JSON write package is not readable: {msg} (line {line}, column {col}). "
        "For Markdown content, `dummkopf write` or a quoted heredoc (<<'EOF') is safer."
    ),
    "check_paths_or_input": "check takes file paths or --input, not both.",
    "links_output": (
        "{path}: the links file must be a .md file inside the brain, in an existing folder, "
        "outside .git and outside the note folders."
    ),
    "extra_disabled": "The extra `{name}` is disabled in dummkopf.toml ([extras] {name} = false).",
    # rendered output
    "out_period": "Requested period: {start} to {end}",
    "no_results": "Nothing found in released sources.",
    "out_partial": "Partial match: not all keywords match.",
    "out_ignored": "Ignored: {terms}",
    "out_not_found": "Not found: {terms}",
    "out_key_fact": "Key fact: {text}",
    "out_more": "More hits available; narrow the search or raise --limit.",
    "out_truncated": "Output truncated; read specific lines or raise --max-chars.",
    "out_missing_dates": "No dated plan rows for: {dates}",
    "out_write_status": "Write status: {status}; sync: {sync}",
    "out_saved": "saved",
    "out_preview": "preview",
    "out_changed": "Changed: {path}",
    "out_unchanged": "Unchanged: {path}",
    "out_checked": "Checked files: {count}; status: {status}",
    "out_issue": "{path}: {message} ({severity})",
    "out_write_truncated": "Output truncated. Raise --max-chars for more details.",
    "out_written": "{path} written.",
    "out_index_changed": "{count} file(s) updated.",
    "out_installed": "Installed: {what}",
    "report_missing": "### Missing `{key}` ({count})",
    "report_stale": "### Stale (status {status}, older than {days} days) ({count})",
    "report_todo": "### No key fact (`{todo}`) ({count})",
    "report_stale_item": "- `{path}` ({key} {date})",
    "report_sensitive": "_{count} sensitive file(s) skipped._",
    "out_paths_file_updated": "{file} updated.",
    "curator_title": "Curator scan",
    "curator_open_loops": "Open loops",
    "curator_stale_topics": "Topics without movement",
    "curator_conflicts": "Conflicting dates",
    "curator_stale_active": "Stale active notes",
    "curator_none": "None found.",
    "curator_skipped": "{files} sensitive files and {topics} sensitive topics skipped.",
    "out_init": (
        "New brain created in {path}. Next: set repo.remote in dummkopf.toml, then `dummkopf install`."
    ),
}

# argparse help: option help, command descriptions and examples.
HELP: dict[str, str] = {
    "prog": "Long-term memory for coding agents, kept in a Git repo of Markdown notes.",
    "epilog": (
        "Read: context, find, read. Write: write (one file), ingest (package). "
        "Details: dummkopf <command> --help"
    ),
    "root": "Brain root. Default: $DUMMKOPF_ROOT, else the nearest folder with dummkopf.toml.",
    "serious": "Neutral messages, whatever ui.tone says.",
    "scope": "A scope from dummkopf.toml, or the all-scopes keyword (default: scopes.query_default).",
    "topic": "Limit access to this topic folder.",
    "allow_sensitive": "Release a sensitive path. Only when the user named it in the current prompt.",
    "json": "Print the result as compact JSON.",
    "max_chars": "Maximum output length in characters (500 to 20000, default: limits.max_chars).",
    "dry_run": "Validate and show changes; save nothing.",
    "query": "The user question or keywords.",
    "path": "Path relative to the brain, e.g. notes/topic.md.",
    "limit": "Maximum number of hits (1 to 10, default: limits.find_limit).",
    "start": "First line (physical line number).",
    "end": "Last line (inclusive).",
    "section": "Read an original section by its unique heading.",
    "expected": "new for new files, otherwise rev from read/context.",
    "append": "Append stdin to the end of the file.",
    "input_md": "Markdown file; - or no value reads stdin.",
    "input_json": "JSON write package; - or no value reads stdin.",
    "check_paths": "Files to check; default: all released files.",
    "ex_context": (
        "Best entry point for a user question. Filler words are dropped; the output names them.\n"
        "Header per hit: path | rev=<12 chars> | updated | status | scope. Use rev as --expected.\n\n"
        'Example:\n  dummkopf context "How does the deploy work?" --scope work'
    ),
    "ex_find": (
        "Keyword search over title, aliases, key fact, path and text.\n\n"
        'Example:\n  dummkopf find "pnpm esbuild" --limit 5'
    ),
    "ex_read": (
        "Read a file. Without --start, output begins after the frontmatter;\n"
        "its key fields appear in the header line. --start 1 shows the whole frontmatter.\n"
        "If --end lies before the first body line, output starts at line 1.\n\n"
        "Examples:\n  dummkopf read notes/topic.md\n  dummkopf read notes/topic.md --end 3\n"
        '  dummkopf read notes/topic.md --section "Open questions" --json'
    ),
    "ex_ingest": (
        "Write several files atomically. Index, commit and push run automatically.\n"
        "Per entry exactly one of: content (whole file), replace (text pairs) or append (text at the end).\n"
        "expected: null for new files, otherwise rev from read/context (12 characters are enough).\n\n"
        "Example:\n"
        "  dummkopf ingest --scope work --input - <<'EOF'\n"
        '  {"changes":[{"path":"notes/topic.md","expected":"9f4a55b37576",\n'
        '    "append":"## New\\n- Fact","metadata":{"key_fact":"Proven statement"}}]}\n'
        "  EOF"
    ),
    "ex_write": (
        "Write one file from Markdown on stdin, no JSON. Metadata comes from the frontmatter.\n"
        "A new topic needs a README in the same package: use ingest for that.\n\n"
        "Examples:\n"
        "  dummkopf write notes/topic.md --scope work --expected new <<'EOF'\n"
        "  ---\n  key_fact: Proven statement\n  aliases: [topic]\n  ---\n\n  # Topic\n\n  Content\n  EOF\n"
        "  dummkopf write bookmarks/ai.md --expected 9f4a55b37576 --append <<'EOF'\n"
        "  ## Title\n  - URL: https://example.org\n  EOF"
    ),
    "ex_init": (
        "Create a new brain: dummkopf.toml, AGENTS.md, CLAUDE.md, .gitignore, INDEX.md and folders.\n\n"
        "Example:\n  dummkopf init ~/brain --remote git@github.com:you/your-brain.git"
    ),
    "ex_install": (
        "Install the Git pre-commit hook, the Claude Code hooks (.claude/settings.json)\n"
        "and, with extras.codex_sync, the Codex hook (.codex/hooks.json).\n\nExample:\n  dummkopf install"
    ),
    "ex_hook": (
        "Entry point for hooks; `dummkopf install` wires these up. Never blocks.\n"
        "pre-commit: regenerate the sensitive-paths list and indexes.\n"
        "agent: read a Claude Code or Codex hook event on stdin and sync.\n\n"
        "Example:\n  dummkopf hook pre-commit"
    ),
    "ex_meta": (
        "Maintain frontmatter and generated indexes.\n"
        "migrate: add missing frontmatter. generate: rebuild INDEX.md and README file tables.\n"
        "report: list notes without date, stale notes and missing key facts.\n"
        "index: regenerate the sensitive-paths list, then the tables.\n"
        "agents: print AGENTS.md rendered for this brain's config.\n\n"
        "Example:\n  dummkopf meta report --max-age 30"
    ),
    "ex_links": (
        "Build the cross-reference map: topics that share a month or an entity, and months where\n"
        "scopes named in scopes.link_barriers collide. Sensitive notes are left out.\n\n"
        "Example:\n  dummkopf links --min-topics 3"
    ),
    "ex_curator": (
        "Deterministic curation scan: open loops, quiet topics, conflicting dates, stale notes.\n"
        "--prompt prints the weekly LLM prompt that turns the scan into a report.\n\n"
        "Example:\n  dummkopf curator --json"
    ),
    "links_out": "Output file (default: links.output).",
    "links_min": "Minimum number of topics per link (default: links.min_topics).",
    "curator_open": "Days after which an open loop counts (default: curator.open_days).",
    "curator_stale": "Days without change after which a topic counts as quiet (default: curator.stale_days).",
    "curator_prompt": "Print the weekly LLM prompt instead of the scan.",
    "extra_json": "Print the result as JSON instead of Markdown.",
    "init_path": "Folder for the new brain (default: current folder).",
    "init_remote": "Git remote URL for repo.remote.",
    "init_locale": "Language of generated headings and text heuristics: en or de.",
    "hook_kind": "pre-commit or agent.",
    "meta_action": "migrate, generate, report, index or agents.",
    "meta_only": "migrate only these paths (repeatable).",
    "meta_max_age": "Days after which an active note counts as stale (default: limits.stale_after_days).",
    "ex_check": "Check frontmatter and links.\n\nExample:\n  dummkopf check notes/topic.md",
    "ex_sync": "Commit open note changes, rebase onto the remote and push.\n\nExample:\n  dummkopf sync",
}

CHEEKY: dict[str, str] = {
    "path_denied": "Dummkopf! {plain}",
    "busy": "Easy, Dummkopf. {plain}",
    "version_conflict": "Someone else touched this note. Read it again, Dummkopf. {plain}",
    "new_sensitive": "Dummkopf! {plain}",
    "marker_removal": "Dummkopf! {plain}",
    "config_missing": "No brain here, Dummkopf. {plain}",
    "git_dirty": "Dummkopf, clean up first. {plain}",
    "sync_failed_after_save": "Half a brain is better than none. {plain}",
    "no_results": "{plain} Even a Dummkopf knows when it doesn't know.",
    "sync_ok": "Brain synced.",
}

# Status lines that report success; their cheeky version may replace the plain text.
INFO_KEYS = frozenset({"sync_ok"})

TONES = ("cheeky", "plain")


def text(key: str, tone: str, /, **params: object) -> str:
    plain = PLAIN[key].format(**params)
    if tone != "cheeky" or key not in CHEEKY:
        return plain
    return CHEEKY[key].format(plain=plain, **params)


def error_text(error: DummkopfError, tone: str) -> str:
    return text(error.key, tone, **error.params)
