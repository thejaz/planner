# Final regression checks

## 0.2.134 verification - 8 November 2026

Obsidian community review follow-up: removed five unnecessary type assertions
(event types read with `in` so both the TypeScript 7 build and the TypeScript 5.9
lint tools accept them), replaced two `document.createElement` calls with
Obsidian's `createSpan`/`createEl`, and added the `Attest release` workflow for
GitHub artifact attestations. Left by design: `execCommand` (native Undo while
typing), vault enumeration (indexing daily notes) and the settings-search API.

- `npm run check`: 780 tests in 51 files, typecheck/build passed; lint zero errors
  and six advisory warnings (two createElement warnings resolved).
- Isolated native checks on the exact build: settings-feedback, emoji-field,
  suggestion-history, compact-edit, settings-section-tooltips and smoke. All 6
  passed. The attestation workflow runs on GitHub after the next release.

## 0.2.133 verification - 8 November 2026

Public-source preparation: neutral time-zone examples (Europe/Berlin in the
Settings hint; Asia/Kolkata keeps half-hour-offset test coverage) and the
`npm run release` publish step. The local history was again collapsed to one
root commit before the first push.

- `npm run check`: 780 tests in 51 files, typecheck/build passed; lint zero errors
  and the eight existing advisory warnings.
- Isolated native checks on the exact build: settings-feedback, smoke,
  first-activities and streaks. All 4 passed.

## 0.2.132 verification - 8 November 2026

Owner-approved: editing a row after a gap or an unknown end time with no minutes
saves `n/a`, matching quick entry, instead of asking for an earlier end time.
Explicit elapsed requests (`/`, `0`) there are still refused.

- `npm run check`: 780 tests in 51 files, typecheck/build passed; lint zero errors
  and the eight existing advisory warnings.
- Isolated native checks on the exact build: compact-edit, unknown-time-edit,
  first-activities, audit-regressions, duration-boundaries and smoke. All 6 passed.
  The new edit case itself is covered by unit tests, not a native helper.

## 0.2.131 verification - 8 November 2026

Independent review of 0.2.130; confirmed findings fixed:
- An empty day's entry hint no longer says every entry uses the configured start;
  a first end time without minutes saves n/a.
- A completed first project saved as n/a now explains how to add minutes (and,
  on an empty day, `/` to count from the configured start).
- `n/a` groups get no garbled `n-0/a` example and no Split equally prompt.
- `n/a` inside a longer label (`n/a (asleep)`, `n/a & walk`) is not counted as
  the activities n and a.
- `IndexedDays` takes no constructor entries, which would have bypassed counts.
Left as approved: editing a row after a gap without minutes still asks for
explicit data; duplicate notes for one date each count toward occurrences.

- `npm run check`: 779 tests in 51 files, typecheck/build passed; lint zero errors
  and the eight existing advisory warnings.
- Isolated native checks on the exact build: first-activities, component
  suggestions (hint text updated), faster-entry, activity-entry, compact-edit,
  smoke, interactions and audit-regressions. All 8 passed.

## 0.2.130 verification - 8 November 2026

A first activity with an end time, no minutes and nothing timed before it saves
`n/a` (no start row); editing the first row likewise. Activity names indexed
only once are green until a second occurrence is indexed, via per-note counts
in `IndexedDays` (`src/core/activity-occurrences.ts`).

- `npm run check`: 778 tests in 51 files, typecheck/build passed; lint zero errors
  and the eight existing advisory warnings.
- Isolated native checks on the exact build: new `obsidian-first-activities`
  (4 checks: n/a preview/save without start row, green first name, normal colour
  after a second note is indexed, green again after it is deleted), plus
  faster-entry, activity-entry, compact-edit, interactions, suggestion-history,
  audit-regressions and smoke. All passed.
- `obsidian-smoke` was flaky before this change: the installed 0.2.129 build failed
  3 of 4 runs the same way (a late redraw replaced the open Plan/Log menu).
  `tools/capture-choice.mjs` now reopens the menu up to four times. Afterwards one
  early run failed once in 2 seconds and was not reproducible; the next runs,
  including a fresh-vault run, passed.

## 0.2.129 verification - 29 October 2026

Fixed the audit finding where a space beside the minutes requested calculation
or rounding. Same-value intent now requires a selection within the written
amount, independent of normalized units or digits in activity names. Whole-input
label replacements preserve unchanged minutes. Canceled beforeinput and helper
transactions cannot leave false calculation intent. Actual amount changes still
calculate, and deliberately replacing selected zero with zero still requests
elapsed minutes.

- `npm run check`: 771 tests in 50 files, typecheck/build passed; lint zero errors
  and the eight existing advisory warnings.
- Exact-build isolated native checks: duration boundaries (8 groups), audit
  regressions (7), suggestion history (8), component suggestions (10), activity
  review (5), unknown-time edits (8), activity entry (8), compact editor (11),
  shortcuts/shift (9). All 74 groups passed, no page errors. Covers unchanged
  saves, context-only changes, literal zero, rounding, explicit over-credit,
  splits, completed/planned status, row counts, canceled typing, helper insertion,
  draft and persistent Undo/Redo, conflicts, deferred refresh, unsaved prompts,
  separate Add below drafts and 300px light/dark layouts.
- Follow-up review examined amount source ranges, programmatic/canceled input,
  history restoration and save guards. A whole-input replacement regression in
  the first patch was caught and corrected before the final full native pass.
  No additional confirmed findings remain in these reviewed paths; this does not
  claim all possible plugin defects have been disproved.
- Exact verified runtime installed with rollback; nine protected owner files
  unchanged. Toggle THEJAZ Planner off/on to activate; owner app not reloaded.
  Evidence/rollback retained outside project, disposable output recycled;
  dependencies and reusable tests retained. No ZIPs or bulk note changes.

## 0.2.128 verification - 29 October 2026

Duration-change intent now follows native Undo/Redo snapshots independently of
retained context/name edits. This preserves zero when undoing just the minutes,
while retaining an earlier deliberate same-text zero calculation request when
undoing a later suggestion. Refresh rechecks composer focus after its async read,
closing the in-flight repaint race without changing source-write guards.

- `npm run check`: 760 tests in 50 files, typecheck/build passed; lint zero errors
  and eight existing advisory warnings.
- Exact-build native checks: audit regressions (7 groups), suggestion history
  (8), component suggestions (10), activity review (5), unknown-time edits (8),
  activity entry (8), compact editor (11), shortcuts/shift (9). All 66 groups
  passed without page errors. Includes annotation-plus-duration Undo, deliberate
  zero intent, exact persistent Undo/Redo, controlled in-flight reads, real
  background indexing, stale-anchor rejection and narrow light/dark layouts.
- Exact verified runtime installed with rollback; nine protected owner files
  unchanged. Toggle the plugin off/on to activate; owner app not reloaded.
  Evidence and rollback preserved outside project; disposable output recycled.
  Dependencies/reusable tests retained. No ZIPs or bulk note changes.

Pure duration-intent cases: `tests/edit-duration-history.test.ts`. Native cases:
`node tools/obsidian-audit-regressions.mjs` in the isolated vault.

## 0.2.127 verification - 29 October 2026

Fixed all three audit findings: Undo back to original Edit text clears duration
intent and keeps literal zero; background refresh waits while Add below has focus
to preserve native history, then flushes after leaving/collapsing; name insertion
checks entry syntax as well as field parsing, supporting `3d modeling`,
`read chapter 2` and `2-chapters` without inventing minutes.

- `npm run check`: 755 tests in 49 files, typecheck/build passed; lint zero errors
  and the eight previously documented advisory warnings.
- Native exact-build checks: audit regressions (4), suggestion history (8),
  component suggestions (10), activity review (5), unknown-time edits (8),
  activity entry (8), compact editor (11), shortcuts/shift (9). All 63 groups
  passed with no page errors. Includes a real background note-index event,
  deferred-refresh flushing, byte-exact zero save and stale-anchor rejection.
- Installed exact tested 0.2.127 runtime with rollback; nine protected owner files
  unchanged. Owner app not reloaded: toggle the plugin off/on. Evidence/rollback
  retained outside project, disposable output recycled, dependencies retained.
  No ZIPs or bulk note edits.

Repeat the new native cases with `node tools/obsidian-audit-regressions.mjs`.

## 0.2.125 verification - 29 October 2026

Suggestion replacements verify that parsing keeps the intended schedule and full
activity name. Numeric-leading, numeric-only and duration-like names use existing
semicolon fields when necessary, on the current line only. Raw units, other
lines/components, context, recorded zero and explicit over-credit stay intact.

Chips and Tab use the same owning-document browser editing transaction. Each
replacement has one native draft Undo step; earlier/later typing and both Redo
bindings remain available. Undoing drafts never invokes saved-operation Undo.
Unsupported/refused transactions retain the draft and show a visible error.

- `npm run check`: 749 tests in 49 files, typecheck/build passed. Lint has zero
  errors and eight advisory warnings: the existing three plus five deprecation
  warnings for the isolated Chromium Undo transaction APIs. Rules are unchanged;
  the capability checks and compatibility choice are documented in maintaining.
- Exact-build isolated native checks: suggestion history (8 groups), component
  suggestions (9), activity review (5), unknown-time edits (8), activity entry
  (8), compact editor (11), shortcuts/shift (9). All 58 groups passed without
  page errors. Real typing tests cover chips/Tab, repeated suggestions, typing
  afterward, earlier typing history, multiline drafts, numeric names, literal
  zero/33m/70-over-60 with rounding, Save/Cancel, persistent Undo/Redo, refused
  transactions and 300px light/dark layouts.
- Installed the exact verified 0.2.125 runtime with rollback. Nine protected
  owner files unchanged; owner app not reloaded (toggle the plugin off/on).
  Evidence and rollback retained outside the project; disposable output recycled.
  Dependencies and reusable tests retained. No ZIPs or bulk note changes.

Run `node tools/obsidian-suggestion-history.mjs` against the isolated vault for
the real-typing Undo/Redo and name-preservation cases. Core/failure tests are
`tests/suggestion-names.test.ts` and `tests/draft-replacement.test.ts`.

## 0.2.124 verification - 29 October 2026

Add below, Edit and Tab now share pure activity-component targeting. Suggestions
remain available for omitted names and follow the caret line/component, retaining
raw time/minute fields, other components and context. Protected selections or
malformed schedules disable chips with an accessible explanation. Choosing a
name retains malformed context and requires explicit correction before saving;
this supersedes the 0.2.123 behavior that discarded it.

Explanations distinguish ordinary allocated time from known/potential/unknown
project credit, including recorded zero. Gap guidance offers a known endpoint or
an explicit unknown endpoint with minutes; empty days keep configured starts.

- `npm run check`: 739 tests in 47 files, typecheck and build passed; lint has
  zero errors and the three existing advisory warnings documented below.
- Exact-build isolated native checks: component suggestions (9 groups), activity
  review (5), unknown-time edits (8), activity entry (8), compact editor (11),
  shortcuts/shift (9). All 50 groups passed without page errors, including
  keyboard chip activation, source preservation, context repair, exact Undo/Redo,
  draft/conflict protection and 300px light/dark layouts.
- Exact tested runtime installed with rollback; nine protected owner files
  unchanged. Toggle the plugin off/on to activate; the owner app was not reloaded.
  Evidence and rollback retained outside the project; disposable output recycled.
  No ZIPs or bulk note edits. Dependencies and reusable tests retained.

Run `node tools/obsidian-component-suggestions.mjs` in the isolated vault for the
new interactions. Core tests are in `tests/activity-target.test.ts`.

## 0.2.123 verification - 29 October 2026

Corrected mixed-allocation preview arithmetic to sum project credit only.
Unknown end times, unknown activities and intentional gaps now have distinct
explanations; timed gaps keep their known clock anchor. Edit helpers replace
invalid activity text before validating the resulting draft and show a visible
error if the time/minute fields cannot be read. Disabled gap completion is
enforced for keyboard actions and core toggles as well as mouse clicks.

- `npm run check`: 722 tests in 46 files, typecheck and build passed. Lint has
  zero errors and the three existing advisory warnings documented below.
- Native checks on the exact isolated 0.2.123 build: activity review (5 groups),
  unknown-time edits (8), activity entry (8), compact editor (11); all passed
  without page errors. These cover invalid-draft repair, visible helper errors,
  gap Space/direct-toggle no-ops, precise preview text, zero/over-credit
  preservation, exact Undo/Redo, conflict protection and 300px light/dark layouts.
- Exact tested runtime installed with rollback; nine protected owner files
  unchanged. Owner app not reloaded: toggle the plugin off/on to activate.
  Evidence and rollback preserved outside the project; disposable output
  recycled. No ZIPs or bulk note edits.

Run `node tools/obsidian-activity-review.mjs` in the isolated vault to repeat
the preview, helper-repair and gap-action checks.

## 0.2.122 verification - 29 October 2026

Fixed unknown-time Edit preservation: `? (30) : ?` retains all fields, renaming
does not round untouched minutes (including literal zero), and helper buttons
retain the `?` endpoint. Newly changed durations still use existing validation
and configured rounding. No bulk note repairs or syntax changes.

- `npm run check`: 713 tests in 45 files, typecheck and build passed. Lint has
  zero errors and the three existing advisory warnings documented below.
- Isolated native checks: unknown-time edits (8 groups), activity entry (8),
  compact editor (11), all passed with no page errors. These include completion
  status, exact Undo/Redo, Cancel, untouched saves, literal zero, helper buttons,
  broken time chains, draft/conflict protection and 300px light/dark layouts.
- Installed the exact tested 0.2.122 runtime with a rollback copy. Nine protected
  owner settings/data/note files were unchanged. The owner app was not reloaded;
  toggle the plugin off/on to activate. Evidence and rollback are preserved
  outside the project; disposable test output is recycled. No ZIPs created.

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
version to patched 2.31.0. Audit both trees with `npm audit` and
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
failures, verified fixes and remaining limits in the local verification record.
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
