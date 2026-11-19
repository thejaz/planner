# Regression checks

## Focused activity checks

For unknown-time Edit regressions, run `node tools/obsidian-unknown-time-edit.mjs`.
It checks completed and planned rows, unknown names, recorded zero, name-only
changes with rounding enabled, helper buttons, unchanged saves, Cancel, focus,
position, a broken time chain and exact Undo/Redo. Deliberately changed durations
still use the configured rounding; unchanged recorded amounts stay written.

For unnamed entries, activity completion and bounded allocations, run
`node tools/obsidian-activity-entry.mjs` in the isolated vault. It checks
time/duration-only fallback, procrastination defaults, Tab versus normal focus
navigation, Edit/Cancel, exact Undo/Redo, `.9-.1/` with rounded endpoints and a
narrow layout. Keep the helper/defaults checks in
`node tools/obsidian-entry-helpers.mjs` alongside it. Percentage and rounded
allocations share one elapsed-time budget; explicitly written over-credit and
untouched historical values are separate preservation cases.

Use this checklist after changes spanning Planner interactions, reports or
Settings. Keep the installed dependencies. Run all native checks sequentially
against the isolated synthetic vault, never the owner's working notes.

## Core and build

On a fresh checkout, run `npm ci` and `npm run setup:lint`. Run `npm run check`
for official Obsidian lint checks, typechecking, calculation/parser tests,
storage/recovery tests and the build. Confirm package.json, package-lock.json and manifest.json
agree on the version. A documentation or native-test-only fix does not require
a plugin version bump or reinstall when the runtime bytes are unchanged.

## Official lint checker

`npm run lint` runs the official `eslint-plugin-obsidianmd` recommended config
against runtime `src` with type information. Syntax/JSON safety rules remain
active. The root build retains TypeScript 7; `tools/lint/package.json` and its
lockfile isolate the checker with the TypeScript 5 compiler API it requires.
`npm run setup:lint` restores that development-only toolchain without install
scripts. Retain both installed dependency trees for future checks.

The isolated lint dependency tree overrides its older API package's Moment
version to patched 2.31.0. It also pins patched minimatch 11.0.9 for ESLint and two
of its plugins. Audit both trees with `npm audit` and
`npm audit --prefix tools/lint`; neither tree is shipped in the plugin runtime.

Narrow sentence-case options preserve the owner's explicit lowercase actions,
key names, IANA time-zone example and authored note syntax. They do not disable
validation or security rules. Three recommended advisory warnings are reviewed:

- Dynamic settings use the existing API compatible with minimum Obsidian 1.8.4.
  The optional declarative settings/search API requires 1.13; migration is not
  claimed here. Existing settings still work through their own navigation.
- Two detached accessible elements deliberately use their owning document's
  `createElement`, preserving settings-window ownership and plain DOM tests.
  These elements contain no HTML input or user-supplied markup.

The checker has no errors; these advisory warnings remain visible in its output.
No rules are silenced with restricted source-disable comments. A dashboard
preview is a separate check after an authorized public repository exists; see
`public-release.md`. Local lint is not a claim of Obsidian review approval.

## Isolated native pass

Prepare the current build with `powershell -File tools/native-vault.ps1`.
The helper creates a fresh synthetic `.test-vault` and `.test-profile`, launches
isolated Obsidian, and completes its trust/relaunch sequence. Do not pass any
private-vault copy option for the standard regression pass.

Run these helpers with `node tools/<name>.mjs`, calling
`node tools/native-reset.mjs` before each one. Stop and investigate a reset
failure before continuing. The reset restores the synthetic baseline, closes
leftover dialogs and clears only the test journal.

| Area | Helpers |
| --- | --- |
| Settings, help and focus | `obsidian-settings-section-tooltips`, `obsidian-settings-feedback`, `obsidian-apply-hints`, `obsidian-emoji-field` |
| Reports and responsive columns | `obsidian-project-ranking`, `obsidian-review-shares`, `obsidian-review-ranges`, `obsidian-unassigned` |
| Contexts and marker rules | `obsidian-context-picker`, `obsidian-combination-rules` |
| Activity editing and selection | `obsidian-first-activities`, `obsidian-compact-edit`, `obsidian-plan-correction`, `obsidian-edit-selection`, `obsidian-date-typing`, `obsidian-interactions` |
| Project changes | `obsidian-project-transfer`, `obsidian-project-removal` |
| Recovery, concurrency and startup | `obsidian-checkpoint-recovery`, `obsidian-reliability`, `obsidian-startup-wait` |

After streak/header changes, also run `obsidian-streaks` for current/best totals,
archive authority, criteria changes, read-only navigation/filtering, cache reuse,
draft preservation, exact Undo/Redo, clock/focus/wake refreshes, unavailable rules
and light/dark responsive header geometry. `tests/streaks.test.ts` covers numeric
boundaries, finite/custom ranges, recorded zero, duplicates, gaps and calendar
boundaries using the shared Report resolver.

After summary-status or pending-edit changes, also run
`obsidian-pending-summaries`. It needs a seeded period first: close isolated
Obsidian, run `node tools/obsidian-pending-summaries.mjs --seed`, relaunch, then
run the helper. It checks that edits stay pending while project totals differ,
that Retry leaves them pending, and that Update summary clears them. It also
reports per-edit timings.

After row-shortcut changes, also run `obsidian-row-shortcuts` for all eight
single-key actions, multi-selection, typing/menu guards, disabled actions,
held keys, move focus, unsaved drafts and exact Undo/Redo.

`bash tools/native-run.sh <helper names>` is a convenience loop for the same
sequence. Inspect every exit code in `artifacts/run-summary.txt` and each failing
log; the final word `done` alone does not confirm success.

When a native assertion fails, retain its first failure. Distinguish a runtime
defect from a stale expectation or test race before changing plugin behaviour.
Resolve and measure the current DOM in one browser evaluation for geometry:
an element resolved before a redraw can be detached by the time it is measured.
Keep assertions for visible, nonzero dimensions and actual ordering/alignment.

## Record and hand off

Record the tested version, core results, each native helper's result, any initial
failures, verified fixes and remaining limits in the local verification record
(the gitignored `docs/local/`).
Compare the built runtime with the exact files used in the isolated vault before
an install. Check Markdown preservation, errors, keyboard focus and narrow layouts
in the relevant helpers; a successful build is not native interaction evidence.

The 26 October 2026 pass for 0.2.93 passed 576 tests in 34 files and all 20 helpers
above. The project-ranking helper initially measured a detached node; resolving
and measuring the current DOM fixed that test race without a runtime change.
The rebuilt, native-tested and already installed main.js matched byte for byte.
This pass used synthetic Windows desktop data; it does not claim other-platform
or full private-history performance coverage.

Preserve useful reports and recovery evidence outside disposable output before
recycling the isolated vault/profile and raw logs, following `cleanup.md`.
Commit explicit task-owned files after reviewing the staged diff, and hand off
the commit hash, checks and remaining Git status. Create Desktop ZIPs only when
explicitly requested.
