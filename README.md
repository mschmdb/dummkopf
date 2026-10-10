# ˈdʊmkɔpf

Long-term memory for coding agents, kept in a plain Git repo of Markdown notes.

*Without memory, every agent is a Dummkopf.*

ˈdʊmkɔpf turns a folder of Markdown notes into a memory that Claude Code, Codex and other agents can query and
write through one CLI. Hooks commit and push every change, so the memory follows you to every machine.
Notes carry a scope (`private`, `work`, or your own) and can be marked sensitive. Agents never see sensitive
notes unless the user names the topic.

## Quickstart (5 minutes)

You need Python 3.11+, Git, and macOS or Linux.

```bash
pip install "git+https://github.com/mschmdb/dummkopf.git"
```

`uv tool install` or `pipx install` with the same URL work too and keep ˈdʊmkɔpf out of your project
environments. The commands below need `dummkopf` on your `PATH`; the hooks call it by name.

Create a brain with an empty private repository as its remote:

```bash
dummkopf init ~/brain --remote git@github.com:you/your-brain.git
```

Wire up the Git and agent hooks, then commit and push the scaffold:

```bash
cd ~/brain && dummkopf install && git add -A && git commit -m "Create brain" && git push -u origin main
```

Write a first note and ask for it:

```bash
printf -- '---\nkey_fact: pnpm 10 needs approve-builds for esbuild.\n---\n\n# pnpm\n\nRun pnpm approve-builds once.\n' | dk write notes/pnpm.md --expected new
```

```bash
dk context "How do I fix the pnpm esbuild error?"
```

`dk` is a short alias for `dummkopf`. `write` validated the note, added missing frontmatter, committed and pushed.
The pre-commit hook added it to `INDEX.md`.

Start Claude Code or Codex inside `~/brain` and the agent follows `AGENTS.md`. To use the brain from other
projects, see [Agent setup](#agent-setup).

## How a brain looks

```
brain/
├── dummkopf.toml          configuration
├── AGENTS.md              rules for every agent (CLAUDE.md points here)
├── INDEX.md               generated tables: topics, flat notes, bookmarks
├── .sensitive-paths       generated from markers; never edit by hand
├── topics/<topic>/        a folder per topic; README.md holds scope and file table
├── notes/<name>.md        single notes, flat
├── bookmarks/<theme>.md   saved links, flat
├── sources/               originals that stay verbatim
└── archive/               retired notes, not searched
```

[examples/demo-brain](examples/demo-brain) shows a hobby topic, a work topic and one sensitive note.

Every note starts with frontmatter. ˈdʊmkɔpf fills gaps when it writes:

```markdown
---
updated: 2026-09-20
status: active
key_fact: Starter lives in the fridge; feed 1:5:5 the evening before baking.
summary: Starter lives in the fridge; feed 1:5:5 the evening before baking.
aliases: [bread, starter]
period: [2026-09]
entities: []
---
```

`key_fact` is the one sentence the index shows. `summary` is its short form. `aliases` feed the search.
`period` (months like `2026-09`) and `entities` feed the links map.

## Scope and sensitivity

**Scope** separates contexts. A topic's `README.md` sets `scope: work` or `scope: private`, and everything
in the folder inherits it. A file sets its own scope only when it differs. `--scope work` hides private
notes, `--scope both` shows all. Scopes never lock anything; they keep a work answer free of private notes.
`scopes.link_barriers` stops one scope from linking into another, by default `work>private`.

**Sensitivity** hides notes. A note is sensitive when:

- it contains the marker line (`> SENSITIVE` by default) at the start of a line, or
- a `README.md` in one of its folders contains the marker, or
- its path sits under a `sensitive.always` prefix (for example `topics/health/`).

Sensitive notes stay out of search results, `INDEX.md`, the file tables of open topics, the links map and
the curator scan. `read`, `find`, `context`, link checks and new files in a topic answer a hidden path exactly like a
missing one. A topic `README.md` lists only notes of its own scope.
One signal stays by design: whoever may create notes learns whether a path is free, because
`write --expected new` fails on an existing hidden file. An agent may pass `--allow-sensitive <path>` only after the user named the topic in the current prompt;
`AGENTS.md` says so. The pre-commit hook derives `.sensitive-paths` from the markers, so `rg --ignore-file`
works as a fallback without the CLI.

Write rules ˈdʊmkɔpf enforces:

- `--expected <rev>` on every change. A stale revision is rejected, so two agents never overwrite each other.
- A new topic needs a `README.md` with a scope in the same package.
- No removing markers, no changing scopes, no edits under `sources/`. A new `README.md` must not change
  the scope of notes that already sit below it.
- No dead links, no links from a non-sensitive note to a sensitive one.
- New files get mode `0600`.
- Symlinks never count as notes. A cloned brain cannot pull outside files into the index or the extras.
- Paths must match the on-disk spelling, so `Topics/Health/x.md` never opens `topics/health/x.md` on a
  case-insensitive file system.

## Commands

| Command | What it does |
|---|---|
| `context "<question>"` | Best entry point for a user question. Drops filler words and follows routes. |
| `find "<keywords>"` | Keyword search over title, aliases, key fact, path and text. |
| `read <path>` | Read a note, a line range (`--start`, `--end`) or a section (`--section`). |
| `write <path> --expected new\|<rev>` | Write one file from Markdown on stdin. `--append` appends. |
| `ingest --input -` | Write a JSON package of several files atomically. |
| `check [paths]` | Validate frontmatter and links. |
| `sync` | Commit note changes, rebase onto the remote, push. |
| `init [path]` | Create a new brain. |
| `install` | Install the Git pre-commit hook and the Claude Code and Codex hooks. |
| `meta migrate\|generate\|report\|index\|agents` | Maintain frontmatter and indexes; print rendered `AGENTS.md`. |
| `links` | Build the links map (extra). |
| `curator` | Run the curation scan or print its weekly LLM prompt (extra). |

Read commands share `--scope`, `--topic`, `--allow-sensitive`, `--json` and `--max-chars`. Every command
accepts `--root PATH` and `--serious`. `dummkopf <command> --help` shows examples.

Every hit starts with a header line: `path | rev=<12 chars> | updated | status | scope`. Pass that `rev`
as `--expected` when you change the file.

**Exit codes:** `0` ok, `2` rejected call (nothing changed; the message says what to fix),
`3` saved but the Git sync failed (run `dummkopf sync` again).

## Agent setup

**Inside the brain.** `dummkopf init` writes `AGENTS.md` with the rules and a `CLAUDE.md` that imports it.
Codex reads `AGENTS.md` directly. `dummkopf install` adds:

- `.git/hooks/pre-commit`: regenerates `.sensitive-paths`, completes frontmatter of staged notes,
  rebuilds `INDEX.md` and the README tables. It never blocks a commit.
- `.claude/settings.json`: a `PostToolUse` hook on `Write|Edit|MultiEdit|Bash` and a `SessionEnd` hook.
  Both run `dummkopf hook agent`, which commits and pushes note changes.
- `.codex/hooks.json` (with `extras.codex_sync`): the same hook for Codex tools. Check that your Codex
  version has hooks enabled.

Existing settings stay; `install` only adds its own entries and can run again safely.

**From other projects.** Point your global agent instructions at the brain, for example in
`~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`:

```markdown
Long-term memory lives in ~/brain. Before answering questions about earlier decisions or known topics, run
`dummkopf --root ~/brain context "<the question>"`. Follow ~/brain/AGENTS.md for scope, sensitivity and writing.
```

`DUMMKOPF_ROOT=~/brain` in your shell profile saves the `--root`.

## Configuration reference

`dummkopf.toml` lives in the brain root. Only `schema_version` and `repo.remote` are required. Unknown keys
are an error, so a typo never switches a rule off silently. The full file with every default is in
[examples/dummkopf.example.toml](examples/dummkopf.example.toml).

| Section | Keys | Purpose |
|---|---|---|
| `[repo]` | `remote`, `remote_name`, `branch`, `auto_push`, `commit_message`, `sync_exclude` | Sync refuses any remote URL or branch except these. `auto_push = false` commits locally only. `sync_exclude` lists paths humans commit themselves. |
| `[layout]` | `topics`, `topic_readme`, `notes`, `bookmarks`, `archive`, `sources`, `index` | Folder and file names. |
| `[scopes]` | `values`, `all`, `query_default`, `mixed_label`, `require_on_new_topic`, `link_barriers` | Your scopes, the keyword for "all scopes", the default for `--scope`, the label for unscoped notes, and forbidden link directions such as `work>private`. |
| `[status]` | `active`, `archived` | Status values; stale checks look at `active` notes. |
| `[sensitive]` | `marker`, `paths_file`, `always` | Marker line, generated list, and path prefixes that are always sensitive. |
| `[frontmatter]` | `key_fact`, `summary`, `aliases`, `updated`, `status`, `period`, `entities`, `scope`, `todo_placeholder`, `summary_max` | Maps each field to the key used in your files. |
| `[ui]` | `locale`, `tone` | `locale` (`en`, `de`) sets generated headings and text heuristics. `tone` is `cheeky` or `plain`. |
| `[limits]` | `max_chars`, `find_limit`, `max_input_chars`, `max_changes`, `lock_timeout_s`, `git_timeout_s`, `stale_after_days` | Output budgets and timeouts. |
| `[search.weights]` | `title`, `aliases`, `key_fact`, `path`, `body`, `topic_readme_bonus` | Search ranking. |
| `[context]` | `routes_file` | Optional routes for dated plans (see below). |
| `[extras]` | `links`, `curator`, `codex_sync` | Switch each extra on or off. |
| `[links]` | `output`, `entities_file`, `min_topics` | Options of the links extra. |
| `[curator]` | `open_days`, `stale_days`, `report_dir` | Options of the curator extra. |

**An existing brain in another language** runs on ˈdʊmkɔpf through configuration alone.
[examples/config-german-hub.toml](examples/config-german-hub.toml) maps German keys (`kernfakt`, `stand`, …),
scopes (`privat`), the marker (`> SENSIBEL`) and folders (`quellen/`) without touching a note.

## Extras

- **links**: writes `LINKS.md` (never inside a note folder, so it never turns into a searchable note) with topics that share a month or an entity, and months where topics on both
  sides of a scope barrier are busy. Entities come from `entities.txt`: one per line, `Name|alias|alias`,
  prefix `i:` for case-insensitive matching.
- **curator**: `dummkopf curator` lists open loops, quiet topics, conflicting "as of" dates and stale active
  notes. `dummkopf curator --prompt` prints a weekly LLM prompt that turns the scan into a proposal report
  under `curator.report_dir`. The prompt proposes; it never changes notes.
- **codex_sync**: installs the Codex hook.
- **routes**: a `routes.json` entry like
  `{"routes":[{"aliases":["meal plan"],"sources":"topics/meals/plan-*.md","scope":"private","kind":"dated-plan"}]}`
  lets `context "meal plan next week"` open exactly the plan files named `plan-2026-10-05-to-11.md` that
  overlap next week, and only their matching table rows. A route never opens the rest of the folder.
  An alias must contain a real word (three letters or more, not a filler word), because naming the alias
  releases the plan.

## FAQ

**Can I use it at work?** Yes. Set `tone = "plain"` in `[ui]` and every message stays neutral. `--serious`
does the same for a single call. Error messages are equally precise in both tones.

**Does it send my notes anywhere?** Only to your own Git remote, by `git push`. ˈdʊmkɔpf has no network code
and no dependencies beyond the Python standard library.

**Windows?** Not yet. The process lock uses `fcntl`.

**Why does `read` say "unavailable" for a file I can see?** The file is sensitive, out of scope or outside
the note folders. ˈdʊmkɔpf gives the same answer in all three cases, on purpose.

**Can two agents write at the same time?** Yes. A process lock serializes writes, and `--expected` rejects a
change based on an old revision.

## License

MIT, see [LICENSE](LICENSE).
