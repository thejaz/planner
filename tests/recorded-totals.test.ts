import { describe, expect, it } from 'vitest';
import { calculate, disputed, effectiveTotals, parseDay } from '../src/core/reader';
import { applyPatches, footerPatches } from '../src/core/changes';
import { parseSummary, review, summaryPatches } from '../src/core/history';
import { replacePlan } from '../src/core/plan-template';

const path = 'archive/2012-01-05.md';
const text = '## recorded totals\r\n\r\nCHP = 120\r\nFRM = 90\r\nSUM = 210\r\n\r\nOnly these totals are known.\r\n';
const summaryText = '### Days\n2012-01-05 = 0 😣\n### Projects\nCHP = 0\nFRM = 0\n### Results\nDays (2012-01-05 - 2012-01-05): 1d\n';
describe('explicit recorded totals days', () => {
  it('counts recorded project minutes without activity conflicts or source normalization', () => {
    const day = parseDay(text, path);
    expect(day.recordedOnly).toBe(true); expect(day.entries).toEqual([]);
    expect(day.diagnostics).toEqual([]); expect(disputed(day)).toBe(false);
    expect(effectiveTotals(day)).toEqual({ projects: { CHP: 120, FRM: 90 }, sum: 210, unallocated: 0, complete: true });
    expect(calculate(day).sum).toBe(0); // No invented activity log.
    expect(footerPatches(day)).toEqual([]); expect(footerPatches(day, true)).toEqual([]);
    expect(day.text).toBe(text);
  });
  it('uses totals in Review, project filters and corresponding summary rows/project totals', () => {
    const day = parseDay(text, path), result = review([day], '2012-01-05', '2012-01-05');
    expect(result).toMatchObject({ sum: 210, knownDays: 1, complete: true, projects: { CHP: 120, FRM: 90 } });
    expect(result.rows[0]).toMatchObject({ source: 'recorded totals', disputed: false });
    expect(review([day], '2012-01-05', '2012-01-05', 'FRM').sum).toBe(90);
    const change = summaryPatches(parseSummary(summaryText, 'summary.md'), [day], '2012-01-05', new Set(['2012-01-05']));
    expect(change.issues).toEqual([]);
    const after = applyPatches(summaryText, change.patches);
    expect(after).toContain('2012-01-05 = 210 ❄️'); expect(after).toContain('CHP = 120'); expect(after).toContain('FRM = 90');
  });
  it.each([
    ['## recorded totals\nCHP = 120\nSUM = 119', 'recorded-sum-conflict'],
    ['## recorded totals\nCHP = 120', 'missing-recorded-sum'],
    ['## recorded totals\nSUM = 10', 'missing-project-totals'],
    ['## recorded totals\nCHP = 120\nCHP = 120\nSUM = 120', 'duplicate-total'],
    ['## recorded totals\nCHP = 120\nSUM = 120\nSUM = 120', 'duplicate-total'],
    ['## recorded totals\n? : CHP\nSUM = 120', 'invalid-total'],
    ['## recorded totals\n? : ABC\nSUM = 120', 'invalid-total'],
    ['## recorded totals\n-5 : CHP\nSUM = 120', 'invalid-total'],
    ['## recorded totals\nCHP = 120\n? : SUM', 'invalid-total'],
    ['## recorded totals\nCHP = 9007199254740992\nSUM = 0', 'invalid-total'],
    ['## recorded totals\nCHP = 9007199254740991\nFRM = 1\nSUM = 0', 'recorded-sum-conflict'],
    [text + '\n## recorded totals', 'duplicate-recorded-heading'],
    [text + '\n- [ ] ?', 'mixed-recorded-day'],
    [text + '\n- [x] 12:00 (120) : chp', 'mixed-recorded-day']
  ])('preserves invalid source and blocks reconciliation for %s', (source, diagnostic) => {
    const day = parseDay(source, path);
    expect(day.diagnostics.some(d => d.code === diagnostic && d.blocks)).toBe(true);
    expect(effectiveTotals(day).complete).toBe(false); expect(disputed(day)).toBe(true);
    expect(() => footerPatches(day)).toThrow(); expect(day.text).toBe(source);
    const summary = summaryPatches(parseSummary(summaryText, 'summary.md'), [day], '2012-01-05', new Set(['2012-01-05']));
    expect(summary.issues.length).toBeGreaterThan(0); expect(summary.patches).toEqual([]);
  });
  it('allows an explicitly recorded zero and custom footer-defined projects', () => {
    const zero = parseDay('## recorded totals\nSUM = 0', path);
    expect(zero.diagnostics).toEqual([]);
    expect(effectiveTotals(zero)).toEqual({ projects: {}, sum: 0, unallocated: 0, complete: true });
    expect(review([zero], '2012-01-05', '2012-01-05')).toMatchObject({ complete: true, sum: 0, knownDays: 1 });
    expect(effectiveTotals(parseDay('## recorded totals\nABC = 0\nSUM = 0'))).toMatchObject({ sum: 0, projects: { ABC: 0 }, complete: true });
  });
  it.each(['# recorded totals', '### recorded totals', '## recorded totals extra', '```md\n## recorded totals\n```', '~~~\n## recorded totals\n~~~'])('does not activate the convention from %s', heading => {
    expect(parseDay(`${heading}\nCHP = 120\nSUM = 120`).recordedOnly).toBe(false);
  });
  it('accepts heading case/spacing and never counts fenced task examples', () => {
    const day = parseDay(text.replace('## recorded totals', '## Recorded Totals ##') + '\n```\n- [x] 12:00 (120) : chp\n```');
    expect(day.recordedOnly).toBe(true); expect(day.diagnostics).toEqual([]);
  });
  it('keeps ordinary daily mismatch checks and counts one plan when two notes name the date', () => {
    const ordinary = parseDay(text.replace('## recorded totals', '## plan'), path);
    expect(disputed(ordinary)).toBe(true);
    const day = parseDay(text, path);
    // The note among most planner days counts once; the other is named, not added.
    const neighbour = parseDay(text.replace(/\d+/g, '0'), 'archive/2012-01-04.md');
    const duplicate = review([day, parseDay(text, 'other/2012-01-05.md'), neighbour], '2012-01-05', '2012-01-05');
    expect(duplicate.rows[0]).toMatchObject({ source: 'recorded totals', sum: 210, paths: [path] });
    expect(duplicate.rows[0]!.issues).toContain('Also a plan for this date, not counted: other/2012-01-05.md.');
  });
  it('refuses to turn a recorded day into a plan via template replacement', () => {
    expect(() => replacePlan(parseDay(text, path), '### morning\n- [ ] 12:00 (60) : chp')).toThrow(/recorded totals/i);
  });
});
