# Project cleanup and requested archives

## Keep the project ready for future development

After each version, remove disposable clutter using the Windows Recycle Bin.
Do not treat a file as disposable merely because its name contains "test".

Always retain:

- The complete `.git` directory, including local commit history and configuration.
  Never recycle or recreate it as cleanup ballast; keep Git maintenance separate
  from disposable-output cleanup. See `git-workflow.md` for handoffs.
- Source, reusable tests, synthetic fixtures and development/verification tools.
- Configuration, package.json, package-lock.json, guides and project instructions.
- Installed `node_modules` for future builds, and the useful current `dist` build.
- Necessary recovery backups and verification evidence. Summarize completed
  checks and remaining limitations in the release verification document before
  recycling raw output; preserve evidence that is still needed separately.

Candidates for cleanup after verification include disposable `.test-vault` and
`.test-profile` runs, temporary scripts, screenshots, audit output, package
staging, temporary archive-restoration folders and obsolete generated builds.
Keep reusable test scripts and synthetic fixtures. Review older releases and
backups individually; do not discard the only useful recovery copy.

Before recycling a directory, verify its resolved absolute path is inside the
intended project or explicitly identified temporary directory. Reject directory
links and unexpected paths. Close only the isolated Obsidian process associated
with this project's `.test-profile` when necessary. Use Windows Recycle Bin
operations; if recycling fails, stop rather than permanently deleting instead.
The owner's working vault, installed plugin data and unrelated folders are
outside cleanup scope.

## Desktop archives: only when requested

Do not automatically create or refresh Desktop ZIPs after a version update.
Create the following only when the user explicitly asks, using the current
matching package/manifest version:

- `YYYY-MM-DD - planner-project - v<version>.zip`: clean, complete development source.
- `YYYY-MM-DD - planner-plugin - v<version>.zip`: installable Obsidian plugin.

Use the creation date in the user's local time zone, ISO date order and these
exact lowercase labels. For example, version 0.2.66 created on 24 October 2026 is
`2026-10-24 - planner-project - v0.2.66.zip` and
`2026-10-24 - planner-plugin - v0.2.66.zip`. This convention applies to requested
Desktop deliveries; the internal packaging filename below remains unchanged.

Procedure:

1. Confirm package.json, package-lock.json and manifest.json agree on the version.
   Run `npm run check` and the meaningful isolated native checks required for the
   changes. Record results and any unverified behavior honestly.
2. Run `npm run package` to create
   `artifacts/thejaz-planner-<version>.zip`. Inspect existing staging and archive
   paths first: this helper overwrites its generated ZIP. Preserve any differing
   archive that is still needed before running it.
3. Verify that the plugin ZIP contains exactly these six files under
   `thejaz-planner/`: main.js, manifest.json, styles.css, README.md, LICENSE and
   docs/maintaining.md. Check ZIP integrity and byte equality of the three runtime
   files against the tested `dist` build. Copy the verified ZIP to the Desktop
   using `YYYY-MM-DD - planner-plugin - v<version>.zip`.
4. Create the source ZIP with a `planner/` root containing the complete `src`,
   `tests`, `tools` and `docs` directories plus .gitignore, AGENTS.md, LICENSE,
   manifest.json, package-lock.json, package.json, README.md, styles.css,
   tsconfig.json, eslint.config.mjs and vitest.config.ts. Review any new development files and
   include them when needed. Include only synthetic fixtures. Name this Desktop
   archive `YYYY-MM-DD - planner-project - v<version>.zip`.
5. Exclude node_modules, dist, artifacts, copied vaults/profiles, caches, logs,
   personal notes, private fixtures, audit output and recovery data from the
   source ZIP. Dependencies remain installed in the working project; the ZIP
   preserves the manifest and lockfile needed to restore them.
6. Verify ZIP integrity and compare source entries with the intended current
   files. Restore into a separate temporary folder, run `npm ci`, `npm run setup:lint` and
   `npm run check`, and compare rebuilt runtime files with the plugin ZIP.
   Report any check that cannot be completed.
7. Never silently overwrite a differing Desktop ZIP. Preserve the existing copy
   or use a distinct filename. Report the exact delivered paths and version.
   Recycle disposable staging and restoration folders after verification,
   retaining necessary evidence and the working project's dependencies.

Synthetic unit fixtures can be regenerated with
`node tools/prepare-fixtures.mjs`. Native test setup defaults to synthetic data;
private compatibility/performance checks require explicit opt-in and must never
be packaged. Historical native evidence paths may no longer exist after cleanup;
durable verification documents record the results and limitations.
