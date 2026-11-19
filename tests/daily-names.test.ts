import { afterEach, describe, expect, it } from 'vitest';
import { DATE_ONLY, dailyAffixProblem, dailyNameAffixes, dailyNotePath, dateFromPath, normalizeDailyName, setDailyNameAffixes } from '../src/core/model';
import { isSummaryPath } from '../src/core/history';

describe('daily note prefix and suffix', () => {
  afterEach(() => setDailyNameAffixes('', ''));
  it('names plain YYYY-MM-DD notes by default', () => {
    expect([dailyNotePath('2026-11-19'), dateFromPath('a/2026-11-19.md'), dateFromPath('plan 2026-11-19.md')]).toEqual(['2026-11-19.md', '2026-11-19', null]);
  });
  it('creates affixed names and still recognizes plain ones', () => {
    setDailyNameAffixes('plan ', ' (day)');
    expect(dailyNotePath('2026-11-19')).toBe('plan 2026-11-19 (day).md');
    for (const path of ['plan 2026-11-19 (day).md', 'folder/plan 2026-11-19 (day).md', '2026-11-19.md', 'x/2026-11-19.md'])
      expect(dateFromPath(path), path).toBe('2026-11-19');
    // Only the exact affixes count; other text around a date is someone else's note.
    for (const path of ['plan 2026-11-19.md', '2026-11-19 (day).md', 'Plan 2026-11-19 (day).md', 'xplan 2026-11-19 (day).md', 'plan 2026-02-30 (day).md', 'plan 2026-11-19 (day).MD'])
      expect(dateFromPath(path), path).toBeNull();
  });
  it('treats regex characters in affixes literally', () => {
    setDailyNameAffixes('a.b+', '');
    expect([dateFromPath('a.b+2026-01-01.md'), dateFromPath('axb+2026-01-01.md'), dateFromPath('aab2026-01-01.md')]).toEqual(['2026-01-01', null, null]);
  });
  it('refuses affixes that would break names or blur the date, keeping plain names', () => {
    for (const [prefix, suffix] of [['a/', ''], ['', ':x'], ['p1', ''], ['', '-thejaz-summary'], [' plan', ''], ['', 'x '], ['', 'x.'], ['#', '']] as const)
      expect(dailyAffixProblem(prefix, suffix), `${prefix}|${suffix}`).not.toBe('');
    expect(dailyAffixProblem('plan-', '_log')).toBe('');
    setDailyNameAffixes('p1', '');
    expect([dailyNotePath('2026-01-01'), dateFromPath('p12026-01-01.md')]).toEqual(['2026-01-01.md', null]);
  });
  it('never reads a dated summary as a day', () => {
    setDailyNameAffixes('', '--x');
    expect(isSummaryPath('2025-01-01--2025-12-31-thejaz-summary.md')).toBe(true);
    expect(dateFromPath('2025-01-01--2025-12-31-thejaz-summary.md')).toBeNull();
  });
});

describe('one daily name choice (0.2.139)', () => {
  it('reads a saved choice, or the older separate prefix and suffix, as one valid choice', () => {
    expect(normalizeDailyName({ kind: 'prefix', text: 'plan ' })).toEqual({ kind: 'prefix', text: 'plan ' });
    expect(normalizeDailyName({ kind: 'suffix', text: ' log' })).toEqual({ kind: 'suffix', text: ' log' });
    expect(normalizeDailyName(undefined, 'plan ', '')).toEqual({ kind: 'prefix', text: 'plan ' });
    expect(normalizeDailyName(undefined, 'plan ', ' log')).toEqual({ kind: 'prefix', text: 'plan ' });
    expect(normalizeDailyName(undefined, '', ' log')).toEqual({ kind: 'suffix', text: ' log' });
    for (const bad of [undefined, null, 'plan', { kind: 'prefix', text: '' }, { kind: 'prefix', text: 'p1' }, { kind: 'other', text: 'x' }])
      expect(normalizeDailyName(bad), JSON.stringify(bad)).toEqual(DATE_ONLY);
    expect(normalizeDailyName({ kind: 'date', text: '' }, 'plan ')).toEqual(DATE_ONLY);
  });
  it('gives the prefix or the suffix, never both', () => {
    expect(dailyNameAffixes({ kind: 'prefix', text: 'plan ' })).toEqual({ prefix: 'plan ', suffix: '' });
    expect(dailyNameAffixes({ kind: 'suffix', text: ' log' })).toEqual({ prefix: '', suffix: ' log' });
    expect(dailyNameAffixes(DATE_ONLY)).toEqual({ prefix: '', suffix: '' });
  });
});

describe('earlier daily names and hidden files (review fix)', () => {
  it('keeps recognizing days made under earlier prefixes or suffixes; new days use the current one', () => {
    setDailyNameAffixes('', ' log', [{ prefix: 'plan ', suffix: '' }]);
    expect(dailyNotePath('2026-11-19')).toBe('2026-11-19 log.md');
    for (const path of ['plan 2026-11-19.md', '2026-11-19 log.md', '2026-11-19.md']) expect(dateFromPath(path), path).toBe('2026-11-19');
    expect(dateFromPath('note 2026-11-19.md')).toBeNull();
  });
  it('refuses a prefix starting with a period, which Obsidian would hide', () => {
    expect(dailyAffixProblem('.plan ', '')).toMatch(/period/);
    expect(normalizeDailyName({ kind: 'prefix', text: '.plan ' })).toEqual(DATE_ONLY);
  });
});
