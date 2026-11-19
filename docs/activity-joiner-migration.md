# Offline activity syntax migration

This is a deliberately separate Markdown preparation step. The installed plugin
still reads the previous syntax. Do not enable it on a migrated vault until the
new parser and its writers have been implemented and verified. This tool does
not change the plugin parser, runtime, version, totals or summary conventions.

The approved target uses ` & ` between activity components and `-` between
numeric allocations. `/` retains credit/elapsed meaning. Registered project
codes determine work credit. An existing single-amount group allocates to its
first component only; ordinary components do not earn project credit.
Parentheses remain literal whole-group context, including any `&` inside them.
Ordinary hyphenated words such as `self-care` remain literal names.

Extra-credit parentheses are retired rather than supported as a second allocation
mechanism. These approved conversions preserve each project's credit and elapsed:

```markdown
- [x] 18:25 (45-15/120) : frm & chp
- [x] 00:00 (230-30/260) : free & chp
```

The first previously read `45/120 : frm (+15 chp)`. The second previously read
`260 : free (+30 chp)`: the owner explicitly chose to partition its elapsed
block into 230 ordinary minutes and 30 CHP minutes. Completed/planned state,
endpoints, headings, footers, summary rows, annotations and prose stay intact.

## Procedure

1. Work sequentially; inspect Git and close the working vault. Dry-run:
   `node tools/migrate-joiner.mjs --report <private-report.json>`.
2. Review every patch in the private report. It scans non-hidden Markdown,
   including archives and routine examples. It refuses ambiguous extra credit,
   unreadable project allocations, historical slash ambiguity, invalid encoding
   and pending recovery. Ordinary ambiguous hyphenated names are listed and
   retained. The newest checksum-valid recovery snapshot is authoritative.
3. Copy the affected originals and plugin settings into a child directory of
   `.test-vault`, outside the indexed notes (a hidden child is suitable).
   Run the same tool with `--vault <copy> --isolated --codes-file <report>`.
   Apply and verify every copied patch, credit, elapsed value and exact rollback.
   `--isolated` is refused outside a child of this project's isolated vault.
   Native checks read the resulting copies through Obsidian's adapter; the old
   plugin must not index or update those copies.
4. Close the isolated app too. Apply the reviewed owner plan:
   `node tools/migrate-joiner.mjs --apply --expected-plan <private-report.json>
   --report <private-result.json>` (on one command line).
5. The tool backs up touched originals and control files outside the project,
   fingerprints every Markdown file and relevant control file, rechecks the
   reviewed inventory, disables only `thejaz-planner`, and writes atomic
   replacements. It verifies all affected and unaffected Markdown hashes and
   unchanged settings/recovery. Keep its private manifest and rollback copies.
6. Leave Planner disabled until the target parser is ready. Retain the existing
   dependencies, current build, reusable tests and recovery evidence. Recycle
   only disposable staging/output. Do not package personal reports or notes.

Rollback, with Obsidian closed:
`node tools/migrate-joiner.mjs --rollback <backup-directory>`.
It preflights every original and current hash, restores exact original bytes,
and restores the enabled-plugin list last. Concurrent edits block rollback.
An interrupted apply restores only migration-owned outputs, leaves Planner
disabled and records failures rather than overwriting concurrent work.

The offline reference check is not a production parser implementation. It
compares each changed row's registered project credits and elapsed against the
existing calculation core. Literal row replacements preserve every other byte,
including line endings and final-newline presence. Historical durations are
never recomputed from wall-clock gaps.

## Verification recorded on 26 October 2026

The owner-authorized pass scanned 6,913 Markdown files and changed 86 activity
rows in 33 notes: 84 joiner changes and two retired extra-credit expressions.
The full post-migration scan found zero further patches, zero extra-credit
expressions and zero migration issues. Ordinary ambiguous hyphenated words
were retained. Every unaffected Markdown hash and each settings/recovery hash
matched the preflight inventory; only the enabled-plugin list additionally
changed to leave the old parser disabled.

All 33 copied notes matched the planned patches and passed native Obsidian
adapter readback followed by byte-exact rollback. Sixteen reusable migration
tests cover allocation preservation, literal zero, context, case, completed
and planned rows, line endings/BOM, idempotence, refusal cases, read-only dry
runs, stale inventory, parser disabling and guarded exact rollback.
`npm run check` passed: 638 tests across 40 files, typechecking and build, with
the three previously documented advisory lint warnings and no errors.
The rebuilt runtime matched the installed runtime byte for byte. Version
0.2.103 and production parser code were unchanged; no installation or archives
were made. New-syntax interaction tests await the owner's parser implementation.
Private patch inventories, original bytes and native evidence remain outside
the project in the migration backup; they must not enter source commits.
