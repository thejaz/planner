# Maintaining Planner

## Offline activity joiner transition

The approved Markdown-only migration and its safety procedure are documented in
`activity-joiner-migration.md`. The offline helper is not part of the production
parser. A migrated vault must keep the previous plugin disabled until the new
parser/writers are independently implemented and verified. Use its private
manifest for exact rollback; do not invoke old plugin Undo across the migration.

## Marker legends and deliberate local migration

`src/core/marker-rules.ts` owns legend parsing, canonical vocabulary, recorded
marker extraction and classification. Reports, summary thresholds and contexts
share these definitions. Leading row markers are separate from annotation emojis.
Only 😣 receives whole-row highlighting; planned contexts suppress no-pro faces.

`tools/migrate-local-legends.mjs` is an explicit local maintenance workflow:
`--prepare` copies the exact 11 matching summaries into the isolated test vault's
hidden migration folder and verifies patches/amounts/bold. `--verify-native`
round-trips those copies through isolated Obsidian storage. Only `--apply` writes
the originals, after native verification, full-scope/content preflight and
verified backups outside the project. It rechecks each original before atomic
replacement and retains rollback copies plus reports. Never package staged
personal notes or invoke the migration automatically. Changed scope/content
requires preparing and verifying again.

## Design

`src/core` contains deterministic readers, calculations, range reviews, and
minimal changes. It has no Obsidian dependency. `src/storage` implements
revision-checked writes and the recovery journal. The controller coordinates
incremental indexing, manual-edit detection, and summary updates. The UI uses
native DOM and public Obsidian APIs; it has no third-party UI runtime.

Daily notes and summary notes are authoritative. The index is expendable.
Recovery files are alternating checksummed snapshots; a write must persist its
pre-change evidence before touching a note. Writes are stored as edits
(`src/storage/journal.ts`): daily and small notes keep their prior text, large
notes only edits plus fingerprints of both sides, completed from the current note
when it matches one side. Guarded unchanged notes are fingerprints. Finished
history is bounded by 100 operations, 30 days and `HISTORY_BUDGET`.

Open editors use an editor transaction followed by the public view `save()`.
Background writes use `Vault.process()`. Rebase only when unchanged surrounding
text identifies the affected span uniquely. Source and summary saves are
ordered and recoverable, not falsely presented as an atomic multi-file write.

Local keyboard scope is pushed only while focus is within Planner and removed
on blur/close. A keydown listener on the view is the fallback when Obsidian's
scope stack does not route a key; each event is handled once. Shortcuts are
defined in `src/ui/shortcuts.ts`, which Help also reads. It is separate from the view scope Obsidian manages. Button
types must use `attr: { type: 'button' }` with Obsidian's DOM helper; otherwise a
Cancel button inside a form can accidentally become its default submit button.

## Build and checks

For the full synthetic regression sequence and evidence requirements, follow
[Final regression checks](debug-checks.md).

Use Node 24 and `npm ci` with the checked-in lockfile.
Keep installed `node_modules` in the working project for future builds; it is
not cleanup ballast. Source archives can omit it because the lockfile restores it.

```text
npm ci
npm run setup:lint
npm run lint
npm run typecheck
npm test
npm run build
npm run package
```

`node tools/release-audit.mjs` is the release gate. It reruns the build and unit
tests and requires the native reports and the native-tested `main.js` in
`.test-vault`. `--private` also requires the owner-vault audits; `--package`
creates and verifies the installable ZIP, so pass it only when one was requested.

`node tools/install-local.mjs` is the local development installer. It requires
the exact build already exercised in the isolated native vault, verifies a
release ZIP when present, backs up the previous runtime and guards note/settings
hashes. A local update does not require creating an archive.

`node tools/migrate-plugin-id.mjs [--vault <dir>] [--backups <dir>] [--dry-run]`
moves an installation from the pre-0.2.85 `plain-planner` ID to `thejaz-planner`.
It refuses while any running Obsidian profile has the vault open, backs up the old
plugin folder and the Obsidian lists it rewrites (enabled plugins, workspace,
hotkeys), copies settings, recovery records and the index with hash checks,
installs `dist`, and recycles the old folder last. A second run reports "Already
moved". Rehearse it on a vault copy before the owner vault.

If Windows networking stalls on an initial dependency fetch, run npm's CLI
with Node's `--dns-result-order=ipv4first` option. Do not change system network
settings or disable TLS verification.

`npm test` covers synthetic fixtures and synthetic inline cases. Regenerate the
fixtures with `node tools/prepare-fixtures.mjs`; no private vault is read.
`tools/audit-vault.mjs`
and `tools/reference_audit.py` are local read-only audits of the owner's vault;
they write reports solely under `artifacts`. The vault comes from an explicit
argument or the gitignored `planner.local.json`, never a built-in path. Do not
run an old audit script merely because its title says read-only:
inspect it for report writes first.

## Native verification

`obsidian-settings-section-tooltips.mjs` checks that Settings sections, dynamic
project controls and dialogs retain accessible names and keyboard focus without
black Obsidian hover bubbles. Smaller native title hints remain; no settings or
notes are changed by the check.
`obsidian-settings-feedback.mjs` checks grouped settings, save/error feedback,
index results and no-op states, successful Undo and summary sync, helper reset,
keyboard focus in the separate Settings window, project-dialog Cancel, and
light/dark narrow layouts. It restores its synthetic settings, journal and notes.
`openSettingsDialog` in `src/ui/settings-feedback.ts` keeps dialogs in the triggering
control's document, preserves focused inputs, and removes local keyboard handlers
on close. The result helpers do not treat an index's caught error or an unresolved
sync as success. Keep hover help off obvious controls whose visible labels and
descriptions already explain the action.

`obsidian-group-spacing.mjs` verifies compact group rows, aligned name/actions,
no overflow at three window widths, and working rename/remove controls.
`obsidian-weekend-layout.mjs` checks Monday-first ordering, responsive alignment
and correct weekday IDs without changing the saved weekend selection.
`obsidian-review-shares.mjs` checks work/day percentage denominators across all
presets, custom ranges, filters, context overlaps, missing totals, aggregate-only
records and light/dark narrow layouts. Shares are presentation only.

`obsidian-compact-edit.mjs` checks the single compact editor, literal-zero
preservation, row count/status, prompts, drafts, conflict retention, Undo/Redo,
Add below and narrow light/dark layouts. `obsidian-inline-edit.mjs` remains an
alias for that replacement suite; the dialog and three-field editor are removed.
Editing uses a pinned source snapshot and skips background redraws while open.
Only explicit Save changes writes; leaving dirty edits prompts Save/Discard/Stay.


Use the isolated `.test-vault` and `.test-profile`, never the working vault.
`prepare-test-vault.mjs` creates a synthetic vault by default. The optional
`--copy-personal-vault` mode copies local owner records for private compatibility
checks; never include that vault or its reports in an archive. Archive/performance
helpers that assert the original private corpus need that opt-in mode. The helper
also copies the installed app archive into
the isolated profile. Launch that profile with a loopback debugging port.
`tools/native-vault.ps1` does all of this, including the trust/relaunch step below,
and `-MainJs <path>` substitutes another build (for example the installed one) to
tell regressions from stale helpers. `bash tools/native-run.sh <helper> ...` runs
helpers in order with `tools/native-reset.mjs` between them and writes
`artifacts/run-summary.txt`.
On a fresh profile, accept the vault trust prompt, then close the window
normally (`window.close()` over the debugging connection) and relaunch. Until
then modals do not open, and a forced kill can discard the trust.

The helpers verify the exact test-vault path before operating:

- `reload-test-plugin.mjs`: copy the current build and reload it.
- `obsidian-smoke.mjs`: normal UI and keyboard flows.
- `obsidian-row-shortcuts.mjs`: all eight single-key row actions, visible key
  hints, multi-selection, disabled controls, move focus, exact Undo/Redo, typing
  and Report guards, held keys, unsaved drafts, quiet accessible editor labels,
  Help, uniform shortcut alignment and narrow toolbar wrapping.
- `obsidian-input-panel-alignment.mjs`: exact blank-day label, routine casing
  and selection, full-width create-day field/footer spacing, Add/Edit row-edge
  alignment, responsive options and unchanged notes after cancellation.
- `obsidian-project-ranking.mjs`: numbered report projects, descending order,
  responsive equal-width columns, aligned numeric fields, light/dark and narrow
  layouts, filtering, chip management and unchanged synthetic notes.
- `obsidian-apply-hints.mjs`: project remove and rename/merge dialogs always
  explain an unavailable apply button; nothing is applied.
- `obsidian-edit-selection.mjs`: opening the activity editor selects the
  double-clicked time, minutes or activity; Edit, E, Enter and F2 select the end
  time and minutes together.
- `obsidian-stale-summary.mjs`: a summary changed outside the index is re-read
  instead of blocking actions; identical errors show one pop-up.
- `obsidian-emoji-field.mjs`: project emoji fields hold one emoji; a new pick
  replaces it and typed text is refused with a hint.
- `obsidian-date-typing.mjs`: typed dates apply on Enter or leaving the field,
  never per digit; Escape restores; calendar picks apply at once.
- `obsidian-startup-wait.mjs`: edits sent during startup are saved, and summary
  updates postponed by indexing finish automatically.
- `obsidian-reliability.mjs`: manual edits, conflicts, recovery, rename, duplicate,
  and corrupt-cache scenarios.
- `obsidian-interactions.mjs`: every daily operation, editor concurrency,
  routines, review presets, and focus/scroll preservation.
- `obsidian-elapsed-ui.mjs`: zero shortcuts, inline errors, preserved raw notes,
  compact layout, visible project chips, light/dark contrast, and narrow panes.
- `obsidian-reconcile-ui.mjs` and `obsidian-reconcile-actions.mjs`: summary
  changes, direct dated actions, nested comparisons, completion, and wrapping.
- `obsidian-attention-status.mjs`: optional-minute help, stale retry baselines,
  persisted completed checkpoints, resolved notices, and actionable blockers.
- `obsidian-inline-entry.mjs`: inline location, row/section actions, empty-section
  insertion, selected-plan preservation, focus/caret/draft preservation, and narrow wrapping.
- `obsidian-collapse-entry.mjs`: collapsed invitation, draft/caret restoration,
  keyboard navigation, Escape, submission, reduced motion, and narrow layout.
- `obsidian-tooltip-checks.mjs`: absence of redundant tooltips, preserved
  accessible names, exact close-icon centering/insets, and useful remaining hints.
- `obsidian-row-actions.mjs`: one inline action strip, neighboring hover,
  extended selection, keyboard access, and wrapping within the current row.
- `obsidian-move-entry.mjs`: cut/insert across headings, repeated moves tracking
  one activity, focus, boundary controls, raw time/credit, and exact undo.
- `obsidian-add-redundancy.mjs`: one add control per selected row, retained drafts,
  focus after closing/saving, and accessible empty-section invitations.
- `obsidian-project-labels.mjs`: footer-defined project styling and quick entry,
  partial recognition, explicit registration, immediate settings refresh, and
  unchanged Markdown even with automatic updates enabled.
- `obsidian-new-project.mjs`: dashed add chip, validation, random emoji/definition,
  grouped note writes/undo, duplicate retries, manually reordered summary totals,
  and actionable errors without touching unrelated text.
- `obsidian-header-buttons.mjs`: visible button shapes, equal heights in light
  and dark themes, keyboard focus/navigation and narrow header wrapping.
- `obsidian-review-ranges.mjs`: default summary range, exact rolling boundaries
  through today despite historical selection, inclusive denominators, all indexed
  history, manual dates and missing-summary recovery.
- `obsidian-action-sections.mjs`: action icons/section dividers, Undo/Redo state,
  exact source restoration, keyboard shortcuts, narrow wrapping and redo branching.
- `obsidian-project-removal.mjs`: read-only bulk previews, unlink/delete semantics,
  grouped Undo/Redo, zero-chip cleanup and stale-preview rejection. Run only in
  the isolated vault; never use owner notes for bulk-removal validation.
- `obsidian-project-colors-order.mjs`: distinct pastel chip colors in both themes
  and on hover, retained management clicks, descending Day/Review totals, and
  byte-exact summary sorting/Undo/Redo preserving values and surrounding text.
- `obsidian-capture-controls.mjs`: fresh Plan default and unchecked submission,
  themed menus/keyboard access, consistent icons, draft/section preservation,
  close-icon centering and narrow wrapping. `capture-choice.mjs` selects these
  native-menu controls in helpers; logging tests must explicitly choose Log.
- `obsidian-branding.mjs`: THEJAZ Planner manifest, commands, settings credit/link
  and the selected sun SVG rendering, centering and theme colors in the ribbon
  and tab. The standalone editable artwork is `src/assets/thejaz-sun.svg`;
  `src/branding.ts` scales its 24-unit geometry to Obsidian's 100-unit icon canvas.
- `obsidian-plan-template.mjs`: existing-day template preview/apply, untouched
  prose and templates, grouped summary Undo/Redo, concurrent edits, changed or
  removed templates and invalid input. Uses an open native Markdown editor and
  checks explicit replacement with automatic updates disabled.
- `obsidian-multi-delete.mjs`: Shift-click/arrow range anchors and reversal,
  disjoint selection, count-aware deletion, text-field key behavior, exact grouped
  Undo/Redo, deleting all rows, confirmation conflicts and stale-range clearing.
- `obsidian-performance.mjs`: explicit release thresholds, browser long-task
  observation, and a byte comparison of all notes across disable/startup.
- `obsidian-footer-lag.mjs`: totals catch up after a blocked update once times are
  fixed; hand-edited totals stay preserved.
- `obsidian-entry-helpers.mjs`: segmented Activity/Report control, V after
  redraws and empty-space clicks, the shared shortcut table, activity helpers in
  Settings, semicolon fields and one-fraction percent credit.
- `obsidian-shortcuts-shift.mjs`: E/F2 editing, focusing the activity list, the
  Activity/Report toggle and V, the editor explanation, sectioned Help, the
  settings shortcut, row Shift duration modes, rounding and percent credit.
- `obsidian-ui-consistency.mjs`: actions resolve an open activity edit first,
  confirmations keep failures inline, Shift plans validation, shared dialog
  footers and the capture options menu.
- `obsidian-audit-fixes.mjs`: transient notices, native settings headings,
  queued Summary note saves with automatic rescans, follow-up reindexing and
  incremental cache reads, with unchanged synthetic notes.
- `obsidian-restart.mjs`: terminate only the verified isolated process between
  source and summary saves, restart it, and verify durable recovery.

Playwright is a development dependency, not included in the release.
Native helpers that depend on automatic updates must set that preference
explicitly; a preceding test may have left it disabled. Status rechecking may
finish satisfied summary checkpoints in plugin recovery metadata, but must
never modify Markdown or resume an interrupted write by itself.
Obsidian displays aria-label as a black hover bubble. The Planner view and
Settings use aria-labelledby and visually hidden text to retain accessible names
without those repeated bubbles. `quietSettingsLabels` handles initial Settings
controls and each project-list repaint; its retained data attribute restores
focus without depending on aria-label. `openSettingsDialog` also handles controls
created after a dialog opens, disconnecting its observer when the dialog closes.
Keep smaller native title hints and aria-description help: suppressing the black
bubbles must not remove those hints or screen-reader names. Do not globally hide
Obsidian tooltips with CSS. Internal activity selection uses its own data attributes.
Native layout checks should resolve and measure the current DOM in one browser
evaluation; a locator resolved before a redraw may refer to a detached element.
Never return an Obsidian view/app object from a browser-evaluation helper:
serialization can traverse the application graph. Return a small explicit
snapshot or `undefined`.

Native evidence is written under `artifacts`. Keep performance targets and
unverified items explicit in the current release verification document (kept
locally in the gitignored `docs/local/`, one `verification-<version>.md` per release). A build alone does not verify
the plugin.

Each native helper refuses a vault other than the repository's `.test-vault`
(`assertTestVault` in `tools/paths.mjs`).
They create synthetic 2001–2007 and 2098–2099 records in that copy. Reusing the
helpers preserves production notes. Run interaction helpers sequentially because
they share the isolated app. Wait for observable state, including completion of
summary writes and source cursor navigation, before asserting their result.

## Messages

Write errors and attention notices for the person using the planner, not for
the code. Each says, in order: what happened, whether their notes are safe (and
whether anything was written), and the one action to take, named exactly as its
button. Say "edit", "note", "summary check" and "compare", not "operation",
"source", "checkpoint", "guard" or "reconcile". The attention panel shows only
actions that can help now, next to the problem they fix; never show a disabled
button that leaves the reader guessing why.

## Updates

After each version, follow [the cleanup policy](cleanup.md): retain development
dependencies and reusable tests/tools, and recycle disposable run output only
after preserving necessary evidence. Desktop project/plugin ZIPs are created
only on explicit request; the same document records their packaging procedure.

Keep version values in `package.json` and `manifest.json` identical. Keep the
core independent of the plugin so a later desktop app can reuse the same
conventions. Any format change needs a real-note fixture and a preservation
check; compatibility changes must not rewrite archives as a side effect.

Zero shortcuts are resolved at the input boundary. Never reinterpret stored
zeroes in the reader. The compact editor tracks whether the duration token was
edited, and an elapsed calculation guards the preceding row against concurrent
changes. Split credits remain explicit. Persist only the resulting ordinary
numeric Markdown.

Package only built plugin files, the guide, and licence. Never include copied
personal notes, test-vault content, journal data, or audit records in a release.
- `obsidian-project-registry.mjs`: shared registration, period ownership, positive
  daily vs zero declarations, excluded templates, unified native Settings,
  Settings/note recovery and Undo/Redo, and cache revision guards. This tool must
  only run against the isolated vault and its dedicated debug port.

## Syntax migration (0.2.61)

`src/core/syntax.ts` holds the one grammar; `src/core/syntax-migration.ts`
converts retired forms and proves counted minutes, recorded totals and summary
rows unchanged. `tools/migrate-syntax.mjs [--vault <dir>]` is a dry run that
writes `artifacts/syntax-migration-<vault>.json`; `--show <text>` prints every
changed line of matching notes. `--apply` requires Obsidian closed, backs up each
touched note to `<backups>/planner-syntax-*`, writes via
temporary files with hash guards and restores on failure. Rehearse on a copied
vault in `.test-vault` first.

## Criteria note (0.2.62)

`src/core/criteria.ts` resolves the one `thejaz-criteria.md`; the controller passes
its criteria to `parseSummary` (`null` when absent, so summary legends are never
read in the plugin). Called without that argument, `parseSummary` still reads a
summary's own legend for core tests and the historical migrations.
`tools/migrate-criteria.mjs [--vault <dir>] [--apply]` moved the legends: it
requires every summary to hold the same section, refuses if the note already
exists, backs up each summary, and proves rows, projects and thresholds unchanged.
Native helpers set criteria with `tools/criteria-note.mjs`; `tools/native-reset.mjs`
restores the vault's first-seen settings and criteria note between helpers.

## Planner days (0.2.63)

`isPlannerDay` and `planHeading` live in `src/core/syntax.ts`; `chooseDay` in
`src/core/day-choice.ts` resolves two plans for one date and is used by `review()`
and `Controller.getDay`. The controller indexes a date-named note only when
`isPlannerDay` holds, and bulk project operations take day notes from the index.
`adoptDay` (in `changes.ts`) backs the "add the plan to this note" choice.
`tools/migrate-syntax.mjs` also rewrites retired headings (approved prose rewrites
run before the converter). Native check: `tools/obsidian-day-identity.mjs`.

## Machine-specific paths

Tools never hard-code a machine. `tools/paths.mjs` derives the repository, its
`.test-vault` and `.test-profile`, and the standard Obsidian install, and reads
personal values from the gitignored `planner.local.json` at the repository root
(copy `planner.local.example.json`): `vault` is the working vault that owner tools
(install, audit, migrations) use, `backups` where they back up first (default
`~/.planner-backups`), and optional `obsidianExe` / `obsidianConfig` overrides.
Owner tools refuse to run without `vault`; native helpers only accept `.test-vault`.

## Hot-day streak

`src/core/streaks.ts` classifies credited totals with the parsed 🔥 range (default
>=300m only when the shared criteria note is absent). `recordedReviewRows()` and
`review()` share one resolver in `core/history.ts`, including daily folder choice,
recorded-SUM precedence and unresolved summary duplicates. The sparse resolver
indexes summaries once and leaves gaps absent; streaks do not expand long empty
calendar spans or inherit Report's 100-year display-range limit.

The controller caches the result until ingest/notifications or a changed local
date. The view repaints the badge separately on focus, visibility and every 15
seconds so drafts and selection remain untouched. Criteria errors are visible;
loading is never shown as zero. `tests/streaks.test.ts` and
`tools/obsidian-streaks.mjs` cover the contract. Report marker counts still report
saved symbols; streaks use numeric credit, so these can intentionally differ.

## Undoable suggestions

`core/activity-target.ts` verifies the intended time, duration and complete label
after replacement. It returns a selected edit range and insertion; ambiguous
names serialize with existing semicolon fields while retaining raw unit amounts.
`ui/draft-replacement.ts` applies that range through the textarea owner's native
Chromium edit transaction. Direct `.value` or `setRangeText` replacements clear
or bypass typing history. Selected replacements, including an unchanged adjacent
character for empty ranges, isolate suggestions from earlier/later typing.

The two Chromium APIs are deprecated and produce five advisory lint warnings;
this compatibility choice is isolated, capability-checked and covered by real
native typing/history tests. Lint rules are unchanged. An unsupported/refused
transaction shows an error instead of inserting without Undo. No editing-history
state is written into notes. Keep the programmatic-edit guard on `beforeinput`
so unchanged minutes are not treated as a deliberate duration change.

`core/edit-duration-history.ts` distinguishes actual amount changes from
same-value calculation requests. Boundary whitespace is not a request; only
replacing a selection contained within the written amount field is. Locate raw
unit amounts before the activity rather than searching normalized digits in its
name. Apply replacement intent on input, not a canceled beforeinput, and ignore
helper transactions. `obsidian-duration-boundaries.mjs` exercises zero, rounded
amounts, explicit over-credit, splits and planned rows through native typing,
draft Undo/Redo, context-only saves, Cancel and exact persistent Undo/Redo.
