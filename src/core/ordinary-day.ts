/**
 * The ordinary day Planner offers to new users (0.3.2). It is not a built-in plan: until a
 * routine note of that name exists, Create day and Replace plan offer it, and choosing it
 * writes the note `🌞 ordinary day.md` into the routines folder. From then on it is an
 * ordinary routine the user edits, renames or deletes; nothing is written unless chosen.
 */
export const ORDINARY_DAY_OFFER = 'offer:ordinary-day';
export const ORDINARY_DAY_NAME = '🌞 ordinary day';
export const ORDINARY_DAY = `## plan for D mon YY

### morning

- [ ] 04:45 (n/a) : awake
- [ ] 05:03 (18) : iwbs (wash & meditate)
- [ ] 05:23 (20) : breakfast
- [ ] 05:35 (12) : preps
- [ ] 06:30 (55) : hike (gwezakwer)
- [ ] 06:50 (20) : recovery
- [ ] 07:20 (30) : setup
- [ ] ...

### afternoon

- [ ] 13:25 (25) : nap
- [ ] ...
- [ ] 19:00 (10) : iwbs

### evening

- [ ] 19:15 (15) : dinner
- [ ] ...
- [ ] 22:30 (60) : iwbw (wind down)

---

SUM = 0
`;
/** The note written on first use, fenced like a hand-made routine so it reads as raw text. */
export const ORDINARY_DAY_NOTE = '```\n' + ORDINARY_DAY + '```\n';
/** A routine offered in Create day and Replace plan: a note, or the ordinary-day offer. */
export interface RoutineChoice { path: string; name: string }
