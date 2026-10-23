# ˈdʊmkɔpf

Long-term memory for coding agents, kept in a plain Git repo of Markdown notes.

*Without memory, every agent is a Dummkopf.*

ˈdʊmkɔpf turns a folder of Markdown notes into a memory that Claude Code, Codex and other agents can query and
write through one CLI. Hooks commit every change. With a remote, they also push it, so the memory follows you
to every machine. Without one, the brain stays on your machine. Notes carry a scope (`private`, `work`, or
your own) and can be marked sensitive. Agents never see sensitive notes unless the user names the topic.

## Why not built-in memory?

Claude Code and Codex remember things on their own. Use that first. It needs no setup, and Claude Code loads its
memory into every session, while ˈdʊmkɔpf answers only when the agent asks. If you work on one project on one
machine, built-in memory is enough.

| | Built-in | ˈdʊmkɔpf |
|---|---|---|
| Claude Code auto memory | One folder per Git repository in `~/.claude/projects/`, on this machine only | One brain for every project, on every machine with a synced brain |
| Codex memories | Off by default, kept in `~/.codex/memories/` | The same brain for Codex and Claude Code |
| `CLAUDE.md`, `AGENTS.md` | Rules loaded into every session | Notes with a key fact, aliases and a search that cites the file |
| Notion memory (MCP) | Hosted by Notion, needs a Notion account | Markdown in your own Git repository, local or synced |
| Private and work | Separated by project at most, no hidden notes | Scopes, and sensitive notes agents open only when you name the topic |

Sources: [Claude Code memory](https://code.claude.com/docs/en/memory),
[Codex memories](https://developers.openai.com/codex/memories), as of October 2026.

## Quickstart (5 minutes)

You need Node.js 22.18 or newer, Git, and macOS or Linux.

```bash
npm install -g dummkopf
```

This installs `dummkopf` and its short form `dk`. Update later with the same command.

The hooks call `dummkopf` by name and also look in `~/.local/bin`. Agents often start hooks with a narrower
`PATH` than your terminal, the Claude desktop app for one. npm's global folder is often missing there, for
example with nvm. Link both commands into `~/.local/bin` to be safe:

```bash
mkdir -p ~/.local/bin
ln -sf "$(npm prefix -g)/bin/dummkopf" "$(npm prefix -g)/bin/dk" ~/.local/bin/
```

To run the latest `main` instead, build from source with pnpm: clone the repository, run
`pnpm install && pnpm build`, and link `packages/cli/bin/dummkopf` and `packages/cli/bin/dk` into
`~/.local/bin`. See [CONTRIBUTING.md](CONTRIBUTING.md).

Create a brain. Decide first where it lives:

```bash
dummkopf init ~/brain
```

This brain is **local**. dummkopf commits every change, but never fetches or pushes. Choose it when your notes
must not leave the machine.

```bash
dummkopf init ~/brain --remote git@github.com:you/your-brain.git
```

This brain is **synced**. Use an empty *private* repository as its remote. dummkopf pushes after every change
and rebases onto the remote before every write, so all your machines share one memory.

Wire up the Git and agent hooks, then commit the scaffold (and push it, for a synced brain):

```bash
cd ~/brain && dummkopf install && git add -A && git commit -m "Create brain"
git push -u origin main   # synced brains only
```

Write a first note and ask for it:

```bash
printf -- '---\nkey_fact: pnpm 10 needs approve-builds for esbuild.\n---\n\n# pnpm\n\nRun pnpm approve-builds once.\n' | dk write notes/pnpm.md --expected new
```

```bash
dk context "How do I fix the pnpm esbuild error?"
```

`dk` is a short alias for `dummkopf`. `write` validated the note, added missing frontmatter and committed it.
In a synced brain it pushed, too. The pre-commit hook added the note to `INDEX.md`.

Start Claude Code or Codex inside `~/brain` and the agent follows `AGENTS.md`. To use the brain from other
projects, see [Agent setup](#agent-setup).

## Local or synced

The only difference is `repo.remote` in `dummkopf.toml`.

| | Local brain | Synced brain |
|---|---|---|
| `repo.remote` | not set | your private repository |
| Commits note changes | yes | yes |
| Fetches and rebases before a write | never | yes |
| Pushes after a write | never | yes, unless `auto_push = false` |
| Checks the Git remote | never | sync refuses any other URL |

A local brain never talks to a remote, even when the Git repository has one. To turn a local brain into a
synced one later, add the remote to Git and set `repo.remote` to the same URL. To go back, remove the
`remote` line.

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

- it contains the marker line (`> SENSITIVE` by default) on a line of its own, or
- a `README.md` in one of its folders contains the marker, or
- its path sits under a `sensitive.always` prefix (for example `topics/health/`).

The marker also counts when it is indented, so a note that quotes `> SENSITIVE` in an indented block
becomes sensitive too. That is on purpose: hiding one note too many is the cheaper mistake.

Sensitive notes stay out of search results, `INDEX.md`, the file tables of open topics, the links map and
the curator scan. `read`, `find`, `context`, link checks and new files in a topic answer a hidden path exactly like a
missing one. A topic `README.md` lists only notes of its own scope.
One signal stays by design: whoever may write packets learns whether a path is taken. A new file on an
existing hidden file fails with `path_denied`, also inside a hidden topic. A free path in a hidden topic fails with
`topic_unavailable`, like a path in a missing topic. A new `README.md` in a hidden folder answers like a missing topic,
whether notes sit below it or not. An agent may pass `--allow-sensitive <path>` only after the user named the topic in the current prompt;
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
| `write <path> --expected new\|<rev>` | Write one file from Markdown on stdin. `--append` appends. `--message TEXT` sets the commit subject. |
| `ingest --input -` | Write a JSON package of several files atomically. `--message TEXT` sets the commit subject. |
| `check [paths]` | Validate frontmatter and links. |
| `sync` | Commit note changes; in a synced brain also rebase onto the remote and push. |
| `init [path]` | Create a new brain; `--remote URL` makes it synced. |
| `install` | Install the Git pre-commit hook and the Claude Code and Codex hooks. |
| `meta migrate\|generate\|report\|index\|agents` | Maintain frontmatter and indexes; print rendered `AGENTS.md`. |
| `links` | Build the links map (extra). |
| `curator` | Run the curation scan or print its weekly LLM prompt (extra). |

**What gets committed.** `write`, `ingest`, `sync` and the agent hooks commit only what dummkopf manages: the
note folders (`topics/`, `notes/`, `bookmarks/`), `sources/`, `archive/`, `INDEX.md`, `.sensitive-paths`, the
links map (`links.output`), the curator reports (`curator.report_dir`) and the routes and entities files
(`context.routes_file`, `links.entities_file`). Everything else, such as
`dummkopf.toml`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/` or your scripts, stays uncommitted for you to
commit by hand, and an uncommitted change there never blocks a write. `repo.sync_exclude` keeps further paths
inside those folders out. The commit subject is `repo.commit_message`; `write` and `ingest` take
`--message "Add pnpm build fix"` (one line, at most 200 characters) for a subject of their own.

Read commands share `--scope`, `--topic`, `--allow-sensitive`, `--json` and `--max-chars`. Every command
accepts `--root PATH` and `--serious`. `dummkopf <command> --help` shows the purpose and examples first, then
the options grouped as Access, Output and the command's own options. `dummkopf --version` prints the version.

Every hit starts with a header line: `path | rev=<12 chars> | updated | status | scope`. Pass that `rev`
as `--expected` when you change the file.

**Exit codes:** `0` ok, `2` rejected call (nothing changed; the message says what to fix),
`3` saved but the Git sync failed (run `dummkopf sync` again).

## Agent setup

**Inside the brain.** `dummkopf init` writes `AGENTS.md` with the rules and a `CLAUDE.md` that imports it.
Codex reads `AGENTS.md` directly. `dummkopf install` adds:

- `.git/hooks/pre-commit`: regenerates `.sensitive-paths`, completes frontmatter of staged notes,
  rebuilds `INDEX.md` and the README tables. With stale or incomplete notes it prints one summary line,
  but only when the counts changed since the last commit (`[hooks] report`); `dummkopf meta report` lists
  them. It keeps the last counts in `.git/dummkopf-report`, never in the working tree, and never blocks a commit.
- `.claude/settings.json`: a `PostToolUse` hook on `Write|Edit|MultiEdit|Bash` and a `SessionEnd` hook.
  Both run `dummkopf hook agent`, which commits note changes and, in a synced brain, pushes them.
- `.codex/hooks.json` (with `extras.codex_sync`): the same hook for Codex tools. Check that your Codex
  version has hooks enabled.

- `permissions` in `.claude/settings.json`: `allow` rules for `Bash(dummkopf *)` and `Bash(dk *)`, and `ask`
  rules for any call with `--allow-sensitive`. See [Headless agents](#headless-agents).

Existing settings stay; `install` only adds its own entries and can run again safely. Moving from an older
sync setup? `dummkopf install --replace-command old_sync.py` removes hook commands containing that text first,
so two sync paths never run side by side.

**From other projects.** Point your global agent instructions at the brain, for example in
`~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`:

```markdown
Long-term memory lives in ~/brain. Before answering questions about earlier decisions or known topics, run
`dummkopf --root ~/brain context "<the question>"`. Follow ~/brain/AGENTS.md for scope, sensitivity and writing.
```

`DUMMKOPF_ROOT=~/brain` in your shell profile saves the `--root`. The hooks ignore it: they always get
`--root` from the hook command, so they never act on a brain you did not install them into.

### Headless agents

`claude -p` and the Claude Code GitHub Action never ask before a Bash command. They deny every command that
needs approval and no rule allows, and report the denial only in their result. Without a rule, an agent there
cannot call `dummkopf` at all. Claude Code on the web applies the rules from the repository's
`.claude/settings.json`, too.

Inside the brain, `dummkopf install` writes the rules. From other projects, add them yourself, for example
to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(dummkopf *)", "Bash(dk *)"],
    "ask": ["Bash(dummkopf *--allow-sensitive*)", "Bash(dk *--allow-sensitive*)"]
  }
}
```

`ask` wins over `allow`. In a terminal, Claude Code asks you before it opens a sensitive note. Headless, nobody
can confirm, so the call fails. That matches the rule in `AGENTS.md`: only the user opens a sensitive topic.
These rules match the command as the agent writes it. They are not a security boundary: an agent can still
read the files directly with `cat`. For the GitHub Action, pass the same rules through its `settings` input
or `claude_args: --allowedTools`.

## Configuration reference

`dummkopf.toml` lives in the brain root. Only `schema_version` is required. Unknown keys are an error, so a
typo never switches a rule off silently. The full file with every default is in
[examples/dummkopf.example.toml](examples/dummkopf.example.toml).

| Section | Keys | Purpose |
|---|---|---|
| `[repo]` | `remote`, `remote_name`, `branch`, `auto_push`, `commit_message`, `sync_exclude` | Without `remote` the brain is local and never fetches or pushes. With it, sync refuses any other remote URL or branch. `auto_push = false` commits locally only. dummkopf commits only note folders and generated files (see [Commands](#commands)); `sync_exclude` lists further paths inside them that humans commit themselves. |
| `[layout]` | `topics`, `topic_readme`, `notes`, `bookmarks`, `archive`, `sources`, `index` | Folder and file names. |
| `[scopes]` | `values`, `all`, `query_default`, `mixed_label`, `require_on_new_topic`, `link_barriers` | Your scopes, the keyword for "all scopes", the default for `--scope`, the label for unscoped notes, and forbidden link directions such as `work>private`. |
| `[status]` | `active`, `archived` | Status values; stale checks look at `active` notes. |
| `[sensitive]` | `marker`, `paths_file`, `always` | Marker line, generated list, and path prefixes that are always sensitive. |
| `[frontmatter]` | `key_fact`, `summary`, `aliases`, `updated`, `status`, `period`, `entities`, `scope`, `todo_placeholder`, `summary_max` | Maps each field to the key used in your files. |
| `[ui]` | `locale`, `tone` | `locale` (`en`, `de`) sets generated headings and text heuristics. `tone` is `cheeky` or `plain`. |
| `[hooks]` | `report` | When the pre-commit hook prints its report line: `changes` (default, only when the counts changed), `always` or `never`. |
| `[limits]` | `max_chars`, `find_limit`, `max_input_chars`, `max_changes`, `lock_timeout_s`, `git_timeout_s`, `stale_after_days` | Output budgets and timeouts. |
| `[search.weights]` | `title`, `aliases`, `key_fact`, `path`, `body`, `topic_readme_bonus`, `curator_report_percent` | Search ranking. Curator reports score 25 percent unless the query names the curator. |
| `[context]` | `routes_file` | Optional routes for dated plans (see below). |
| `[extras]` | `links`, `curator`, `codex_sync` | Switch each extra on or off. |
| `[links]` | `output`, `entities_file`, `min_topics`, `allow_outside` | Options of the links extra. `allow_outside` lists folders outside the note folders (e.g. `archive`, `assets`) that notes may link to; any other target outside the note folders counts as unavailable. |
| `[curator]` | `open_days`, `stale_days`, `report_dir`, `keep_key` | Options of the curator extra. |

**An existing brain in another language** runs on ˈdʊmkɔpf through configuration alone.
[examples/config-german-hub.toml](examples/config-german-hub.toml) maps German keys (`kernfakt`, `stand`, …),
scopes (`privat`), the marker (`> SENSIBEL`) and folders (`quellen/`) without touching a note.

## Extras

- `links`, `curator` and `meta report` take `--scope` (default `scopes.query_default`) and show only notes
  the read gate releases for that scope. With `query_default = "both"`, the default, they cover every scope
  unless you pass `--scope`.
- **links**: writes `LINKS.md` (never inside a note folder, so it never turns into a searchable note) with topics that share a month or an entity, and months where topics on both
  sides of a scope barrier are busy. Entities come from `entities.txt`: one per line, `Name|alias|alias`,
  prefix `i:` for case-insensitive matching.
- **curator**: `dummkopf curator` lists open loops, quiet topics, conflicting "as of" dates and stale active
  notes. A date conflicts when the text names a newer "as of" day than the note's own date. `dummkopf curator --prompt`
  prints a weekly LLM prompt that turns the scan into a proposal report under `curator.report_dir`. The prompt
  proposes; it never changes notes. To keep a note out of the scan after a "keep" verdict, give it
  `curator_keep: <date>` in its frontmatter (`curator.keep_key` renames the field); it returns after that day. On a
  topic README it also hides the quiet topic.
- **codex_sync**: installs the Codex hook.
- **routes**: a `routes.json` entry like
  `{"routes":[{"aliases":["meal plan"],"sources":"topics/meals/plan-*.md","scope":"private","kind":"dated-plan"}]}`
  lets `context "meal plan next week"` open exactly the plan files named `plan-2026-10-05-to-11.md` that
  overlap next week, and only their matching table rows. A route never opens the rest of the folder.
  An alias must contain a real word (three letters or more, not a filler word). A route opens sensitive
  plan files only with `"allow_sensitive": true` in its entry; without it the normal sensitivity rules apply.

## FAQ

**Can I keep my notes off GitHub?** Yes. Create the brain without `--remote`. A local brain commits every
change, but nothing ever leaves your machine. Back it up like any other folder.

**Can I use it at work?** Yes. Set `tone = "plain"` in `[ui]` and every message stays neutral. `--serious`
does the same for a single call. Error messages are equally precise in both tones.

**Does it send my notes anywhere?** Only to your own Git remote, by `git push`, and only in a synced brain.
ˈdʊmkɔpf has no other network code and no runtime dependencies beyond Node.js.

**How fast is it?** Fast enough for agents to query before every answer. On an Apple M5 Pro with Node 24,
`context` and `find` take about 0.13 s in a brain of 200 notes and 0.48 s with 2,000 notes. `read` takes
0.08 s at either size, and 0.02 s of every call is Node starting up. A real brain of 189 notes on a Mac
answers in 0.16 s. To measure your own machine, run `pnpm bench` in a checkout.

**Windows?** Not tested yet. The process lock and the hooks assume a POSIX system.

**Why does `read` say "unavailable" for a file I can see?** The file is sensitive, out of scope or outside
the note folders. ˈdʊmkɔpf gives the same answer in all three cases, on purpose.

**Can two agents write at the same time?** Yes. A process lock serializes writes, and `--expected` rejects a
change based on an old revision. Across machines, a push that loses the race against another machine fetches,
rebases and pushes again, up to three times.

**Can I build my own frontend?** Yes. `@dummkopf/core` (`npm install @dummkopf/core`) is the library behind
the CLI. Read notes through its `Access` class: it applies the same scope, sensitivity and path rules as the
CLI. The package exports no raw note reader, so a frontend cannot skip those rules by accident.

## Coming from the Python version

Releases up to 0.2.0 were written in Python and installed with `uv tool install`. The TypeScript version reads
the same brains: same `dummkopf.toml`, same folders, same frontmatter, same hooks. Nothing needs converting.

1. Install the new version as described in the [Quickstart](#quickstart-5-minutes).
2. Remove the old one: `uv tool uninstall dummkopf` (or `pipx uninstall dummkopf`).
3. Nothing else changes. The installed hooks call `dummkopf` by name and now start the new version.

## Development

The code lives in `packages/core` (library) and `packages/cli` (CLI). See [CONTRIBUTING.md](CONTRIBUTING.md)
for setup, tests and rules.

## License

MIT, see [LICENSE](LICENSE).
