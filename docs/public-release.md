# Public release preparation

Keep publication separate from local development. Do not create a GitHub
repository, push code, submit the plugin or produce release archives unless the
owner asks. No Desktop ZIP is needed for an Obsidian Community submission.

## Source privacy

The public source is the reviewed tracked tree, not the whole working folder.
Exclude local configuration, dependencies, builds, vaults/profiles, recovery
records, reports, screenshots of real notes and private backups. The reusable
tests and fixtures must contain only synthetic data.

On 8 November 2026 (0.2.132) the owner had the local history replaced by one
root commit of the reviewed tracked tree, so it no longer holds the removed
owner-specific migration details. The earlier history is kept only as a private
Git bundle outside the project and must never be pushed. Every later commit is
publishable: review new paths and content before each push, as before.

`tools/migrate-syntax.mjs` now converts structured syntax generically. It has no
note-specific filenames or prose replacements. It remains a separate, explicit
maintenance tool with dry-run, backup and conflict checks; plugin startup does
not run it. Private historical recovery copies stay outside the source tree.

## Local verification

Run the core/build checks, the official Obsidian lint checks and the meaningful
isolated native checks described in `debug-checks.md`. Keep native evidence tied
to the exact tested runtime. Audit both development dependency trees. Describe
the full-text cache and recovery retention accurately in the README.

## Obsidian preview and submission

After an explicitly authorized GitHub publication, connect that repository in
the Obsidian Community developer dashboard and run a preview scan against the
reviewed commit. Local ESLint checks do not establish dashboard approval.

When a release is requested, finish the version locally as usual (version bump,
checks, isolated native checks, commit), then run `npm run release`. It refuses
unless `main` is clean, the versions agree, the tag is new and `dist/main.js` is
the native-tested build; then it pushes `main`, tags the version exactly as the
manifest names it and creates the GitHub release with `main.js`, `manifest.json`
and `styles.css`. `npm run release -- --dry-run` checks without publishing.
The `Attest release` GitHub workflow then rebuilds the tag, requires the three
release files to match that build byte for byte, and adds artifact attestations
for them (verify with `gh attestation verify main.js --repo thejaz/planner`).
Run it by hand from the Actions tab, with the tag, to attest an earlier release.
Follow the current official process:

- https://docs.obsidian.md/plugins/releasing/submit-plugin
- https://github.com/obsidianmd/eslint-plugin

The public repository is https://github.com/thejaz/planner. Submitting
it to the Obsidian community list is a separate, one-time owner step.
