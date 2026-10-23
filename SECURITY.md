# Security policy

rcllr guards notes that people mark as sensitive. Reports about leaks of sensitive or out-of-scope notes,
existence oracles, path traversal, symlink tricks or anything that lets an agent read more than it should
are very welcome.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include the rcllr version, your OS and file system, the brain layout needed to reproduce, and the
commands you ran. You get a first answer within 7 days.

## Supported versions

Only the latest release receives security fixes.

## Threat model

rcllr assumes a brain may come from someone else: it can contain symlinks, unusual spellings and hostile
configuration. It does not defend against someone who can already change your notes and then reads them
with `--allow-sensitive`.
