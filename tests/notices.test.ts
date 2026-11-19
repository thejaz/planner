import { describe, expect, it } from 'vitest';
import { TransientNotices, groupDays } from '../src/core/notices';
import { reusableEntry } from '../src/core/index-cache';

describe('transient notices', () => {
  it('clears reported errors without touching other issues', () => {
    const issues = new Map([['summary', 'Summary differs.']]), notices = new TransientNotices(issues);
    notices.report('operation', 'The source changed. Refresh before trying again.');
    notices.report('startup', 'Startup failed.');
    notices.clear(['operation']);
    expect([...issues.keys()]).toEqual(['summary', 'startup']);
    notices.clear();
    expect([...issues.keys()]).toEqual(['summary']);
  });
  it('keeps a notice that a later status check replaced', () => {
    const issues = new Map<string, string>(), notices = new TransientNotices(issues);
    notices.report('day.md', 'Write failed.');
    issues.set('day.md', 'The footer totals differ from the completed activities.');
    notices.clear();
    expect(issues.get('day.md')).toBe('The footer totals differ from the completed activities.');
    notices.clear();
    expect(issues.has('day.md')).toBe(true);
  });
});
describe('index cache reuse', () => {
  it('reuses an entry only for the same revision and parsed text', () => {
    const known = { mtime: 10, size: 4, text: 'text' };
    expect(reusableEntry(known, 10, 4, 'text')).toBe(true);
    expect(reusableEntry(known, 11, 4, 'text')).toBe(false);
    expect(reusableEntry(known, 10, 5, 'text')).toBe(false);
    expect(reusableEntry(known, 10, 4, 'edit')).toBe(false);
    expect(reusableEntry(undefined, 10, 4, 'text')).toBe(false);
  });
});

describe('grouped day messages', () => {
  const problem = "this day's note has a problem.";
  it('shortens one problem across many days to the first dates and a count', () => {
    const issues = ['2004-02-05', '2004-02-02', '2004-02-04', '2004-02-03', '2004-02-06'].map(d => `${d}: ${problem}`);
    expect(groupDays(issues, 'Choose Review summary to see them all.')).toEqual([
      `2004-02-02, 2004-02-03, 2004-02-04 and 2 more days: ${problem} Choose Review summary to see them all.`]);
  });
  it('keeps a few days, other problems and undated messages as they are, in order', () => {
    const issues = ['Summary period changed.', `2004-02-02: ${problem}`, '2004-02-03: duplicate summary rows.', `2004-02-04: ${problem}`, 'Totals were left unchanged.'];
    expect(groupDays(issues)).toEqual(issues.slice(0, 2).concat(`2004-02-04: ${problem}`, '2004-02-03: duplicate summary rows.', 'Totals were left unchanged.'));
  });
  it('lists a repeated date once', () => {
    expect(groupDays([`2004-02-02: ${problem}`, `2004-02-02: ${problem}`])).toEqual([`2004-02-02: ${problem}`]);
  });
});
