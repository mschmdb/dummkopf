# Curator prompt (weekly run)

Working directory: the root of this brain. Run these steps in order.

1. Run `dummkopf sync`.
2. Run `dummkopf curator` and `dummkopf links`.
3. Read the curator report and `{links_file}`. For each finding, propose one action with a one-line reason.
   Allowed actions: `update`, `write conclusion`, `archive`, `delete`, `keep`.
4. Write the result to `{report_dir}YYYY-WW.md` (ISO calendar week, e.g. `2026-40.md`) with `dummkopf write`.
   Content:
   - Frontmatter, so the pre-commit hook indexes the file cleanly:
     ```
     ---
     {updated}: <YYYY-MM-DD>
     {status}: {active}
     {key_fact}: <the count line>
     {summary}: <the same count line>
     {aliases}: [curator, week <WW>]
     {period}: [<YYYY-MM>]
     {entities}: []
     ---
     ```
   - The count line on top: open loops, topics without movement, conflicting dates, stale active notes.
   - The list of proposals, one per finding.
   - The three most striking links from `{links_file}`, each with one line on why.
5. **Change no note, delete nothing, archive nothing.** Only the report is written. A proposal is a proposal,
   not an action. The human decides from the report.
6. Open and name no sensitive paths (see `{paths_file}` and the `{marker}` marker). Both commands already
   leave them out and only count them; copy that count line into the report unchanged.
7. `dummkopf write` commits and pushes. If it exits with code 3, run `dummkopf sync` once more.

The report is a template for a five-minute decision, not an execution. Keep proposals short: one finding,
one proposal, one line of reason. No closing summary.
