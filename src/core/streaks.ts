import { dateAdd, validDate } from './model';
import type { ReviewRow } from './history';
import type { MarkerCriteria } from './marker-rules';
import { inRange } from './marker-rules';

export type HotStreak = { available: true; symbol: string; current: number; best: number }
  | { available: false; reason: string };

/** Read-only classification of authoritative credited totals, independent of saved emoji. */
export function hotStreak(rows: Iterable<Pick<ReviewRow, 'date' | 'sum'>>, today: string, criteria: MarkerCriteria | null): HotStreak {
  if (!validDate(today)) return { available: false, reason: 'Check the Planner time zone: today is not a valid date.' };
  if (criteria?.issues.length) return { available: false, reason: `Fix the criteria note: ${criteria.issues.map(issue => issue.message).join(' ')}` };
  const hot = criteria?.definitions.find(definition => definition.key === '🔥');
  if (criteria && (!hot || hot.role !== 'earned' || hot.min === undefined || hot.max === undefined))
    return { available: false, reason: 'Define one hot range in thejaz-criteria.md, for example: - 🔥 | >=300m | hot' };
  const symbol = hot?.symbol ?? '🔥';
  // Duplicate unresolved dates cannot extend a confirmed streak, even if totals agree.
  const values = new Map<string, number | null>();
  for (const row of rows) if (validDate(row.date) && row.date <= today)
    values.set(row.date, values.has(row.date) ? null : row.sum);
  let previous = '', run = 0, best = 0, current = 0;
  const yesterday = dateAdd(today, -1);
  for (const [date, value] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
    const qualifies = value !== null && Number.isFinite(value) && (hot ? inRange(hot, value) : value >= 300);
    run = qualifies ? (previous && dateAdd(previous, 1) === date ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    if (date === yesterday) current = run;
    // An unfinished/non-hot today leaves yesterday's confirmed run active.
    if (date === today && qualifies) current = run;
    previous = date;
  }
  return { available: true, symbol, current, best };
}
