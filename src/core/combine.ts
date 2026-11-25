import { activityGroup, DEFAULT_CODES } from './model';
import type { Change, Day, Entry } from './model';
import { applyPatches, changeOf, Conflict, linePatch } from './changes';
import { calculate, parseDay } from './reader';

/** A combined row and what it replaces, for a preview before anything is written. */
export interface Combination { change: Change; row: string; replaced: string[] }

const ROW = /^(\s*-\s+\[[ xX]\]\s+)(\d{1,2}:\d{1,2})\s*\(\s*([^()]*?)\s*\)\s*:?\s*(.*)$/;

/**
 * Combine consecutive selected activities into one row (0.2.135): `nve`, `org`, `nve`
 * becomes `(11-3) : nve & org`, ending at the last selected row's end time. Amounts add up
 * per activity in first-appearance order; recorded elapsed time is kept as a `/` suffix when
 * it differs from the credit. Project totals and SUM stay exactly as they were.
 */
export function combineEntries(day: Day, entries: Entry[], codes: string[] = DEFAULT_CODES): Combination {
  if (day.legacy) throw new Conflict('Historical formatting is read-only in the planner. Open the source to edit it.');
  const selected = [...new Set(entries)].sort((a, b) => a.line - b.line);
  if (selected.length < 2) throw new Error('Select two or more activities in a row to combine them.');
  if (selected.some(entry => !day.entries.includes(entry))) throw new Conflict('The selected activities no longer match this note. Select them again.');
  const first = day.entries.indexOf(selected[0]!);
  if (selected.some((entry, n) => day.entries[first + n] !== entry)) throw new Error('Combine needs activities next to each other. Select a continuous range.');
  if (selected.some(entry => entry.section !== selected[0]!.section)) throw new Error('Combine activities within one section.');
  if (new Set(selected.map(entry => entry.checked)).size > 1) throw new Error('Combine needs all selected activities completed, or all planned.');
  const amounts = new Map<string, { text: string; descriptions: Set<string>; minutes: number }>();
  let elapsed = 0;
  for (const entry of selected) {
    const row = ROW.exec(entry.raw), duration = entry.duration.replace(/\s+/g, '');
    if (!row || entry.time === null) throw new Error(`Line ${entry.line + 1}: combine needs a known end time on every activity.`);
    const match = /^(\d+(?:-\d+)*)(?:\/(\d+))?$/.exec(duration);
    if (!match || entry.elapsed === null) throw new Error(`Line ${entry.line + 1}: combine needs written minutes; n/a, ?, and gaps stay separate.`);
    const units = activityGroup(entry.label).units;
    // One amount on a group credits its first activity (`(30) : breakfast & news`), as in notes.
    const written = match[1]!.split('-').map(Number);
    const credits = written.length === 1 && units.length > 1 ? [written[0]!, ...units.slice(1).map(() => 0)] : written;
    if (!units.length || units.length !== credits.length)
      throw new Error(`Line ${entry.line + 1}: give one amount per activity (such as 20-10 for two) before combining.`);
    if (activityGroup(entry.label).issues.length) throw new Error(`Line ${entry.line + 1}: fix this activity's name first.`);
    units.forEach((unit, n) => {
      const text = entry.label.slice(unit.start, unit.end).trim(), key = (unit.name || text).toLowerCase();
      if (!text) throw new Error(`Line ${entry.line + 1}: an activity part is empty.`);
      // One part per name; each distinct description is kept: `std (chapter 3) (chapter 4)`.
      const description = unit.name ? text.slice(unit.name.length).trim() : '';
      const known = amounts.get(key);
      if (!known) amounts.set(key, { text, descriptions: new Set([description]), minutes: credits[n]! });
      else {
        known.minutes += credits[n]!;
        if (description && !known.descriptions.has(description)) {
          known.text += ` ${description}`;
          known.descriptions.add(description);
        }
      }
    });
    elapsed += entry.elapsed;
  }
  const last = selected.at(-1)!, row = ROW.exec(last.raw)!;
  const parts = [...amounts.values()], credit = parts.reduce((sum, part) => sum + part.minutes, 0);
  const minutes = parts.map(part => part.minutes).join('-') + (elapsed === credit ? '' : `/${elapsed}`);
  const combined = `${row[1]}${row[2]} (${minutes}) : ${parts.map(part => part.text).join(' & ')}`;
  const patches = [...selected.slice(0, -1).map(entry => linePatch(day, entry.line, '', true)), linePatch(day, last.line, combined)];
  // The combined row must credit exactly what the separate rows did.
  const before = calculate(day), after = calculate(parseDay(applyPatches(day.text, patches), day.path, codes));
  const same = before.sum === after.sum && JSON.stringify(Object.entries(before.projects).filter(([, v]) => v).sort())
    === JSON.stringify(Object.entries(after.projects).filter(([, v]) => v).sort());
  if (!same) throw new Error('Combining these rows would change the credited totals, so nothing was combined. Edit the rows first.');
  return { change: { ...changeOf(day, patches, `Combine ${selected.length} activities`), strictSource: true }, row: combined.trim(), replaced: selected.map(entry => entry.raw.trim()) };
}
