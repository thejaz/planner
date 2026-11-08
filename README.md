# THEJAZ Planner

Plan your day, log what you actually did, and review where your time went —
all in ordinary Markdown daily notes that stay readable and editable without
the plugin.

- **Quick daily planning.** Type `14:30 30 prj` and Planner writes
  `- [ ] 14:30 (30) : prj` into today's note. End times, durations and split
  credit (`20-30/50 wrk & party`) are calculated for you.
- **Accurate totals.** Each day keeps plain `PRJ = 60` … `SUM = 60` totals,
  and summary notes collect per-day minutes and markers across a period.
  Planner never silently rewrites figures it cannot verify.
- **Compact reviews.** The Report view shows totals, shares, ranges, streaks
  and the days that need attention.
- **Keyboard first.** Single-key row actions, undo/redo and a built-in
  keyboard reference (`?`).
- **Safe by design.** Every change previews or can be undone, a concurrent
  edit blocks the write, and interrupted operations can be recovered.

## Getting started

1. Install and enable **THEJAZ Planner** in Settings → Community plugins.
2. Run **THEJAZ Planner: Open planner** from the command palette, or click the
   sun icon in the ribbon.
3. Pick a day and start typing activities. Planner creates or updates the
   daily note `YYYY-MM-DD.md`, which starts with `## plan for 5 oct 26`.
4. Optionally create `thejaz-summary-now.md` for period totals and
   `thejaz-criteria.md` for marker rules. See [Note syntax](#note-syntax).

A minimal daily note looks like this. Each time is when that activity ended,
and the number in parentheses is its minutes:

```markdown
## plan for 5 oct 26

### morning
- [x] 08:00 (n/a) : awake
- [x] 09:30 (90) : prj
- [ ] 10:00 (30) : std

---

PRJ = 90
SUM = 90
```

Other notes are not automatically converted. If a dated note already exists
without a plan, creating that day asks before adding a plan above its existing text.

## Privacy and data

- Planner makes no automatic network requests and collects no telemetry.
- It reads candidate daily notes, summary notes, the shared criteria note and
  routine templates in your vault to recognize planner content. It changes
  planner notes through the actions and automatic totals described below.
- Settings and local working data live in its plugin folder, normally
  `.obsidian/plugins/thejaz-planner/` (under your configured vault config folder).
  `index.json` caches the **full text** of indexed planner days and summaries.
  Recovery snapshots can contain **full daily-note text**, other small-note
  text, changed text and settings checkpoints for undo and crash recovery.
- Finished recovery history is pruned when saved: at most 30 days, 100 resolved
  operations and about one million stored characters. Pending/interrupted
  operations and unfinished summary updates remain until resolved, even beyond
  those limits. Two alternating recovery snapshots protect against failed saves;
  an older copy can remain until replaced. These limits are not secure deletion.
- Cache and recovery files are readable local data, not encrypted by Planner.
  Treat them like your notes: exclude them from public repositories and support
  uploads. Planner does not transmit them; your sync or backup tools may include
  them according to your configuration.
- No plugin-specific metadata is added to your notes.

Desktop only. Windows is the tested platform.

## Working with plans

Select unchecked plans to use **shift N selected**, or any activities, including
completed ones, to use **correct N selected** beside **edit**. Shift offsets end times; its Durations setting controls how
minutes are treated. Correct is optional and previews every changed row before
applying. Its default rebuilds end times from written durations, starting after
the preceding unselected activity: an 18m row following 07:35 ends at 07:53.
Separate selected blocks each use their own preceding anchor.

Correct also offers matching durations to existing end times or keeping credit
and recording elapsed time. Split allocations are preserved, using an elapsed
suffix rather than guessing new allocations. An already-consistent `10/18` stays
as written. A selected completed row stays checked; its corrected minutes update
the totals like any edit. Unselected rows, missing anchors and unknown durations
are never silently repaired. Correct is disabled when there is nothing it can safely
change. A concurrent note edit blocks the preview; Cancel writes nothing, and
Undo/Redo retain exact recovery.

Summaries are discovered by `thejaz-summary` in the Markdown filename,
case-insensitively, anywhere in the vault. Use `thejaz-summary-now.md` for the
current summary and, optionally, names such as
`2025-01-01--2025-12-31-thejaz-summary.md` for history. The `Days (...)` line
defines the period; optional ISO filename dates are a fallback when it is absent.
Archive folder names and heading markers are not discovery rules.

Settings > Daily setup > Summary note selects the current summary used by
current-summary commands. Updates for dated daily notes go to the unique summary
period containing that date, including archived summaries. Missing or overlapping
periods block those updates and explain which date needs attention. Marker rules
come from the shared `thejaz-criteria.md`, not individual summary legends.
Native renames update the configured summary path. If the selected target is missing and
exactly one `thejaz-summary-now.md` exists, Planner adopts that path. Multiple
current candidates do not trigger an arbitrary switch; choose the target in
Settings. Merely opening or indexing historical summaries does not repair them.

Quick entry and the activity editor use the order of a source row without its
punctuation: end time, minutes, activity. `14:30 30 prj` writes
`- [ ] 14:30 (30) : prj`; the time and the minutes are optional. Quick entry can
calculate endpoints from durations. After a 09:30 activity, `wrk` adds the
default block (40m), `50 wrk` ends at 10:20, and `30/50 wrk` ends at 10:20 with
30m project credit. Multiword names and mixed allocations such as
`20-30/50 wrk & party` are supported. A number after the activity (`wrk 50`, the
earlier order) is refused with the corrected form rather than saved as part of
the name; use semicolons when a name really ends with a number.

Settings > Activity entry configures the block, start time (04:45), and
start activity (awake). Save the three defaults together. When a genuinely
empty plan needs a baseline (an entry without an end time, such as `50 prj`), preview and submission include an unchecked start
row with n/a duration. No note is seeded merely by opening or clearing it.

Settings are grouped into Daily setup, Activity entry, Reports & markers,
Projects & groups, and Maintenance & recovery. Rebuild, sync, retry, undo and
helper reset show their result, including no changes or a failure. Feedback and
project dialogs stay in the Settings window. Black Obsidian label bubbles are
suppressed on Settings sections, fields, project controls and their dialogs.
Accessible control names and keyboard navigation remain available. Smaller native
hover hints still explain actions such as Sync summaries and project removal;
visible descriptions and feedback explain saving, failures and unavailable actions.

`...` inserts an intentional gap (`- [ ] ...`). When nothing is known, `?`,
`? ? ?` and `?; ?; ?` insert the same gap. An unknown end time is written
`? (30) : prj`: enter `? 30 prj` or `?; 30; prj` (the minutes are needed, or
`? ? prj` when they are unknown too). Gaps and unknown end times break the clock
chain: supply an explicit endpoint such as `14:00 >` before adding more blocks.
A gap has no credit and does not count as an unresolved activity.
After a gap, supply a known endpoint (`14:00 >`) before duration-only input,
or write an unknown endpoint with minutes explicitly (`? 30 buffer`).
Editing an unknown-time activity keeps its `?` endpoint and recorded minutes,
including zero, when only its name changes or an activity helper is chosen.
Rounding applies when you deliberately change the minutes.
Activity helpers can replace an unfinished or invalid name while keeping the
draft time and minutes. Parenthesized context is retained and must be valid
before saving. Gaps remain unchecked with both mouse and keyboard.

With an explicit endpoint, `30/` and `30/0` both calculate elapsed time while
keeping 30m credit. They save `30` when elapsed is 30m, otherwise `30/50`, etc.
Existing literal durations are not normalized. Without an endpoint, these two
shortcuts are rejected; use a positive explicit duration instead. Single blocks
must advance by 1-1439 whole minutes. No closing row is inserted automatically.

For a historical day with only project totals known, name the note YYYY-MM-DD.md
and use ordinary Markdown:

```md
## recorded totals

PRJ = 120
WRK = 90
SUM = 210
```

Figures are minutes. SUM must equal the project totals; at least one project
line is required (explicit zero is allowed). Do not mix activity checkboxes into
this type of note. Edit its figures in the Markdown source. Valid records count
in Review and the matching summary date without requiring activity times.
Malformed, missing, duplicate or mismatched figures block summary updates.

Created by [THEJAZ](https://github.com/thejaz/). Look for the smiling sun icon in
Obsidian's ribbon and planner tab. Its internal ID is `thejaz-planner` (it was
`plain-planner` before 0.2.85); see **Moving from plain-planner** under Install.

A compact, keyboard-friendly Obsidian planner for ordinary Markdown daily notes.

Projects without a custom group automatically appear under **Unassigned** in
Review, with their combined credit. The default assignment in settings is
**Unassigned**. Changing a project's group moves its credit automatically;
no grouping data is written to Markdown.

Emoji counts include a visible legend. `highlights` and `bolds` are formatting
conventions checked against records, not separate counted categories. Review's
**day records** section starts collapsed and retains your choice across refresh.
Press **C** in Activity view, or choose **set day context**. Compact selectable
rows show context IDs, readable names and ranges parsed from the legend, plus
**🌞 ordinary day** to clear context (the sun is never written into notes).
The dialog shows the owning period summary and previews the exact result before
saving. Context is stored only in that summary, including for archived dates;
daily notes never receive independent context markers. The legend comes from
`thejaz-criteria.md` (see below). Save rechecks the row,
period and rules; a conflict keeps the dialog and choice open. Unchanged saves
and Cancel do not rewrite Markdown. C does not activate while typing; the command
palette action remains available for user-assigned global shortcuts.
With the explicit combination block shown below, **excused** at 0-29m produces ✌; higher credit uses the normal productivity
marker and carries no hidden context. The dialog explains this behavior.
With that block, at-ease and buffer are planned contexts: below 30m they show only 🕶️ or ☁️;
at 30m or above they retain the earned productivity marker too. They never receive
no-pro faces. Only 😣 receives automatic whole-row highlighting; ✌ does not.

Day-marker criteria live in one note, `thejaz-criteria.md`, at the vault root by
default and found by name wherever it is moved. Every summary and Review use it, so
periods cannot disagree. A second note with that name blocks marker writes until
they are merged; a Criteria & Markers section left inside a summary is ordinary
text and is ignored. 0.2.62 moved the summaries' identical legend there with
`tools/migrate-criteria.mjs`.

Legends use **marker | range or rule | name**. Old legends remain readable:

```markdown
### Criteria & Markers

- 😣 | 0-29m | no-pro
- ✌ | 0-29m | no-pro (context: excused)
- 😎 | 0-29m | no-pro weekends
- 🦥 | 30-149m | low-pro
- ❄️ | 150-299m | cool
- 🔥 | >=300m | hot
- 🕶️ | any | at-ease (context: at-ease)
- ☁️ | any | buffer (context: buffer)
- ==highlights== | formatting | no-pro
- **bolds** | formatting | weekends

#### combination rules

- exclusive | 😣, ✌, 😎, 🦥, ❄️, 🔥
- exclusive | ✌, 🕶️, ☁️
- replaces | ✌ | 😣, 😎
- replaces | 🕶️, ☁️ | 😣, ✌, 😎
```

Names are descriptive. Combination behavior comes from the Markdown rules:
`exclusive` allows at most one listed marker, and `replaces` makes the left-hand
markers replace the right-hand ones when applicable. The block above preserves
the familiar ordinary/excused/planned behavior. Only 😣 receives automatic
whole-row highlighting.

Planned contexts require `any`. Duplicate or incompatible
definitions, unsupported contexts, overlapping earned bands and missing coverage
block generation with a correction message. Report counts retain recorded
historical markers and show inconsistencies without silently repairing them.
Legacy legend syntax and `≥300m` remain supported. Editing a name never changes
its marker's classification rules.

The parser executes the explicit combination block rather than inferring rules
from prose or names. A missing or empty block permits every combination: saved
combinations are preserved while minute ranges still apply, and reports show no
combination warnings. Malformed rules block generation with a correction message.
See [the rule syntax and fallback details](docs/marker-rules.md).
Labels retain their authored spelling and capitalization; interface
punctuation uses ASCII while emojis remain intact. Without `thejaz-criteria.md`,
automatic summary generation retains the legacy built-in
30/150/300m thresholds, with no combination restrictions. An empty/invalid supplied legend blocks
generation. The context picker requires a valid legend and reports missing rules.
Missing definitions do not delete recorded rows or historical markers on read.

Marker legend labels preserve authored capitalization; context IDs and the
ordinary day choice are lowercase. Inline project prefixes display lowercase.
Settings labels, dialog titles and tabs retain normal capitalization;
planner action buttons are lowercase. Project chips retain uppercase codes and
note text remains intact. Duration values use rounded purple chips. Editing
buttons are rounded white with black text, subtle purple hover/pressed colors
and brief interaction transitions that respect reduced motion. Delete
confirmation starts on its delete button, so Delete then
Enter confirms; Escape cancels and Undo restores the operation.

In Settings, **Projects & groups** lets you create groups and assign each project
once. Report adds a quiet text row of group totals above project chips; groups
are stored only in plugin settings. **Reports & markers** identifies the shared
criteria note, toggles recorded marker counts and chooses weekend days.
Counts follow Report dates and actual
saved emojis/highlight/bold formatting, independently of the project filter.
Context counts can overlap. Expand **marker checks** to open discrepant source
lines and correct markers, minutes, criteria or weekend settings. No automatic
marker repairs occur. Future summary rows use configured weekends; changing
settings preserves every existing Markdown byte.

Quick entry accepts `?` for the gap `- [ ] ...` and `12:55 >` for
`- [ ] 12:55 (n/a) : >`. Both remain unchecked, even in Log mode. Unknown rows
break elapsed-time calculation until a known endpoint; a timed arrow supplies
that endpoint without inventing duration or credit. Checked unknowns mark totals
incomplete and preserve recorded daily/summary values. Explicit credit may exceed
elapsed time, such as `100/60`; it is preserved with a non-blocking warning.
Your Markdown is the complete planning record. The plugin never adds hidden
identifiers, frontmatter, special blocks, or private notation to your notes.

## Note syntax

One form per idea; the planner writes only these and reports anything else.

### Basics

Each row's time is when the activity **ended**; it started at the previous
row's end time. The parentheses hold its minutes.

| Idea | Markdown |
| --- | --- |
| Activity | `- [x] 09:30 (30) : prj` (ended 09:30, 30 minutes, activity) |
| Gap | `- [ ] ...` (untimed) or `19:00 (n/a) : ...` |
| Unknown activity | `- [ ] ?` |
| Restart anchor | `- [ ] 12:55 (n/a) : >` |
| Daily totals | `PRJ = 30` ... `SUM = 30` (plain minutes, no padding) |

- The file name `YYYY-MM-DD.md` decides the date. The heading only names it
  readably; a heading naming another date is flagged with the correct one.
- Only registered project codes earn credit; other words are ordinary
  activities.
- With **Automatic totals** on, the planner keeps `CODE =` and `SUM =` in step
  with completed activities. A total you changed yourself is never overwritten:
  it is flagged, and **Compare totals** shows both figures before anything
  changes. `## recorded totals` notes keep their written figures.

### Advanced allocations

| Idea | Markdown |
| --- | --- |
| Credit with recorded elapsed time | `- [x] 09:30 (20/30) : prj` |
| Several activities, one amount each | `- [x] 09:30 (20-10) : prj & std`, `(30-0) : prj & lunch` |
| Ordinary activities together | `- [x] 09:30 (30) : breakfast & news` |
| Several words in an activity | `- [x] 09:30 (20-10/30) : free time & prj` |
| A description of an activity | `- [x] 09:30 (20-10/40) : prj (client work) & std` |
| Summary day | `2026-05-24 = 300 ☁️🔥` |
| Summary period | `Days (2026-05-24 - 2027-05-23)` |

`&` is the only joiner between activities and `-` the only one between amounts,
mapped left to right; the planner writes ` & ` with spaces. A hyphen inside a
name is part of it: `check-in` is one activity. Only registered projects earn
credit. One amount on a group credits its first activity; new entries naming a
project ask for one amount each (`30-0`); **Split equally** divides whole minutes,
or 5-minute units when credits are rounded (10 across three projects is `5-5-0`).
Each part between `&` signs is one activity; its first word names it, so
`free time & prj` credits only PRJ and `free time with prj` credits nothing. A
name ends at a space or parenthesis, so `car's maintenance` and `prj_notes` stay
ordinary. A part without a Latin name, such as `2 chapters` or Persian text, is
an ordinary activity and keeps its place for amounts (`20-10 2 chapters & prj`).
Parentheses describe the activity before them and never add credit, including
something like `(+15 std)`, which is plain text. An empty part (`prj & & std`) or
an unclosed parenthesis is reported; it blocks only when project credit depends on
it. Activity names cannot contain `/`. Credit may exceed the elapsed
time (`70/60`). Quick entry also accepts `1h`, `1h30`, `1h 30m` and `90m`, and
lenient times such as `9:5`, and saves `90` and `09:05`. The colon before the
activity is optional when reading. Daily notes start `## plan for 5 oct 26` (day
without a leading zero, lowercase month, two-digit year); templates use
`## plan for ?? ??? 26`.

A note is a planner day when it is named `YYYY-MM-DD.md` (any folder) and holds a
`## plan for …` or `## recorded totals` heading and a `SUM = n` total. Other notes
with a date name, such as a journal or meeting notes, are ignored: never indexed,
counted or changed. If two planner days name the same date, the one in the folder
holding the most planner days counts and Review names the other. When you create a
day whose file name a non-plan note already uses, the planner asks before adding
its plan on top of that note; everything already there stays below, unchanged (or
rename that note first).
Retired forms (`030 : PRJ`, `05-24 : 300`, `Days (24.05.26 - 23.05.27)`, `→`,
`+` or `|` joiners, `/` in names, `(?) : ...`) are
blocking note checks naming the current form; `tools/migrate-syntax.mjs`
converted existing notes in 0.2.61. A hyphen that still joins projects
(`20-10 prj-std`) is flagged with the `&` form instead of losing its credit;
`tools/migrate-joiner.mjs` converted existing notes to `&` (see
`docs/activity-joiner-migration.md`).

## Install

1. Build with `npm ci`, `npm run setup:lint`, `npm run check`, and `npm run package`, or use the packaged release.
2. Extract the `thejaz-planner` folder into your vault's `.obsidian/plugins/` folder.
3. Enable **THEJAZ Planner** in Obsidian's Community plugins settings.
4. Open **THEJAZ Planner: Open planner** from the command palette.

### Moving from plain-planner

Before 0.2.85 the plugin's folder and ID were `plain-planner`. Obsidian treats a
new ID as a new plugin, so move once with Obsidian closed:
`node tools/migrate-plugin-id.mjs` (add `--dry-run` to see the plan first). It backs
up the old folder and Obsidian's settings files, copies settings, recovery records
and the index to `.obsidian/plugins/thejaz-planner`, installs the new build, renames
the plugin in the enabled-plugins list, open tabs and hotkeys, verifies every copied
file, and only then moves the old folder to the Recycle Bin. Without the tool:
rename the folder to `thejaz-planner`, replace its runtime files, and enable
**THEJAZ Planner** again; reopen the planner tab.

The first index reads your notes without changing them. It does not migrate or
repair old records automatically. Windows desktop is the supported release
target; mobile is not advertised as supported.

## Everyday use

The **Activity** view follows your morning / afternoon / evening layout; the
**Activity / Report** toggle (or `V`) switches to the review. **Log** records
completed work; **Plan** creates an unchecked activity. Choose a row to insert
after. To change an existing activity, choose **edit**; quick entry always adds new rows.

Beside Activity / Report, **🔥 6d | best 21d** shows the current hot-day run and
longest confirmed run across all history, including archives. It follows today in
the Planner time zone, independently of the date, period or project you are
viewing. Yesterday's run stays active while today is below the hot target.
Credited totals determine qualification using the 🔥 range in
`thejaz-criteria.md`; without that note the default is >=300m. Recorded totals,
including zero, take precedence; unchecked plans do not count. Missing or unknown
dates break confirmed runs. Saved emojis alone do not qualify a day. Invalid or
missing hot rules show **🔥 unavailable**; click it for the explanation.

The activity editor defaults to **Plan an activity**. Choose **Log completed work**
when you want to record finished work. Its mode and section controls
are rounded icon buttons with themed Obsidian menus, checked choices and clear
chevrons. Enter/Space or Down opens a menu; arrows and Enter choose, Escape closes.
Changing options preserves the draft and its inline destination.

| Quick entry | Result |
| --- | --- |
| `09:35 prj` | Derives the interval after the selected endpoint. |
| `now prj` | Uses the current time in your configured time zone. |
| `50 prj` | Advances 50 minutes from the selected endpoint. |
| `10:50 70/120 prj` | Credits 70 minutes out of 120 elapsed. |
| `22:25 35-35/70 prj & std` | Credits 35 minutes to each project. |
| `00:10 60-210/270 wrk & party` | Assigns 60 minutes to WRK and 210 to ordinary activity; only WRK contributes to productivity. |
| `14:30 0 prj` | Calculates minutes from the preceding activity's end time. |
| `14:30 95-95/0 prj & std` | Calculates elapsed time while keeping both 95-minute credits. |
| `14:30 .25/ prj` | Credits 25% of the elapsed minutes. |
| `.1/20 prj` | Credits 10% of an explicit 20-minute duration. |
| `14:30 .5-.5/ pr1 & pr2` | Gives each activity its own share of the elapsed minutes, in order. |
| `14:30; 30; read 2 chapters` | Semicolons separate end time, minutes and activity explicitly, so a name may contain numbers; `30; prj`, `14:30 30; prj` and `14:30; prj` work too. |

A percentage is a decimal fraction of the elapsed (or stated) minutes: one per
activity, so `.25/ prj` takes one and `.5-.5/ pr1 & pr2` takes two. It is saved as
ordinary minutes, such as `12/47` or `20-20/40`. Settings can round entered times and credited minutes
to 5 minutes (**Round entered times**, **Round credited minutes**); rounding
applies to new input only and never rewrites existing notes. Calculated shares
round together within one elapsed-time budget, so `.9-.1/` cannot gain minutes
through rounding. The rounded credit never exceeds the actual block; fractional
requests above 100% are capped too. Explicit over-credit such as `70/60` stays
as written. Real elapsed time is kept after credit when rounding changes it:
`10:47 prj` after 10:00 saves `45/47` with credited-minute rounding on. A
rounded end time sets the written block, so the row and the next one agree with
their times, while credit stays within the minutes you entered: with entered
times rounded, `10:13 prj` saves `10:15 (13/15)` and `10:47 prj` `10:45 (45)`.

An end time or duration without a name uses **activity**: `10:30`, `30`,
`10:30 30` and `10:30; 30;` all accept an omitted activity. A last `?` stays
the activity itself, so `10:47 ?` is still an unknown activity, while `n/a` is a
duration not accounted for, as at the start of a day: `10:47 n/a` saves
`10:47 (n/a) : activity`. With nothing timed before it (an empty plan or
after a gap), an end time without minutes also saves `n/a`: `14:30 prj` saves
`14:30 (n/a) : prj`. A completed project still needs minutes to earn credit.

An activity name that appears only once in your daily notes is shown in green,
so new or mistyped names stand out; it returns to normal once it is used again.
Project names keep their colours. Nothing is written to your notes.

Empty input adds
nothing; ordinary time-anchor and missing-start checks still apply.

**Activity helpers** are the name chips shown while you type: your list in
Settings (lowercase, separated by commas; by default break, free, buffer, setup,
awake, lunch, dinner, breakfast, procrastination) followed by your project codes.
In Add below and Edit, click a chip to replace the component at the caret,
keeping time, minutes, other components and parenthesized context. Chips remain
available when the activity is omitted, such as `10:30`, `30` or `10:30; 30;`.
Names that could be read as minutes use explicit fields when needed: choosing
`2 chapters` after `10:30` produces `10:30; ; 2 chapters`. The activity name and
calculated duration are preserved, including names such as `30` and `n/a`.
Chip and Tab insertions each form one draft Undo step: Ctrl+Z restores the
previous text; Ctrl+Shift+Z or Ctrl+Y restores the suggestion. Earlier typing
history stays available. Background refreshes wait while the composer has focus
so its draft history survives. Returning an edit to its original text with Undo
restores an unchanged save, including literal zero. Undo of just the minutes
also preserves their recorded value when you retain another edit, such as context. Draft Undo writes no notes; saved Planner operations
keep their separate Undo/Redo.
In multiline input, only the caret's line changes. Invalid schedule fields or
selections across fields/components disable suggestions, with the reason shown
above them; nothing is discarded. When only the end time and minutes are
selected, as when Edit opens, a chip replaces the activity name if it has one
part. Select the activity name to change it while
retaining malformed context: `chp (bad` becomes `buffer (bad`, and saving still
requires a closing parenthesis. **Tab** completes a matching activity prefix, such as `bu` to
`buffer`, including the current component after `&`. While a completion is
available at the end of the line, the rest of the name shows faintly after the
caret with a small **Tab** key. When the name would otherwise be read as minutes,
the hint adds "adds ; between fields": Tab then writes `10:20; ; n/a`. Context and numeric fields
stay intact. An already complete name, no match, or **Shift + Tab** retains
normal focus navigation. **Restore defaults** brings the default list back.
The unchanged previous defaults gain procrastination once; customized lists and
later removals stay preserved.

Paste multiple lines to preview and submit a small log at once. An initial
project activity needs an explicit duration or a preceding time anchor.
Suggestions match familiar activity labels and project codes.

Use **Edit activity** to open the purple compact-input panel for that row.
The original row is hidden while editing; **Save changes** updates it in place.
Enter saves; Escape, Cancel or the close button discard. Leaving unsaved changes
offers Save changes, Discard or Stay. Add below keeps a separate draft.
Selecting another activity collapses Add activity without losing that draft.

In the compact editor, enter `0` after the activity to calculate the interval,
or use `/0` after your credits. For a previous endpoint of 09:45 and an end time
of 14:30, `0` saves as `285`, `70/0` as `70/285`, and `95-95/0` as
`95-95/285`. Below the input, the editor explains how it reads your entry: the
end time and minutes since the previous end, credit per project, any percent or
rounding conversion, and whether the row is planned or completed. Missing or ambiguous
times produce an inline error; split projects require explicit split credits.
These shortcuts apply when entered in the planner, including multiline quick
entry. Existing zero values in Markdown remain literal, including when you edit
only another field. To record zero credit with elapsed time, use `0/0`.

Day headings and compact rows follow Obsidian's text and heading settings.
Project names are bold and colored, with always-visible pastel total chips in
both Activity and Report. The colors and interface styling add nothing to Markdown.
Chips retain their project colors when clicked or hovered. Activity and Report totals
are ordered from most to least credited time.
Codes defined in Settings or the current note's numeric project footer are
recognized automatically, including each part of a split such as `prj & std & gym`.
An undefined code in a recognized project group leaves the other codes styled.
Select that row to add the missing code as a project, or edit its label. Adding
a code refreshes recognition immediately without rewriting recorded notes;
ambiguous allocations still require explicit credits.

Use the dashed **+ Add new project** chip beside the daily totals to define a
code. Planner chooses an emoji and adds its total after the summary's last
project, before the trailing separator, Bookmarks or other text. It also adds
the code to Settings and the current day's ordinary numeric footer, so its
chip appears immediately. Existing credit is used when present; new projects
start at zero. Existing totals and repeated additions are preserved. You can
reorder project lines manually within Projects: later updates find them by code
and preserve their emoji/text. Project totals are now sorted by credited time
on summary updates. **Sort summary projects** in Review (or the command palette)
also sorts existing recorded totals without recalculating them; equal totals keep
their relative order, and surrounding separators/Bookmarks remain intact.
Settings and note changes share the recovery journal and Undo/Redo.

Projects has one searchable list with an add-code field, group selection and a
remove action. A code can be registered in Settings, a positive daily footer, or
an explicit summary project definition (including zero). Daily zero footers and
templates do not register codes globally. Registration is remembered when a
daily footer is removed. Ordinary activity words never register projects.

Adding a code in Settings adds its definition to the configured current summary.
Positive daily footers add missing project definitions only to the summary whose
period contains that date. Historical codes are not copied into other periods.
Missing or overlapping periods report a correction rather than guessing a target.
Rebuild discovers registrations without changing Markdown; **sync summaries** in
Projects adds validated missing period-specific definitions without reconciling
existing recorded figures. Existing summary formatting and emoji are preserved.

Each project has one saved emoji; different projects may share the same emoji.
Existing summary assignments are kept, and missing assignments receive a random
emoji once. Day, recorded-totals and Review chips use that same assignment.
Click the emoji beside a project in Settings to edit it, choose **random**, then
**save** or **cancel**. A blank saved field chooses a random emoji. New-project
forms also accept an optional emoji; re-adding an existing code without one
keeps its assignment. Flags, skin tones and joined emoji are supported.

Emoji changes update only summary project prefixes, preserving recorded numbers
and formatting. A manually different summary emoji stays in place until you
choose **adopt summary emoji globally** or **restore assigned emoji** in Projects
Settings. These changes share recovery and Undo/Redo with the saved assignments.
Daily activity text, Markdown footers and templates never receive emoji markup.

Use **rename or merge** beside a project in Settings, or click its chip and
choose the same action. Rename changes its code to an unused one. Merge moves
its credit into an existing project, keeping the destination emoji and group.
An existing rename destination offers **merge instead**, followed by a new
preview; it never merges automatically.

The preview lists affected daily notes, summaries and current/archived routine
templates, with exact before/after lines and project totals by record. Apply
only after reviewing it. Complete project tokens change; similar words such as
`dtflont`, descriptive `(dtfl)` and ordinary prose remain unchanged. Recorded
work, daily SUM, elapsed durations and separate sessions are preserved. A merge
combines explicit allocations and numeric rows within each record. Ambiguous
or conflicting affected records link to their source for correction first.

One Undo/Redo restores or reapplies the complete operation, including Settings,
emoji and groups. Concurrent edits invalidate a preview. Interrupted operations
remain recoverable and stop when their source or file list has changed. Opening
the dialog or installing this feature does not rename or merge existing projects.

Click a project chip, or use **THEJAZ Planner: Manage projects** (also in Settings),
to preview removal across daily notes, the configured summary and indexed
archive summaries. You can type an already-unlinked code too. **Remove attribution; keep activities**
removes its numeric project definitions and Settings registration, preserving
activity text, completion states, timestamps and duration expressions. Its credit
is subtracted from daily SUM and corresponding summary work totals. **Delete project records** also
removes project-only activity rows or the selected share of split activities,
adjusting recorded SUM and matching summary dates when allocation is known.
Other project credits and Bookmarks/prose are preserved. Aggregate-only or
conflicting summary attribution must be resolved before removal.
Ambiguous/unsupported allocations are listed for correction before applying.

The preview lists every changed note and its exact removals/replacements.
Nothing is written until **Apply changes**. Changes to records since the preview
require a fresh preview. Note changes share one recoverable operation and can
be undone/redone together, including Settings registration and project groups.
Removing a Settings code always requires this preview; daily footer deletion
does not unregister the project or remove summary project definitions.

In both project dialogs (remove, and rename or merge), apply stays unavailable
until a preview has run, and a line beside the buttons says why: preview first,
fix the listed problems and preview again, or nothing to apply because the code
is unchanged. The line disappears once apply is possible.

Use **Create day** to choose a plain Markdown routine or **📄 blank day**.
The routine selector spans the dialog width above its action buttons. Add and
Edit activity panels align with the activity rows; the Add-panel options stack
when the pane is narrow.
The existing template's enclosing code fence is removed from the new note,
checkboxes and footer totals reset, and planned durations remain intact.

To change an existing day, use **Replace plan from template** below its totals,
or **THEJAZ Planner: Replace current day plan from template** in the command
palette. Choose a template and select **Preview replacement**, then **Replace
plan**. The preview shows the resulting note and the number of activities being
replaced, including completed work. Template activities become unchecked, and
credited totals reset. Existing personal text, annotations, footnotes and fenced
examples remain in the daily note; only the template's activities, sections and
numeric project definitions are used. The template itself stays intact.

Undo restores the previous plan and its summary totals together; Redo reapplies
the replacement. If the note or template changes while you preview, Planner
stops and asks for a fresh preview. **Create day** continues to open an existing
day without replacing it. Older historical formats remain read-only in Planner.

### Keyboard

| Key, while Planner has focus | Action |
| --- | --- |
| Up / Down | Select an activity; from elsewhere in Planner, jump to the activity list |
| Shift + Up / Down | Extend or shrink the activity range |
| `A` | Add below the current activity |
| `S` | Shift the selected plans |
| `R` | Preview corrections for the selected plans; `C` remains day context |
| `D` | Duplicate the current activity as an unchecked plan |
| `K` / `J` | Move the current activity up / down one place |
| `X` | Preview deletion of the selected activities |
| Delete / Backspace, outside a text field | Delete selected activities together |
| E, Enter, F2 or double-click a value | Open the compact editor; Enter saves, Escape cancels. E, Enter, F2 and **Edit** select the end time and minutes (`08:55 20` in `08:55 20 recovery`); double-clicking the time, minutes or activity selects just that part |
| Space | Toggle completion |
| Enter in quick entry | Add the activity or all entered lines |
| Ctrl + Enter in quick entry | Start another activity line without submitting |
| Ctrl + Z, outside a text field | Undo the last planner operation |
| Ctrl + Shift + Z or Ctrl + Y, outside a text field | Redo the last undone planner operation |
| Ctrl + Shift + O | Open the selected source line in another tab |
| Escape | Cancel a dialog or leave quick entry |
| Tab / Shift + Tab | Move between controls |
| `V` | Switch between Activity and Report |
| `C` | Set day context in Activity |
| `,` | Open Planner settings |
| `?` | Help and keyboard reference |

Keys work whenever the planner has focus, including after clicking empty space or
switching views, and never while you type in a field; letter shortcuts use no
Ctrl/Cmd/Alt/Shift modifiers.
The row buttons show their single-key shortcuts in aligned, fixed-width slots
with consistent button heights and responsive wrapping. Add/Edit/Duplicate/Move use the
current activity; Shift/Correct/Delete use the selected range. Disabled actions
stay unavailable from the keyboard. Hold-to-repeat does not repeat row actions.
Menus keep their own keys; row-action letters do nothing in Report or while typing.
Inside text fields, ordinary text editing and undo remain native. Every planner
action also has a command-palette entry; no global shortcuts are assigned. **Focus
activities**, **Toggle Activity / Report** and **Open Planner settings** work from
anywhere once you give them a hotkey.

The totals, action toolbar and note/attention checks have separate divider lines.
Toolbar actions include icons and labels, with Undo/Redo first in a divided group.
Unavailable history actions are disabled. Redo restores the exact saved note
changes, including grouped source/summary edits, and stops if a note changed
after Undo. A new planner edit clears the old redo branch. History remains
recoverable across reloads within the normal retention limit.

Hover or focus a row for edit, duplicate, move, and delete controls.
Click a row and **Shift-click** another to select the inclusive
range, even across sections. **Shift + Up/Down** extends or shrinks that range
from the same starting row. Ctrl/Cmd-click can add separate activities. Press
**Delete** or **Backspace**, use **Delete N selected** in the current row's action
strip, or run **Delete selected activities** from the command palette. Confirm
the preview once to remove all selected rows together. Headings and other note
text remain; one Undo restores the deletion and its saved total/summary changes.
Delete and Backspace inside text fields continue to edit text normally. Changes
to the source activity list clear old ranges so selection cannot silently drift
onto newly inserted or shifted rows. Ordinary clicks/arrows return to one row.

Duplicates are unchecked. **Shift** (beside Add below and Edit activity) moves the
row, or the selected unchecked plans, by whole minutes. Durations can stay as
written, match the new elapsed time, or keep their credit and record the new
elapsed time (`60/75`); completed rows never move;
ordinary endpoint edits keep later endpoints fixed. **Compact footer** removes
zero project rows. **Set day context** stores the familiar icons in the summary.

## Accounting and review

- Completion is explicit. Reaching a planned time never checks it automatically.
- Credit and elapsed time are separate. Recorded credit is preserved when they differ.
- Unknown values remain unknown. Ambiguous allocations or dates stop affected updates.
- Normal manual edits update totals after a short pause.
- A deliberately edited, conflicting total stays unchanged until reconciled.
- Historical recorded totals take precedence over calculated detail.
- Older formats can be reviewed; use their original Markdown source for editing.

**Review** defaults to **This summary period**. Presets are **Past 7 days**,
**Past 30 days**, **Past 6 months**, **Past 12 months**, **This summary period**
and **All data**. All end today in the configured time zone, regardless of the
selected planning day. Seven days means today plus the preceding six days;
30 days means today plus the preceding 29. Month windows begin the day after
the corresponding date six/twelve months earlier, clamping to month end when
needed. Summary period begins at the configured summary's start, and All data
begins at the earliest indexed daily or summary record. Both endpoints count.
Editing the date fields still allows a custom range.

Report includes project filters and source links. Its mean uses known days, labels that
denominator, and excludes unknown days instead of treating them as zero.
Unallocated historical work remains visible.

Muted percentages in parentheses show each group/project's share of the selected work total.
Report project chips are numbered from most to least time spent in the selected
range and filter. Equal totals retain their existing order. The chips use aligned
columns, read down each column before continuing into the next, and adapt to the
available pane width; a single-project filter starts at 1. Recorded day markers
use the same numbered column order, sorted by day count; ties keep legend order.
Day markers use at most two columns, collapsing to one in narrow panes to leave
room for longer names such as no-pro weekends.
Day-marker percentages use covered summary days instead; contexts can overlap
and are independent of the project filter. Unavailable shares show `—`.

The current summary's ordinary `Days (YYYY-MM-DD - YYYY-MM-DD)` line defines its
reporting period. Project figures and actual results are calculated within that
period. Bookmarks and projected targets remain untouched. The actual per-day
result uses calendar days from the period's start through the current date,
capped at its end, and is only rewritten when the period's day totals are known.
It names those days, so the fixed period end and the average's basis are both
visible: `**Actual Sum:** 1,856.88h (3.39h/d over 547d)`. Keep a real end date
(your planned end) on the Days line; it decides which summary owns each date.
A summary still written as `(3.39h/d)` gains the day count with its next update
and is not reported as differing from your notes.

Default weekend: Friday. Numerical productivity markers follow the summary's
criteria. Low weekday totals use no-pro unless an excused or planned context applies. Context markers,
emphasis, and annotations remain human-editable.

## Recovery and maintenance

**Undo last change** checks every affected note for later changes before
restoring it. New notes are moved to Obsidian's trash when safely undoing their
creation. Recovery records also cover interrupted undo.

If a day saves but its summary fails, the day stays saved. Use **Retry summary
update** for a pending calculation or **Finish interrupted edits** after an
interrupted write. If a note changed since, finishing stops and names it instead
of overwriting your work. Existing summary disagreements use **Review summary**,
which shows only the daily rows, project totals and results that would change:
lines marked `-` are in the summary now, lines marked `+` would replace them.
Days that need fixing first are listed separately and left unchanged.

The attention list names each summary with saved edits waiting for it and how
many. Try **Retry summary update** first. If a summary's project totals differ
from your daily notes, the update pauses so a figure typed by hand is not
overwritten. The entry then says it is paused and shows each differing project
with both figures (`ORG: 6,325m in the summary, 6,410m in your daily notes`).
Retry cannot finish those edits while the totals differ. Choose **Review
summary** beside that entry. It opens the period the edits belong to, including
an older summary, and lists the differing project totals first. **Update
summary** takes the totals from your daily notes. It writes only what you
reviewed: if the summary or a daily note changed while the preview was open,
even a moment before confirming,
nothing is written and you review again. If a summary figure is the right one,
correct the daily notes instead.

If a footer total differs from completed activities, expand **things need
attention** and choose **Compare totals** beside its date. Compare the note's
total with the calculated one before accepting a replacement, or use **Open
note** to correct the activities instead. Only actions that can help now are
shown, next to the problem they fix; hover over a button for an explanation.

The Review summary dialog also lists days to fix as clickable dates. Use
**Review totals** to compare and resolve a day without leaving the dialog;
after saving, the list refreshes to the remaining days. **Open note** jumps to
the problem line. Use **Refresh** to check again after editing notes.

Quick entry shows its syntax and the previous endpoint used for calculation.
The entry field sits directly below the selected activity. Click a row to move
it, use **Add below** to move and focus it, or use a section's **Add activity**
button to append there. Choosing another section moves it to that section's
start. Draft text follows the field. After saving, it stays below the new row.
It starts collapsed as **Add an activity…**. Click to open it; the **×** control
or **Escape** collapses it without discarding the draft or cursor position.
A closed draft reads **Continue your activity…**. Successful submission returns
focus to **Add below** on the saved row. An empty collapsed invitation is hidden
when that row already offers Add below; empty sections still show an invitation.
Add below and logging/planning
commands open and focus the editor directly. Opening/closing respects reduced
motion settings, and hidden controls are skipped by keyboard navigation.
The current row's actions appear inside that row, below its activity text.
Hovering other rows does not open another toolbar. A multiple-row selection
still shows one action strip for the current row; it wraps on narrow panes.
Move up/down cuts and reinserts the selected row before the previous activity
or after the next within its section. Crossing a section heading is a separate
step: down enters the start of the next section; up enters the end of the previous
section. Empty sections are included. Selection, focus and the editor follow that activity
through repeated moves. Section headings, annotations, row text, time and credit
stay intact. Actions disable only at the beginning/end of the whole day when no
adjacent section remains. Undo restores the move.
Omitting minutes or entering `0` calculates the duration from that endpoint.
Clearing the minutes field while editing also calculates it; stored zeroes
remain literal unless you explicitly edit the duration.

For combined projects such as `now prj & wrk`, choose **Split equally** to fill
explicit per-project credits, or enter your own split, such as
`now 40-32/0 prj & wrk`. Review the preview before adding. Choosing a suggested
split does not save the entry. Whole-minute remainders go to the first projects
in the displayed order; the button shows every amount before you choose it.

Completed summary checkpoints are checked against current notes, so an old
retry baseline cannot leave a resolved warning behind. **Check again**
checks the current summary without editing notes. Resolved attention notices
disappear. Remaining notices explain whether to reconcile the summary, correct
a dated record, repair the summary path/period, or resume an interrupted write.
A completed review displays **Done**.

Settings, the disposable index and the recovery journal (`recovery-0.json`
and `recovery-1.json`, written alternately so one is always complete) live under
the plugin's configuration folder. The journal stores each change as edits:
daily and small notes keep their prior text; large notes keep only the edits and
fingerprints, rebuilt from the current note when needed. Unchanged notes an edit
depends on are recorded as fingerprints. Finished history keeps up to 100
changes for 30 days within about 1 MB, dropping the oldest first. Unresolved
recovery records remain until resolved, so necessary recovery evidence is never
silently discarded.

Disabling the plugin leaves the Markdown fully usable. Before replacing a
plugin release, disable it, replace `main.js`, `manifest.json`, and `styles.css`,
then enable it again. Preserve `data.json`, `index.json`, and `recovery-*.json`.

Developer details and verification instructions: [Maintaining Planner](docs/maintaining.md).
