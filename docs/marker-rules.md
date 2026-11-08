# Marker definitions and combination rules

The `Criteria & Markers` section lives in `thejaz-criteria.md`, one note for the
whole vault (at its root by default). Inside it, definitions use `marker | range/rule | name`.
Labels retain their authored case and spelling. Ranges control when a marker
applies; a label such as `no-pro` does not change behavior. Supported marker
identities, context IDs and calendar-weekend selection remain the base vocabulary.

Use a child heading to define combinations explicitly:

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

`exclusive` permits at most one of its comma-separated markers. An optional third
column may contain a readable group name; it has no effect on behavior. The
short form above is preferred. Old named groups and an empty third column are
also accepted. The preferred heading is lowercase `combination rules`; heading
matching remains case-insensitive.

`replaces` removes the right-hand markers from generated candidates when any
left-hand marker applies. For saved rows, both sides present together produce a
combination warning. Thus the last two rules make excused/at-ease/buffer replace
the listed no-pro faces. Planned markers can accompany earned productivity
because no rule excludes those pairs. Replacement winners are evaluated from
the original candidate set simultaneously, independently of declaration order.

Rules reference emoji markers defined in the same selected legend. Operations
are case-insensitive; `>=`/`≥`, old definition syntax and emoji variation selectors
are accepted. The subsection must be nested within Criteria & Markers, not in
Days, Bookmarks or fenced examples. Duplicate rules, unsupported operations,
undefined references, self-replacement and replacement cycles are errors. An
exclusive rule covering overlapping earned ranges is also ambiguous and blocked.
Malformed rules never silently become permissive.

## Without combination rules

A missing or empty Combination rules subsection means **all combinations are
allowed**. There are no implicit context/productivity exclusivity rules or
replacement pairs. Reports retain saved counts without combination warnings.
Existing combinations are preserved during updates while their minute ranges
still apply. Expired numeric markers can be replaced by the current classification;
other applicable markers remain. Allowing a pair does not cause it to be added.
New rows without markers use the matching earned classification, otherwise the
ordinary/weekend no-pro classification; contexts are never inferred from low time.

Without `thejaz-criteria.md`, legacy numeric defaults (30/150/300m) still apply, with
no combination restrictions. The context picker needs definitions to offer named
choices. An invalid/empty supplied legend remains an error; permissiveness concerns
combinations, not malformed definitions or missing numeric coverage for new rows.

Every summary, context selection and report validation use the combination block
in `thejaz-criteria.md`; a legend left inside a summary is ignored.
The picker shows the parsed rules and remains a single-choice replacement action;
Cancel preserves any saved multi-context combination.

Reports never repair stored rows. Changing a rule changes subsequent validation
and deliberate generated updates, not historical Markdown on read or startup.
Formatting conventions remain separate: automatic whole-row no-pro highlighting
uses 😣, and inline annotations and weekend bold are preserved.

## Hot-day streak

The header's current/best streak uses the parsed numeric range attached to 🔥,
including a finite upper bound. Renaming its description does not change the
rule. Each recorded day qualifies from its authoritative credited total; the
streak does not count saved fire symbols or apply context-combination rewriting.
At-ease and buffer days qualify if their minutes meet the hot range. Missing or
unknown dates break confirmed runs. Historical marker counts remain counts of
saved symbols, so changing criteria can make them differ from the streak.

With no shared criteria note, the hot default is >=300m. With a supplied note,
invalid rules or a missing hot definition make the streak unavailable with an
explanation. The streak display never writes notes or recalculates totals.
