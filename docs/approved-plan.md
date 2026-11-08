# Planner: a minimal Obsidian plugin built around your Markdown

Fixes, 29 October 2026 (0.2.129): whitespace beside the minutes does not
request calculation or rounding of recorded values. Same-value calculation
intent requires replacing selected amount text, not a whole-input replacement.
Locate the written amount field before its activity, including unit amounts;
apply intent only after an input event and ignore programmatic suggestions.
Canceled typing, label edits and draft Undo/Redo preserve recorded values.

Fixes, 29 October 2026 (0.2.128): duration intent follows native text history
independently of label/context changes, including same-text deliberate zero
requests. Restore the earlier intent on Undo/Redo rather than comparing only
with the entire original input. Recheck composer focus after the asynchronous
day read before repainting, preserving history for already-running refreshes.

Fixes, 29 October 2026 (0.2.127): Undo restoring the exact original Edit text
clears duration-change intent. Preserve active Add below DOM/history during
background refresh; flush after leaving/collapsing, while retaining source and
anchor guards for writes. Suggestion serialization checks entry syntax as well
as parsed fields, including attached/trailing numeric activity names.

Audit corrections, 29 October 2026 (0.2.126): with only the end time and minutes
selected, as when Edit opens, chips replace a single-part activity name instead
of being disabled; several parts stay ambiguous. Disabled chips show their
reason as visible text. When Tab must rewrite the line into semicolon fields,
the hint says "adds ; between fields". The native insertion command stays.

Approved suggestion preservation, 29 October 2026 (0.2.125): numeric-leading,
numeric-only and duration-like configured names remain supported. Verify each
chip/Tab replacement preserves the parsed schedule and full name; if compact
input is ambiguous, use existing semicolon fields on that line only. No parser
or historical-note migration. Use an owning-document native editing transaction
for one draft Undo/Redo step per suggestion, retaining earlier/later typing.
Draft history never invokes persistent Planner Undo. Keep unchanged recorded
minutes, zero and explicit over-credit intact with rounding enabled. Unsupported
transactions leave drafts intact with visible errors; never silently fall back
to direct insertion without history.

Owner decision, 29 October 2026 (0.2.120): when nothing is known, `?`, `? ? ?`
and `?; ?; ?` are a gap, written `- [ ] ...`. An unknown end time is written
`? (30) : prj`, entered as `? 30 prj` or `?; 30; prj`; its minutes are required
(`?` when unknown). Such a row credits its minutes when completed and breaks the
time chain like a gap. Existing `- [ ] ?` rows read as before.

Approved component suggestions, 29 October 2026 (0.2.124): Add below, Edit and
Tab share activity-component boundaries. Chips replace the component at the
caret, preserve other components and context, and target the caret line in
multiline input. Omitted activity names offer the normal helpers; the synthetic
`activity` fallback is not a typed search query. Malformed schedules and
selections spanning fields/components never cause a replacement. Parentheses
are protected; select the name outside them to replace it. Retain even malformed
context (`chp (bad` becomes `buffer (bad`) and require explicit repair before
saving. This supersedes the 0.2.123 whole-label/context replacement behavior.
Project-credit explanations distinguish ordinary allocated time, potential
credit, known zero and unknown credit. Gap guidance requires a known endpoint
or explicit unknown endpoint with minutes; empty days retain configured starts.

Approved change, 8 November 2026 (0.2.130): a new activity with a valid end
time, no minutes and no known end time before it (an empty plan, or after a gap)
saves `n/a`: `14:30 prj` on an empty plan saves `14:30 (n/a) : prj` and no longer
inserts the configured start row. Editing the first row the same way also saves
`n/a`; from 0.2.132 so does editing a row after a gap or an unknown end time
(previously refused). A completed project row still needs minutes to earn credit. The configured
start row remains for entries without an end time (`50 prj`) or that request
elapsed minutes (`14:30 / prj`).

Approved display, 8 November 2026 (0.2.130): an activity name that occurs only
once across the indexed daily notes is shown in green until a second occurrence
is indexed. Registered project names keep their project colour. The count is
kept per note and adjusted only for the note that changed; it is display only,
writes nothing, and shows nothing as new while indexing is incomplete.

Correction, 29 October 2026 (0.2.119): `n/a` is a duration not accounted for,
as at the start of a day, so `10:47 n/a` saves `10:47 (n/a) : activity`. Only a
last `?` stays the activity name.

Audit corrections, 29 October 2026 (0.2.118):
- A rounded end time sets the written block. Credit from the clock or a
  percentage stays within the minutes actually entered and is recorded
  against that block (`10:13` rounded to `10:15` saves `13/15`), so each row
  agrees with its times and consecutive rows add up. This replaces recording
  the unrounded elapsed time against a rounded time (`10:15 (13)`), which left
  an interval-difference warning and counted the gap twice.
- A last `?` or `n/a` after an end time stays the activity, as before 0.2.117.
- Tab completion shows the rest of the name faintly after the caret, with a
  small Tab key, only at the end of a line; the field describes it.

Approved activity-entry improvements, 29 October 2026 (0.2.117): omitted names
use `activity` when an end time or duration is supplied. Add procrastination to
the helper defaults, upgrading only the unchanged previous default list once.
Tab completes a matching configured name in Add below and Edit; unmatched Tab,
Shift + Tab, typing in time/minutes/context, modifiers and IME retain their keys.
Round calculated percentages and credited allocations jointly within the actual
elapsed block, including `.9-.1/`; rounding an endpoint must not manufacture
credit. Retain actual elapsed time when credit changes. Preserve explicit
over-credit (`70/60`), literal zero, untouched edits and historical Markdown.
Validate calculations and native interaction in the isolated vault before
installing the verified version. Retain dependencies and tests; create no ZIPs.

Correction, 27 October 2026 (0.2.116): with Round credited minutes on, credit
taken from the end time (blank, / or 0) that rounding changes keeps its elapsed
time, so 10:47 after 10:00 saves 45/47 rather than an unexplained 45.

Correction, 27 October 2026 (0.2.115): a note stays marked as edited until its
own queued automatic update reads it, not only until its debounce timer fires.
A confirmation queued behind a slow operation therefore still reads the edit and
refuses a stale preview.

Correction, 27 October 2026 (0.2.114): before comparing with the preview,
Update summary reads in daily notes whose edits are still within the 450 ms
debounce, including unsaved editor text. A figure typed just before confirming
therefore refuses a stale preview, whether automatic totals are on or off.

Audit corrections, 27 October 2026 (0.2.113):
- Update summary writes only the reviewed change. If the summary text, or the
  change recalculated from the daily notes, differs from the preview, nothing is
  written and the dialog asks for a new review.
- "Paused" is said only after the overwrite guard actually stopped an update in
  this session. Other waiting edits are told to try Retry first.
- Retired periods report their repair message without totalling the range.

Approved summary-review clarity, 27 October 2026 (0.2.112): a summary paused by
differing project totals keeps its own attention entry. The entry names the
summary, counts the saved edits waiting for it, gives each differing project
with both figures, and says that Retry cannot finish them until the totals
agree. Review summary opens the period those edits belong to, including an older
summary, and lists the differing totals first. Update summary for it never
changes the configured summary setting. The pause guard and calculations are
unchanged.

Correction, 26 October 2026 (0.2.110): a leading name ends only at a space,
`(`, `%`, `!` or the end, as before 0.2.109, so `car's` and `chp_notes` name no
project and are not renamed. In a group, a part without a Latin leading name
(`2 chapters`, Persian text) is an ordinary part that keeps its amount position;
it is not reported. The owner-vault comparison again showed no differences.

Approved activity-group fixes, 26 October 2026 (0.2.109): the whole label is one
group split on `&` outside parentheses; each part's first word names it, so
multiword parts work and later words never earn credit. Parentheses describe the
part before them. Empty parts and unbalanced parentheses are reported and block
only when project credit depends on them; new input with them cannot save. Hyphen
checks and first-part credit stay. `(+N code)` is plain context everywhere,
reversing its 0.2.104 retirement; it earns nothing and raises nothing. Split
equally divides whole minutes, or 5-minute units when credits are rounded, so the
suggestion and the saved credits agree. Frozen migration readers are unchanged.
A read-only comparison of 6,698 owner-vault days showed no credit, conflict or
check differences.

Approved syntax follow-ups, 26 October 2026, one version each: (1) state that
times are end times in quick entry, the activity editor, Help and README, with
basics before advanced allocations; name the line text, reason and an example in
the hyphen-joiner, single-amount and retired extra-credit messages; (2) offer
Split equally in the activity editor as a draft-only suggestion; (3) let spacing
before **Actual Sum:** keep updating; (4) add a Fix heading action for the
existing heading-date warning and tests for existing footer protection. Wider
row formatting tolerance needs separate owner approval of the exact forms and a
read-only owner-vault comparison before release.

Declined, 26 October 2026: no wider row formatting tolerance. Only `- [ ]` and
`- [x]` task rows at the start of a line count as planner rows; `*` or `+`
bullets, indented rows and bold/highlight-wrapped rows stay ordinary text. The
owner vault had none of these forms among 22,220 rows.

Approved `&` parser, 26 October 2026: `&` is the only activity joiner and `-`
separates amounts, mapped left to right; writers use ` & `. A hyphen is part of
a name (`check-in`). Registered codes decide project credit. One amount on a
group credits its first component; new quick entries naming a project ask for
one amount each without guessing. Parentheses after the group are literal
context. `(+N code)` extra credit is retired as a blocking note check naming the
explicit form. A hyphen that still joins projects is flagged, never silently
uncredited. The one-time 0.2.61 and `&` migrations read a frozen pre-`&` reader.

Approved offline syntax preparation, 26 October 2026: migrate the owner vault's
unambiguous activity combinations to ` & `, retaining `-` for numeric splits.
Retire extra-credit parentheses into explicit allocations first. In an ordinary
`260 : free (+30 chp)` block, partition elapsed as
`230-30/260 : free & chp`; preserve registered base credit in project blocks.
Keep ordinary hyphenated words, parenthesized context, all project credits,
recorded elapsed, checked states, totals, summaries and unrelated text. Verify
on copies first, then back up and recheck originals. Leave the old plugin
disabled after migration. Parser implementation and installation are a separate
owner-managed step; do not bump the version or create archives for this task.
See `activity-joiner-migration.md` for the guarded offline procedure.

Approved Correct amendment, 26 October 2026: Correct also applies to completed
rows the owner explicitly selects, keeping them checked, with the same preview,
source guard and exact Undo/Redo. This amends the 24 October "unchecked plans
only" limit; unselected rows still never change, and Shift remains limited to
unchecked plans.

Approved single-key row actions, 26 October 2026: A adds below, E edits, S shifts,
R previews corrections, D duplicates, K/J move up/down, and X previews deletion.
Keep C for day context and existing Enter/F2/Delete/Backspace aliases. Show quiet
key hints beside row buttons and list them in shared Help/docs. Use the same
enabled actions and multi-selection semantics as the buttons. Typing, menus,
Report and IME retain their keys; held keys must not repeat row writes. Preserve
draft prompts, validation, confirmations, focus and exact Undo/Redo.

Approved entry order, 26 October 2026: quick entry and the activity editor read
fields in the order of a source row without its punctuation: end time, minutes,
activity (`14:30 30 prj` writes `- [ ] 14:30 (30) : prj`). Time and minutes stay
optional; all other forms keep their meaning in the new position (`50 prj`,
`14:30 30/ prj`, `30-0 prj-lunch`, `.25/ prj`, units, `now`, `?`, `...`,
`14:30 >`). Semicolons follow the same order (`14:30; 30; prj`, `30; prj`,
`14:30 30; prj`, `14:30; prj`) and let a name contain numbers. A number after
the activity, the earlier order, is refused with the corrected form, never saved
as part of the name. This supersedes the activity-then-minutes order in the
input table, the 0.2.52 semicolon order and the examples below; stored Markdown
is unchanged.

Approved recovery storage, 25 October 2026: the recovery journal stores note
changes as edits. Daily and small notes keep their prior text; large notes keep
edits plus fingerprints and are completed from the current note when it matches
one side. Unchanged guarded notes are fingerprints. Finished history keeps the
latest 100 operations for 30 days within a 1 MB budget, dropping the oldest
first; unresolved recovery evidence is never dropped. This amends the
"latest 100 operations, expiring after 30 days" retention below.

Approved 24 October 2026: row actions use Edit, with Shift and Correct adjacent
and showing the selected count like Delete. Correct previews optional changes to
selected unchecked plans only, defaulting to rebuilding end times from written
elapsed durations after each block's preceding unselected activity. Offer explicit
duration matching or preserved-credit elapsed corrections too. Never guess split
credit allocations, change completed/unselected rows, invent missing anchors or
apply corrections in the background. Disable Correct if no option offers a change.
Guard the entire source for preview-dependent writes; retain exact Undo/Redo and
existing Shift semantics. Align Shift's fields/dropdown with proper spacing and
verify native multi-selection, stale anchors, cancellation and narrow layouts.

Approved marker rules, 23 October 2026: legends use marker | range/rule | name,
with any for unrestricted contexts and formatting for highlight/bold rules.
Keep old legend syntax readable. Use no-pro (with an explicit excused context for ✌), no-pro weekends,
low-pro, cool, hot, at-ease and buffer. Highlight only 😣; ✌ is unhighlighted.
Planned at-ease/buffer days suppress 😣/✌/😎 but retain earned 🦥/❄️/🔥.
Explicitly migrate the 11 local summary legends and unambiguous planned rows
with backups and copy-vault verification, preserving minutes, existing bold,
other historical rows and unrelated prose. Never run that migration on startup.

Approved corrections, 23 October 2026: selecting a different activity collapses
Add activity while retaining its draft. Pin edit targets across asynchronous
refreshes; refuse changed/ambiguous targets instead of editing a neighboring row.
Summary date updates are scoped to Days (or leading unheaded legacy rows), never
Bookmarks/Results. Blank days include all registered project codes; template days
inherit the template's footer without appending the full registry.

Approved recovery correction, 22 October 2026: retire obsolete read-only daily
summary checkpoints only after verifying current daily sources and the unique
summary owning each date. Recheck source contents, parsing settings and the file
list before saving the resolution; retain the original checkpoint and reason.
Never replay outdated notes to clear a checkpoint or silently reconcile figures.
Actual writes, Settings operations and Undo/Redo retain guarded recovery. A
current-period summary check cannot dismiss historical recovery. Show affected
source links and corrective actions; distinguish summary scope from recovery.

Approved shared project registry, 22 October 2026: Settings, positive actual daily
footers and explicit summary definitions register project codes globally. Zero
daily footers, ordinary activity words and templates do not. Registration is
sticky until explicit project removal. Settings additions target the current
summary; daily additions/updates target the unique summary owning that date.
Missing/overlapping periods stop automatic writes. Indexing alone does not write
Markdown; missing initial definitions are added only after a validated sync.
Use one searchable Projects Settings list with group selectors and shared removal
preview. Unlink retains activity text/time but subtracts project credit from SUM
and summary totals; delete also removes its activity records/components. Both
restore Settings, groups and notes through guarded recovery/Undo/Redo. These
removal semantics supersede the older unlink contract below.

Approved summary discovery, 21 October 2026: automatically identify Markdown
summaries by thejaz-summary anywhere in the filename (case-insensitive), in any
vault folder. Do not infer summaries from archive folders or headings. Current
summary is thejaz-summary-now.md; keep one explicitly configured write target.
Optional YYYY-MM-DD--YYYY-MM-DD filename dates supply a fallback period; Days
content remains authoritative. Explicit configured summary/criteria paths remain
supported for compatibility. Rename the owner's current and historical summaries
with unchanged contents, preserving their periods, settings references and links.
The configured current write target remains the default for explicit current
summary commands; daily updates now route to their owning summary period.

Approved faster entry, 21 October 2026: bare activity uses a configurable 40m
block; activity plus minutes advances from the preceding endpoint. Credit/elapsed
advances by elapsed, while explicit split amounts without a slash advance by
their sum. Keep explicit-time input. / and /0 both calculate elapsed with an
explicit endpoint; shorten equal single-credit results only when resolving a
shortcut. Default start is 04:45 awake (n/a), inserted visibly and unchecked only
when an empty plan needs a base. One operation includes the baseline and batch.
... is an unchecked intentional gap; it and ? break the time chain and require
explicit re-anchoring. No automatic closing activity or end-setting control.
Protect stale endpoints and empty-plan assumptions; preserve raw source outside
deliberate edits and keep recorded totals days protected.

Approved totals-only daily convention, 21 October 2026: ## recorded totals marks
a dated note whose project minutes are authoritative without activity times.
Require at least one project figure and SUM equal to their sum. No checkboxes
may coexist with this convention. Report malformed/duplicate/missing figures
without repairing source, and never compare valid totals against absent tasks.
Count valid records in Review and summaries; label them recorded totals. Edit
figures through ordinary Markdown, with guarded automatic summary updates.

Approved mixed-activity convention, 21 October 2026: pair credit amounts with
leading activity components by position, including ordinary activities. In
`60-210/270 : frm-party (mal runak)`, credit only FRM's 60 minutes and preserve
party's description. Accept optional spaces around name/duration separators;
spaces alone do not split names. Keep legacy one-credit spaced-slash notation.
Missing/mismatched amounts block calculated totals; ordinary components remain
plain text and can be registered as projects from the selected row. No bulk
note rewriting or new metadata.

Approved interface correction, 21 October 2026: use centered native outline
icons and aligned header controls; day navigation appears only in Day. Review
filters form a responsive grid, and its sections share a subtle divider and
consistent spacing. Marker legends/counts are slightly larger and arranged in
clear aligned columns. Preserve all calculations, filters and Markdown.

Approved correction, 21 October 2026: bold only the slash between numeric
credit/duration values, such as 123/140; n/a retains normal weight. Widen the
shared day-column gaps slightly while retaining alignment and tight row spacing.

Approved correction, 21 October 2026: keep the focused row outline within its
selection box so it cannot overlap adjacent activity text. Sort Review project
group totals by credited minutes descending, including Unassigned; retain the
configured order for equal totals. No source note changes.

Approved follow-up, 21 October 2026: share the time/duration/activity columns
across the day's sections so activity labels align with mixed duration widths.
Quick entry uses Enter to submit all lines and Ctrl/Cmd+Enter to insert a new
activity line at the caret. Preserve multiline preview/validation/recovery and
inline editor Enter behavior. Render duration slashes in bold; Markdown stays raw.

Approved styling correction, 21 October 2026: row and inline editing buttons
have white backgrounds and black text, retain rounded shapes/lowercase labels,
and show subtle purple-tinted hover, keyboard-focus and pressed states with
brief transitions. Respect reduced motion. Duration chips remain purple.

Approved follow-up, 21 October 2026: planner action buttons remain lowercase;
Settings/headings keep normal capitalization and the automatic group label is
Unassigned. Display all duration values as rounded light-purple chips with dark
text, removing only rendered parentheses/colon. Style row/inline edit action
buttons as matching rounded chips. Deletion confirmation initially focuses its
delete action so Delete then Enter confirms; Escape still cancels. Preserve
ordinary Markdown and existing guarded, recoverable deletion behavior.

Correction, 21 October 2026: lowercase applies to planner vocabulary such as
emoji legends and inline project prefixes, not the whole interface. Preserve
normal capitalization in Settings, buttons, dialogs, tabs and other UI labels,
and preserve user-entered group names. No global lowercase text transformation.

Approved follow-up, 21 October 2026: projects without a custom group belong to
the automatic unassigned grouping in Review, including its summed credit and
zero-credit projects in the current range. Respect date/project filters; keep
membership derived inside the app without writing grouping data to notes.

Approved clarification, 21 October 2026: `(context: name)` defines a selectable
day context; `(formatting)` describes a visual convention, not another counted
category. Each emoji count shows its visible lowercase legend. Day records are
collapsible. One context selector reads the legend and defaults to ordinary.
Excused produces light can't study (✌) only at 0-29m. At higher minutes, use the
ordinary productivity marker; no hidden context metadata is added. Planner
vocabulary uses lowercase ASCII; other interface labels retain normal case.
Project codes in totals are uppercase; inline project prefixes are lowercase. Preserve note
content, file names, source previews and editable values.

Approved follow-up, 21 October 2026: Settings can define named project groups
with each project in at most one group. Review shows their summed credit in a
subtle, slightly more prominent text row; groups live only in plugin settings.
Count actual summary emojis, highlights and bold day rows according to a
selected note's Criteria & Markers legend. Do not reclassify saved markers from
minutes. Report discrepancies with exact source links and a clear correction
route. Weekend days are selectable (Friday default); settings changes never
rewrite notes. Future summary rows/markers honor the configured weekend days.

Approved follow-up, 21 October 2026: quick-entry `?` creates `- [ ] ?`;
`12:55 >` creates `- [ ] 12:55 (n/a) : >`, including in Log mode. Neither
earns credit. Unknown endpoints break elapsed-time chains; timed arrows provide
an endpoint for the following activity. Checked unknowns mark completed credit
incomplete while preserving known subtotals and authoritative daily/summary
values. Never fill unknowns implicitly. Preserve intentional credit exceeding
elapsed time with the existing non-blocking warning.

Approved replacement, 23 October 2026: replace the dialog and three-field inline
editor with one Edit activity action. Use the purple compact-input panel beneath
the original row, hiding that row while editing. Prefill time/activity/duration;
Save changes updates only that row, retaining status, section and position.
Cancel/Escape/close discard. Enter/F2/double-click open the same editor. Keep Add
below unchanged with a separate draft. Prompt Save changes/Discard/Stay before
leaving unsaved edits. Preserve literal stored zero unless deliberately edited;
reject multiline edits, retain drafts on errors/conflicts, and preserve existing
recovery/Undo/Redo. No duplicate activity or full-row preview while editing.

Approved follow-up, 23 October 2026 (0.2.51): E edits the selected activity
(F2/Enter remain). Arrow keys outside a field move focus into the activity list,
and a Focus activities command does it from anywhere. Day/Review become one
Activity/Report toggle using the existing accent colours; V toggles it inside
the planner, with a command for a global hotkey. The compact editor explains its
interpretation (end time, elapsed time and start, per-project credit, rounding)
without a full-row preview. Help is sectioned, current and concise. A command
(and `,` inside the planner) opens Planner settings. Shift becomes a row action
beside Add below/Edit activity; its dialog keeps durations, matches them to the
new elapsed time, or keeps credit and records the new elapsed time. Optional
settings round entered times and/or credited minutes to 5 minutes; they apply to
new input only and never rewrite existing values. Percent credit uses decimal
fractions of elapsed time: `.25/` (25% of the elapsed minutes), `.1-.9/` for
several projects in order, or `.5/60` with explicit elapsed minutes. Fractions
are converted to ordinary minute credits on save, rounded to whole minutes or 5
minutes per the setting; Markdown never stores the percentage notation.

Approved follow-up, 23 October 2026 (0.2.52): an entry is one activity, so percent
credit takes exactly one fraction (`.25/` of the elapsed minutes, or `.1/20` of an
explicit 20-minute duration); several fractions are rejected. Semicolons may
separate the three fields explicitly (`10:20; prj; 20`, `prj; 20`, `10:20; read
two chapters`), alongside the existing space-separated form. The Activity/Report
control is a compact segmented control in the plugin's bordered button style.
Planner shortcuts follow one table shared with Help; they work wherever focus is
inside the planner (including after redraws and clicks on empty space), never
while typing or with unexpected modifiers. Examples and new-install defaults use
generic names (prj, std, wrk, gym) and register no personal project codes.
Activity helpers come from a lowercase list in Settings (default: break, free,
buffer, setup, awake, lunch, dinner, breakfast) plus registered project codes; they
no longer copy the current day's labels.

Correction, 23 October 2026 (0.2.53): percent credit gives one amount per
activity. A single activity takes one fraction (`.25/`, `.1/20`); a combined entry
such as `pr1-pr2` takes one per activity, in order (`pr1-pr2 .5-.5/`, also
`10:40 pr1-pr2; .5-.5/`). A count that does not match is rejected with the
expected number. `time activity; minutes` is accepted as a two-part semicolon form.
Totals the planner itself last wrote are not "recorded values": when an update was
blocked (for example by an out-of-order time) and the conflict is later fixed, the
footer follows the activities again. Only a footer that differs from the planner's
last write is preserved as the user's own. Gaps (`...`) are not counted as
unknown activities.

## 1. Purpose and boundaries

Build a fast, polished planner for your existing workflow. **The Markdown files remain the complete, human-editable record.** The plugin provides a convenient interface and handles calculations without introducing its own notation.

Decisions established:

- Windows desktop first.
- A dedicated planner tab, with immediate access to the original note.
- Automatic updates after unambiguous edits.
- Completion requires your action; passing time never earns credit.
- Quick logging and planning, without a live timer in version one.
- Selectable Markdown routines for creating days.
- Compact historical review by date range and project.
- Recorded historical totals remain authoritative; discrepancies stay visible.

Approved follow-up for 0.2.0: `0` and `/0` entered in the planner calculate elapsed
minutes on save, preserving explicit credits. Existing stored zeroes remain
literal. Tighten rows and headings toward native Markdown styling, simplify quick
entry, show bold colored projects and always-visible pastel total chips, and
increase Review text size and contrast.

Approved follow-up, 20 October 2026: project management offers explicit unlinking
and removal across planner records. Preview exact changes before applying them;
keep note changes recoverable together. Unlink preserves activity wording and
daily recorded totals. Removal must preserve other projects and unrelated prose,
and stop for ambiguous allocations. No bulk repair runs against the working vault.

Approved follow-up, 20 October 2026: retain pastel project-chip colors after
making chips clickable. Show Day/Review project totals in descending time order;
sort the summary's project totals by time while preserving values, emoji and
surrounding prose/separators. Equal totals keep their relative order.

Development takes place in this repository. Existing notes and archives require no migration. Version one excludes cloud services, AI dependencies, calendar integrations, and automatic archive reorganization.

## 2. Interface and daily workflow

### Appearance

Use one restrained planner tab with two views: **Day** and **Review**.

The Day view contains:

- A small date-navigation header.
- One quick-entry field.
- Morning, afternoon, and evening sections matching the note.
- Compact rows showing checkbox, end time, duration/credit, and activity.
- A quiet totals footer, with details available when needed.

Follow Obsidian’s current theme and font settings. Use aligned numerals, subtle separators, visible keyboard focus, and existing project icons sparingly. Avoid large cards, decorative dashboards, excessive colour, and persistent toolbars. Controls appear on focus as well as hover.

The original note remains one shortcut away, positioned at the selected activity. Switching views preserves selection and scroll position.

### Quick entry

Provide explicit **Log** and **Plan** modes. Log creates completed entries; Plan creates unchecked entries.

Accept compact input:

| Input | Meaning |
|---|---|
| `09:35 chp` | Activity ending at 09:35; derive its duration from the preceding known endpoint. |
| `now chp` | Activity ending now, in the configured time zone. |
| `10:50 70/120 chp` | Explicit credited and elapsed minutes (order amended 26 October 2026). |
| `22:25 35-35/70 chp-mdr` | Split credit between projects in the stated order. |

Show the resulting ordinary Markdown before submission. Accept pasted multiline logs through the same preview. Suggest familiar activities and project codes, but preserve free-text labels exactly.

Quick entry always inserts new rows after the selected activity (or at the selected section start). Existing activities are changed through Edit. There is no unchecked-plan replacement mode.

### Editing and keyboard use

Support adding, editing, duplicating, deleting, checking, and moving rows. Changing one endpoint keeps later endpoints fixed; a separate **Shift selected plans** command moves selected unchecked rows together.

Approved follow-up, 21 October 2026: select an inclusive range with Shift-click
or Shift-arrow keys, shrinking it when reversing direction. Delete the selected
activities as one confirmed, recoverable operation through Delete/Backspace,
the row action or command palette. Preserve headings and other source text;
Undo/Redo includes saved daily and summary totals. Text fields keep native text
editing. Clear stale ranges when the source activity list changes.

Within the planner, outside text fields:

- Arrow keys move between rows.
- `Enter` edits; `Space` toggles completion.
- `Tab` moves through editing fields; `Escape` cancels.
- `Ctrl+Enter` submits quick entry.
- `Ctrl+Z` undoes the last planner operation.
- `Ctrl+Shift+O` opens the selected source line.
- `?` shows the compact keyboard reference.

Expose all actions through Obsidian’s command palette. Global shortcuts remain user-assignable, avoiding existing bindings.

### New days and review

New days use a selected ordinary Markdown routine or a minimal blank scaffold. Remember the last routine; initially select the minimal scaffold. Support the existing template’s enclosing code fence without copying that fence into daily notes.

Create `YYYY-MM-DD.md`, substitute the heading date, clear checkboxes and footer totals, and preserve planned durations. Existing files open instead of being overwritten.

Approved follow-up, 21 October 2026: explicitly replace an existing day's plan
from a selected Markdown template. Show the resulting note and activity counts
before applying. Replace existing activities (including completed ones), reset
credited totals, retain other daily-note text and keep the template unchanged.
Reuse grouped source/summary recovery, Undo and Redo. Stop if previewed source
or template content changes. The existing Create day action remains non-destructive.

Review defaults to the current summary period. Approved 20 October 2026: replace calendar week/month/year presets with Past 7 days, Past 30 days, Past 6 months, Past 12 months, This summary period, and All data. Every preset ends today, inclusive, in the configured time zone rather than the selected planning day. Keep manual date editing, project filtering and links back to evidence. Show credited time, daily averages, project totals, and missing or disputed records. Average denominators must be labelled; missing days must remain distinguishable from recorded zero days.

## 3. Markdown and calculation contract

### Preserve the current aesthetic

New notes follow your latest conventions:

- Lowercase headings and activity labels as supplied.
- `- [ ] HH:MM (duration) : activity`.
- Existing `?`, `n/a`, annotations, and section ordering.
- Three-digit minimum padding for footer values.
- Your current project grouping and order:

```text
IRP, TRN, STR, NVE, QYN, MDR
STD, TCH, CAR
FRM, CHP, JIB, HAY
PRT, ORG, ZOT, MED
SUM
```

Preserve existing sparse or full footers. A **Compact footer** command removes zero project rows while retaining project order and `SUM`.

Never insert frontmatter, hidden IDs, HTML comments, custom code blocks, or plugin-specific markers. Preserve unrelated text, blank lines, line endings, and existing formatting.

### Time and credit rules

Maintain separate concepts for **clock interval**, **recorded credit**, and **completion**.

- A numeric duration on a completed project entry supplies its recorded credit.
- `70/120` credits 70 minutes.
- `35-35/70` allocates 35 minutes to each named project.
- Support any number of explicitly matched project allocations.
- Unchecked entries contribute to planned totals only.
- Unknown or malformed values remain unknown, never silently zero.
- Only recognised project labels contribute to project totals; ordinary activities remain in the timeline.

For new entries, calculate durations when neighbouring endpoints make them unambiguous. Preserve explicit credit when timestamps change. Existing numeric values that disagree with clock intervals receive a diagnostic rather than automatic replacement.

Recognise straightforward midnight crossings, including your recent late-night entries. Ambiguous backward times require correction; do not interpret every backward time as a new day.

### Summaries and history

Maintain the existing summary note’s daily rows, productivity icons, project totals, and actual-results figures within its stated reporting period.

- Calculate totals from source records, rather than repeatedly adding increments.
- Preserve context markers, weekend formatting, highlights, bookmarks, and projected targets.
- Apply the current numeric thresholds for 🦥, ❄️, and 🔥.
- Default weekends to Friday.
- Preserve supplied “can’t study,” “light can’t study,” “at ease,” and “buffer” context. A low weekday total alone does not establish that context.
- Treat historical marker rules according to their own summary period.

Read older range-based schedules and hour/minute totals through a separate compatibility parser. Use recorded daily/project totals where available; otherwise use confidently understood completed entries. Leave unattributable time explicitly unallocated.

Daily notes and aggregate summaries must never be counted twice. Duplicate dates and conflicting totals appear in a reconciliation list with both values and source links.

Initial indexing is read-only. Historical discrepancies are changed only through an explicit reconciliation action. Routine edits to a consistent day update its derived totals automatically; a disputed day remains flagged until resolved.

## 4. Implementation, reliability, and speed

### Small, maintainable architecture

Use TypeScript, esbuild, native Obsidian controls, and scoped CSS, without an additional UI framework or other plugin dependencies.

Separate four components:

1. **Markdown reader:** returns entries, recorded totals, source ranges, and diagnostics while retaining the original text.
2. **Calculation engine:** computes intervals, allocations, summaries, and comparisons independently of Obsidian.
3. **Change planner:** produces minimal text patches against a specific source revision.
4. **Obsidian integration:** handles views, commands, file events, safe writes, and recovery.

Keep settings, rebuildable indexes, and recovery records in the plugin’s own configuration directory. None may become the sole storage location for planning information.

Use public Obsidian APIs. Open editor documents receive targeted editor transactions; background note changes use revision-checked `Vault.process()` operations, following [Obsidian’s file-update guidance](https://docs.obsidian.md/Plugins/Vault).

### Safe automatic updates

- Commit planner edits on submission; debounce manual note edits until typing has settled.
- Re-read and verify the affected source before applying a patch.
- Recompute after unrelated concurrent changes; stop on conflicting changes.
- Suspend automatic overwrites when the user directly edits a derived total into disagreement.
- Preserve incomplete text and allow unaffected parts of the day to remain usable.
- Prevent file-event loops and repeated application of the same update.
- Retain recoverable pre-change content for the latest 100 operations, expiring after 30 days.
- Make undo conflict-aware so it cannot overwrite subsequent manual edits.

A daily note and summary are separate files, so saving both is not a single atomic operation. Save the source first; if summary maintenance fails, retain the source, show the pending update, and retry safely. Recovery after restart must detect interrupted operations.

Diagnostics should identify the exact line, explain the issue plainly, and offer a specific action. Avoid repetitive notices during typing.

### Performance targets

Keep startup limited to registration; defer historical indexing until the workspace is ready, consistent with [Obsidian’s startup guidance](https://docs.obsidian.md/plugins/guides/load-time).

Read today first, index archives in small background batches, and update only changed files. An invalid cache triggers rebuilding without modifying notes.

Acceptance targets on your Windows computer:

- Warm Day view opens within **150 ms**.
- Keyboard actions and local calculations respond within **50 ms at the 95th percentile**.
- Normal saved edits update dependent totals within **one second after editing settles**.
- Archive indexing produces no individual main-thread task longer than **50 ms**.

These are measured release targets, not assumed performance claims.

## 5. Delivery sequence and acceptance

Implement in this order:

1. **Reader and calculation foundation:** representative fixtures, historical compatibility, discrepancy reporting, and proof that reading changes nothing.
2. **Day workflow:** visual layout, quick entry, routines, keyboard editing, and source navigation.
3. **Safe automation:** minimal writes, totals, summary maintenance, undo, concurrent edits, and crash recovery.
4. **Review and release:** historical views, accessibility, performance measurements, packaging, and concise maintenance documentation.

Validate against copied notes before testing writes in the working vault.

Required checks:

- October 16: `NVE 325`, `SUM 325`.
- October 17: `MDR 90`, `FRM 10`, `CHP 90`, `JIB 265`, `SUM 455`.
- October 18: `CHP 30`, `JIB 340`, `SUM 370`.
- October 19: `MDR 135`, `CHP 230`, `SUM 365`.
- Two-, three-, and four-project allocations; unchecked plans; unknown anchors; repeated timestamps; and midnight crossings.
- Historical formats, sparse footers, bold `add` annotations, inconsistent recorded totals, and unallocated time.
- Concurrent manual edits, duplicate dates, renames, write failures, restart between saves, undo, and cache loss.
- Repeated refreshes produce no additional changes.
- Unchanged parts of notes remain byte-for-byte intact.
- All daily operations work with the keyboard alone; focus and selection remain stable.
- Disabling the plugin leaves readable, editable, complete Markdown with no cleanup required.

Deliver editable source, a reproducible build, automated correctness tests, the installable plugin package, and a short guide covering shortcuts, conventions, recovery, and updates.

An explicit zero-only recorded-totals day (`SUM = 0`) is complete without a
project allocation. A nonzero recorded SUM still requires project figures.

## Approved project emoji contract (0.2.45)

Each project has one persistent emoji. Different projects may share it. Preserve
existing summary assignments; choose and save random missing assignments once.
Settings offers an emoji editor with random/save/cancel and optional emoji on
creation. Blank values request a random emoji; re-adding an existing code without
an emoji preserves its assignment. Validate one complete Unicode emoji.

Day, recorded-totals and Review chips display the assignment with code and
duration, retaining colors, sorting and zero visibility. Synchronize only emoji
prefixes on existing summary project rows; new definitions use the registered
emoji. Manual conflicts offer adopt-globally or restore-assigned actions with
source links. Settings and summary changes share guarded recovery and Undo/Redo.

Remove the owner's stale IPM registration and group assignment only after
checking for newly attributed work. CAR remains the registered project;
`car (ipm)` and historical IPM Proposal prose remain intact. No aliases, daily
Markdown rewrites, template edits or Desktop archives are authorized here.

## Approved rename and merge contract (0.2.46)

Provide one compact Rename or merge project dialog in Projects Settings and
project-chip management. Rename requires an unused code; an existing code offers
an explicit switch to merge. Both require a preview and a separate apply action.
Installing this feature performs no rename, merge or note migration itself.

Use parser-recognized references in dated daily notes, recorded/historical
totals, configured/discovered summaries and current/archived templates in the
configured routines folder. Preserve complete-token boundaries, ordinary prose,
descriptive parentheses, similar words, Markdown formatting and template fences.
Activity replacement codes are lowercase; definitions/Settings are uppercase.

Rename transfers registration, emoji and group without changing amounts. Merge
adds credit into the existing destination while preserving daily SUM, overall
productivity, elapsed time and separate sessions. Combine explicit same-row
allocations at their first affected component; combine footer/summary rows only
within their own record or period. Retain the destination emoji and group,
including Unassigned, and remove the source identity. Never create aliases or
infer duplicate work from matching sessions.

Preview minimal changes with line context, per-record amounts and actionable
source-linked blockers. Simulate before/after interpretation; block target-name
collisions that would change ordinary activity meaning, unsafe arithmetic,
affected ambiguity, duplicates or conflicting attribution. Preserve unrelated
existing discrepancies and support known aggregate-only history.

Revalidate Settings, source contents and the discovered file list. Group notes,
templates, emoji and registry/group changes in guarded recovery and Undo/Redo.
Retain interrupted evidence and prevent further management writes until recovery
is resolved. Refresh caches, suggestions, Settings and project filters. Verify
on isolated fixtures, install the exact tested build, retain recovery evidence,
recycle disposable output and create no Desktop archives.


## Excused legend label amendment

Use `✌ | 0-29m | no-pro (context: excused)`. The explicit context carries
the distinction; retain the excused context ID and all marker behavior.

## Clear context choices and dependable marker rules (23 October 2026)

Keep three-column legends and legacy syntax. Normalize marker identities,
ranges and context IDs into typed shared rules; names are presentation only.
Validate incompatible/duplicate definitions, overlapping earned ranges and
missing coverage before generating writes. No-pro alternatives share their
zero-based range below earned productivity; planned contexts require any.
Keep recorded historical report counts and expose problems without repairing.

Replace the context dropdown with compact selectable rows from the legend,
plus the UI-only 🌞 Ordinary day clearing choice, live result and range expiry
explanation. Add Activity-view C through the shared shortcut/help table, ignoring
typing. Resolve context through the unique summary period owning the date,
including archives, using its legend unless Marker source overrides it. Store
only in the summary; never add daily-note context markers. Recheck ownership,
row and rules on Save; retain the choice on conflicts. Preserve exact Undo/Redo,
and make unchanged saves/Cancel no-ops. Test core/recovery and native isolated
keyboard, archive, conflict and narrow-layout behavior before installation.
No historical migration or ZIPs; retain dependencies and reusable tests.

Presentation clarification: preserve authored marker-label spelling and case
through parsing and display. Do not capitalize context IDs for the picker;
the clearing choice is 🌞 ordinary day. Use ASCII interface punctuation while
retaining emojis. The combination policy remains defined in the core, with
ranges/names/context IDs configured by the legend. Document existing absent-
legend fallback versus invalid supplied rules; do not change this policy as
part of the presentation correction.

## Markdown-defined combinations (latest approved behavior)

Define combination rules in a child Combination rules subsection of Criteria &
Markers, using exclusive | comma-separated markers | readable group name and
replaces | marker list | marker list. Parse, preview, generate and validate from
those rules, not built-in emoji-combination lists. Missing/empty rules permit all
saved combinations, preserve them during updates while minute ranges apply,
and do not add markers merely because they are permitted. Invalid rules block
writes with actionable errors. Keep the picker a single-choice replacement action.
Reports use each period's rules, unless an explicit marker source overrides them.

Insert the familiar four-rule block into all 11 current/archive summary legends.
This is insertion-only: leave recorded day rows, minutes, formatting, labels,
project totals, Bookmarks, Results and prose untouched. Verify exact patches on
copied notes in isolated Obsidian, back up originals outside the project, guard
source contents, then apply and verify. Preserve rollback, dependencies and
reusable tests; recycle disposable output. Build/install after checks; no ZIPs.

Latest simplification: exclusive-rule group names are optional and omitted in
the canonical example. Keep older named groups accepted. Use lowercase
combination rules in notes and the picker. Apply only these presentation edits
to the 11 current/archive summaries, preserving behavior and every day row.

## Syntax settlement (0.2.61)

Settled with the owner item by item; one grammar for the whole vault.

1. Elapsed: a blank amount is taught (`14:30 prj`); `30/` credits 30 and records
   elapsed. `0`, `/` and `/0` are accepted, not taught.
2. `-` is the only joiner between amounts and activities; `+` and `|` are rejected.
3. No `/` in activity names: `prj-lunch (30-0)`.
4. Input units `1h`, `1h30`, `1h 30m`, `90m` are saved as plain minutes.
5. Specific error messages for common mistakes. Credit above elapsed stays allowed
   (`70/60`), and fractions above 1 (`1.2/60` saves `72/60`).
6. Lenient times (`9:5` saves `09:05`) and extra credit `prj (+15 std)` are kept;
   extra credit is the only meaning of `+`.
7. The colon before the activity is optional when reading; writers include it.
8. `LABEL = number` everywhere, unpadded: `CHP = 30`, `SUM = 30`.
9. Summaries use ISO dates: `2026-05-24 = 300 ☁️🔥`,
   `Days (2026-05-24 - 2027-05-23)`. Daily headings keep `## plan for 23.10.26`.
10. ASCII placeholders: `?`, `...`, `n/a`; untimed `- [ ] ...` is the preferred gap,
    a timed gap is `19:00 (n/a) : ...`, the anchor is `12:55 (n/a) : >`.
11. The legend is unchanged; `any` and `formatting` are its two non-range values.
12. Retired forms are blocking note checks naming the new form, never silently
    counted or dropped.
13. Existing notes, routines (including `_Codes/_archive` and fenced bodies) and
    pre-plugin history are converted once by `tools/migrate-syntax.mjs`, which
    refuses any note whose counted minutes would change.

## One criteria note (0.2.62)

Criteria & Markers live in one note named `thejaz-criteria.md` (created at the
vault root), found by name like summaries and followed when moved. Every summary,
Review and the context picker use it; it replaces the Marker source setting. Two
notes with that name block marker writes with a message naming both. A Criteria &
Markers section left in a summary is ignored silently. Without the note, built-in
minute ranges apply and day contexts are unavailable. The owner's 11 summaries
held the same legend; it was moved once into the note and removed from each
summary (with its trailing `---`), verified to read identically, backed up first.

## Planner days by content; `## plan for 5 oct 26` (0.2.63)

The daily heading is `## plan for 5 oct 26` (day without a leading zero, lowercase
three-letter month, two-digit year); templates use `## plan for ?? ??? 26`; the
planner writes it when creating days and shows it as the day title. Historical
notes and templates were converted once. A `YYYY-MM-DD.md` note in any folder is a
planner day only with a `## plan for …` or `## recorded totals` heading and a
`SUM = n` line (outside fences); other date-named notes are ignored silently. Two
planner days for one date: the one in the folder with the most planner days counts
(ties: shorter path, then alphabetical) and Review names the other; nothing
blocks. Creating a day whose name a non-plan note holds asks first; consent adds
the plan on top and keeps the note's bytes below. A retired or mismatched heading
is a non-blocking note check.

## Hot-day streak (0.2.99)

A quiet `🔥 6d | best 21d` sits beside Activity / Report and wraps below the tabs
when space is tight. Current is the consecutive hot run ending today, or ending
yesterday while today has not qualified. Best is the longest confirmed run across
all indexed history, including archives, through today. Displayed date and Report
filters do not affect either number.

Use the shared criteria note's parsed 🔥 minute range and authored symbol, not
its readable name or saved emoji counts. Without a criteria note, use >=300m;
a supplied invalid legend or absent hot rule shows an actionable unavailable
state. Daily/summary authority and duplicate handling match Report exactly.
Recorded zero is authoritative, unchecked plans do not count, and unknown/missing
dates break confirmed runs. Context does not pause or grant a streak. This is a
read-only derived display with no Markdown writes or historical reconciliation.

Cache history until source/settings notifications or a changed local date;
refresh after writes, Undo/Redo, criteria/timezone changes, focus/visibility and a
15-second clock check. Clock refreshes repaint only the badge, preserving drafts.

## Quick entry inserts only (0.2.102)

Remove the unchecked-plan replacement selector, state, preview and write branch.
Keep Plan/Log and section choices. Quick entry and Add below preserve the selected
row and all later activities; Edit updates one original row in place.
