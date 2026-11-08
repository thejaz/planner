# Local Git and sequential handoffs

This project uses one shared folder (this repository) on local branch `main`.
Contributors work one at a time. The only remote, `origin`, is the public GitHub
repository; it receives `main` and version tags through `npm run release` when the
owner chooses to publish, never as part of ordinary work. No extra branches or
worktrees are part of this workflow. Git records source changes; it does not install the plugin or
change the owner's notes. `AGENTS.md` is the shared contributor contract, and
`CLAUDE.md` continues to reference it.

## Each logical fix or feature

1. Before editing, inspect the current state and recent work:

   ```powershell
   git status --short --branch
   git log -5 --oneline
   ```

   Treat existing uncommitted changes as another contributor's work. Establish
   ownership before continuing in overlapping files; do not discard or silently
   commit those changes. If they prevent a safe task-owned commit, report why.

2. Make the agreed change and run its relevant checks. Use `npm run check` for
   typechecking, core/recovery tests and the build. Interaction or storage changes
   also require meaningful native checks in the isolated synthetic vault, as
   described in `AGENTS.md`. Record any outstanding verification honestly.

3. Stage explicit task-owned paths, for example `git add -- src/core/example.ts
   tests/example.test.ts`, or use `git add -p -- path` for task-owned hunks in a
   shared file. The example names are placeholders. Avoid blanket staging such as
   `git add .` or `git add -A` during ordinary tasks.

4. Review exactly what will be committed, then commit the logical change:

   ```powershell
   git diff --cached --stat
   git diff --cached
   git diff --cached --check
   git commit -m "Describe the completed fix or feature"
   git status --short --branch
   git log -1 --oneline
   ```

5. Hand off the commit hash, verification results and remaining uncommitted files
   (or state that the tree is clean). If a commit fails, explain the reason and
   what remains uncommitted. Do not rewrite history or discard someone else's
   work without explicit user authorization.

Commit after each completed logical change with its checks, not each file save.
These are contributor instructions; no background auto-committer is installed.

## Repository boundaries

Track source, documentation, configuration, design assets, the lockfile and
reusable synthetic tests. `.gitignore` excludes installed dependencies, generated
builds/artifacts, isolated vaults/profiles, private test inputs, recovery folders,
caches, logs and common secret files. Review new paths before staging: an ignore
rule is not a substitute for checking content. Keep copied notes and recovery data
in ignored local output locations or outside the project. Never force-add them.
Installed `node_modules` and the useful current `dist` build remain on disk.

Repository-local `core.autocrlf=false` preserves file endings without changing
global Git settings. Local `core.whitespace` includes `cr-at-eol` so reviewing
CRLF files does not misreport their carriage returns as trailing whitespace.
Do not normalize existing files incidentally. `.git` is
permanent project state and is protected from cleanup by `docs/cleanup.md`.
The initial commit captures the reviewed current project, without reconstructing
older releases or changing the plugin version. Desktop ZIPs remain on-request.

## History

On 8 November 2026 (0.2.132), at the owner's request, the earlier local history
was replaced by a single root commit of the reviewed tracked tree. The previous
81 commits (0.2.65 to 0.2.132) are kept as a private Git bundle in the owner's
backups folder (`planner-git-history-2026-11-08-314be98.bundle`). Restore it only
into a separate clone for reference; never push it.

## Public-source handoff

Before any authorized publication, follow `public-release.md`. Pushing `main` is
a separate, explicit step; local work on `main` does not depend on a remote.
