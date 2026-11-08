# Planner development

- The approved contract is `docs/approved-plan.md`; keep its scope intact.
- Markdown remains authoritative, readable, and editable without the plugin.
  Never add plugin-specific metadata or markup to notes.
- Validate writes on copied/synthetic notes in the isolated test vault. Never
  run destructive or bulk-repair tests against the owner's working vault.
- Keep the calculation core independent of Obsidian and preserve raw text
  outside deliberate changes.
- Run meaningful core/recovery tests and native Obsidian checks for interaction
  or storage changes. Record evidence and outstanding verification honestly.
- Do not package personal fixtures, copied notes, or recovery data.
- Retain installed build dependencies (`node_modules`) in this working project
  for future builds. Do not remove them as cleanup ballast. Source ZIPs may
  omit reproducible dependencies while preserving package.json and the lockfile.
- After each version, recycle disposable temporary files, package staging and
  test-run output. Preserve source, reusable tests/synthetic fixtures, tools,
  configuration, documentation, installed dependencies and the useful current
  build. Preserve necessary verification/recovery evidence before cleanup;
  never clean the owner's working vault or plugin data. Follow `docs/cleanup.md`.
- Create Desktop project backups and installable plugin ZIPs only when the user
  explicitly asks. A version update alone does not authorize Desktop archives.
  Follow the on-request archive procedure in `docs/cleanup.md`.
- Requested Desktop ZIPs use `YYYY-MM-DD - planner-project - v<version>.zip`
  and `YYYY-MM-DD - planner-plugin - v<version>.zip`, with the current date in
  the user's local time zone. Keep these exact lowercase archive labels.

## Git and sequential handoffs

- Work sequentially in this shared folder. Finish and hand off before another
  contributor edits it. Work on local `main`; local work never depends on GitHub.
  `origin` is the public GitHub repository. Push only through `npm run release`
  when the user asks to publish, and never push other branches or refs. Do not
  create other remotes, branches or worktrees unless the user explicitly asks.
- Everything committed becomes public at the next release: keep personal data,
  real notes and machine-specific paths out of tracked files.
- Before editing, inspect `git status --short --branch` and recent commits with
  `git log -5 --oneline`. Treat existing uncommitted changes as another
  contributor's work; do not include them without establishing ownership.
- Commit after each completed logical fix or feature, following the relevant
  checks, not after every file save. Stage explicit task-owned files or hunks;
  do not sweep unrelated changes into a commit.
- Review `git diff --cached` and `git diff --cached --check` before committing.
  Never discard another contributor's changes or rewrite history without
  explicit user authorization.
- End every completed task with its commit hash, verification results and any
  remaining uncommitted files. If committing is blocked, report the reason
  explicitly and identify the work left uncommitted.
- Preserve `.git` and its history/configuration during cleanup. Keep dependencies,
  builds, artifacts, isolated vaults/profiles, recovery data, logs and secrets out
  of commits. Retain installed dependencies on disk.
- Follow `docs/git-workflow.md` for the short handoff procedure.
