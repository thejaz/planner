import { describe, expect, it } from 'vitest';
import { parseSummary, rangeFor, review } from '../src/core/history';
import { parseDay } from '../src/core/reader';

describe('inclusive rolling review ranges', () => {
  it.each([
    ['7days', '2026-10-20', '2026-10-14'],
    ['30days', '2026-10-20', '2026-09-21'],
    ['7days', '2026-01-03', '2025-12-28'],
    ['30days', '2024-03-01', '2024-02-01'],
    ['6months', '2026-10-20', '2026-04-21'],
    ['12months', '2026-10-20', '2025-10-21'],
    ['6months', '2026-08-31', '2026-03-01'],
    ['6months', '2024-08-31', '2024-03-01'],
    ['12months', '2024-02-29', '2023-03-01']
  ])('%s through %s starts at %s', (preset, today, start) => {
    expect(rangeFor(preset, today)).toEqual({ start, end: today });
  });
  it.each([['7days', 7], ['30days', 30]] as const)('counts precisely %s including today and excluding the preceding/future records', (preset, count) => {
    const range = rangeFor(preset, '2026-10-20');
    const day = (date: string) => parseDay('- [x] 09:00 (10) : chp\nCHP = 10\nSUM = 10\n', `${date}.md`);
    const results = review([day(range.start), day('2026-10-20'), day('2026-09-20'), day('2026-10-21')], range.start, range.end);
    expect(results.calendarDays).toBe(count);
    expect(results.sum).toBe(20);
    expect(results.knownDays).toBe(2);
    expect(results.rows.at(-1)?.date).toBe('2026-10-20');
  });
  it('includes today for the summary period even if its recorded end is earlier', () => {
    const summary = parseSummary('### Days (2026-10-01 - 2026-10-10)\n', 'summary.md');
    expect(rangeFor('period', '2026-10-20', summary)).toEqual({ start: '2026-10-01', end: '2026-10-20' });
    expect(() => rangeFor('period', '2026-09-20', summary)).toThrow('starting on or before today');
    expect(() => rangeFor('period', '2026-10-20')).toThrow('summary note');
  });
  it('starts all data at the earliest actual daily or archived summary record, ignoring future records', () => {
    const archive = parseSummary('### Days (2020-01-01 - 2020-12-31)\n2020-02-03 = 10\n', 'archive.md');
    const days = [parseDay('', '2021-01-01.md'), parseDay('', '2027-01-01.md')];
    expect(rangeFor('all', '2026-10-20', undefined, days, [archive])).toEqual({ start: '2020-02-03', end: '2026-10-20' });
    expect(rangeFor('all', '2026-10-20', undefined, days)).toEqual({ start: '2021-01-01', end: '2026-10-20' });
    expect(rangeFor('all', '2026-10-20', undefined, [days[1]!])).toEqual({ start: '2026-10-20', end: '2026-10-20' });
  });
});
