import type { ReviewRow } from './history';

/** A best single-day figure: its minutes, the date that set it and the best before it. */
export interface DayRecord { code: string; minutes: number; date: string; previous: { minutes: number; date: string } | null }
/** `SUM` is the best credited day overall; every other key is a project code. */
export const TOTAL_RECORD = 'SUM';

/**
 * Personal bests derived from recorded days, oldest first: the highest single-day credit
 * per project and overall. Read-only; nothing is written to notes. Equal later days do not
 * replace the first date that reached a figure, and zero days never set a record.
 */
export function dayRecords(rows: Iterable<ReviewRow>, codes?: Iterable<string>): Map<string, DayRecord> {
  const allowed = codes ? new Set([...codes].map(code => code.toUpperCase())) : null;
  const records = new Map<string, DayRecord>();
  const consider = (code: string, minutes: number, date: string) => {
    if (!(minutes > 0)) return;
    const best = records.get(code);
    if (!best) records.set(code, { code, minutes, date, previous: null });
    else if (minutes > best.minutes) records.set(code, { code, minutes, date, previous: { minutes: best.minutes, date: best.date } });
  };
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (row.source === 'missing' || row.source === 'duplicate') continue;
    if (row.sum !== null) consider(TOTAL_RECORD, row.sum, row.date);
    for (const [code, minutes] of Object.entries(row.projects))
      if (!allowed || allowed.has(code.toUpperCase())) consider(code.toUpperCase(), minutes, row.date);
  }
  return records;
}

/**
 * Codes whose current record was set on `date`, for marking that day's totals. With
 * `beaten`, only records that improved on an earlier best: a project's first day is not news.
 */
export function recordsSetOn(records: ReadonlyMap<string, DayRecord>, date: string, beaten = false): Set<string> {
  return new Set([...records.values()].filter(record => record.date === date && (!beaten || record.previous)).map(record => record.code));
}

/** The annotation a summary row carries when its day beat every earlier day's total. */
const NEW_RECORD = '==new record==';
const RECORD_NOTE = / ?==new record==/g;
/** Adds or removes the new-record annotation at the end of a summary row; nothing else changes. */
export function markRecord(raw: string, record: boolean): string {
  const has = raw.includes(NEW_RECORD);
  if (record === has) return raw;
  if (!record) return raw.replace(RECORD_NOTE, '');
  const content = raw.trimEnd();
  return `${content} ${NEW_RECORD}${raw.slice(content.length)}`;
}
/**
 * For each date, the best total of the earlier dates (or null when none was positive):
 * a day is a new record when its total is above that figure.
 */
export function earlierBests(rows: Iterable<ReviewRow>): Map<string, number | null> {
  const bests = new Map<string, number | null>();
  let best: number | null = null;
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    bests.set(row.date, best);
    if (row.sum !== null && row.sum > 0 && row.source !== 'duplicate' && (best === null || row.sum > best)) best = row.sum;
  }
  return bests;
}
