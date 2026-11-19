import { describe, expect, it } from 'vitest';
import { formatShare, groupTotals, markerCounts, parseMarkerCriteria, workShareTotal } from '../src/core/review-extras';
import { parseDay } from '../src/core/reader';
import { parseSummary, review } from '../src/core/history';

describe('compact report percentages', () => {
  it.each([
    [1, 4, '25%'], [1, 3, '33.3%'], [2, 3, '66.7%'], [0, 10, '0%'], [10, 10, '100%'],
    [1, 10000, '<0.1%'], [9999, 10000, '>99.9%'], [1, 1000, '0.1%'], [999, 1000, '99.9%'],
    [0, 0, '—'], [1, 0, '—'], [1, null, '—'], [11, 10, '—'], [-1, 10, '—'], [1, -10, '—'],
    [NaN, 10, '—'], [1, Infinity, '—']
  ])('formats %s of %s as %s', (value, total, expected) => expect(formatShare(value, total)).toBe(expected));

  const days = [
    parseDay('## recorded totals\nAAA = 30\nBBB = 70\nSUM = 100', '2001-01-01.md'),
    parseDay('## recorded totals\nBBB = 100\nSUM = 100', '2001-01-02.md')
  ];
  it('uses the selected work total and retains unallocated and unknown-day distinctions', () => {
    const summary = parseSummary('### Days\n2001-01-03 = 100 🦥\n### Results\nDays (2001-01-01 - 2001-01-04): 4d', 'summary.md');
    const result = review(days, '2001-01-01', '2001-01-04', '', [summary]);
    expect(result.sum).toBe(300); expect(result.missingDays).toBe(1);
    const total = workShareTotal(result);
    expect(total).toBe(300); expect(formatShare(result.projects.AAA!, total)).toBe('10%');
    expect(formatShare(result.projects.BBB!, total)).toBe('56.7%');
    // Project shares do not falsely normalize the unallocated 100m away.
    expect(Object.values(result.projects).reduce((n, v) => n + v, 0)).toBe(200);
  });
  it('uses the filtered total and updates groups for a filtered report', () => {
    const result = review(days, '2001-01-01', '2001-01-02', 'AAA');
    const total = workShareTotal(result, 'AAA');
    expect(total).toBe(30); expect(formatShare(result.projects.AAA!, total)).toBe('100%');
    expect(groupTotals([{ name: 'A', projects: ['AAA'] }, { name: 'B', projects: ['BBB'] }], result.projects, 'AAA')).toEqual([{ name: 'A', minutes: 30 }]);
  });
  it('recomputes the denominator when the selected dates change', () => {
    expect(formatShare(30, workShareTotal(review(days, '2001-01-01', '2001-01-01')))).toBe('30%');
    expect(formatShare(30, workShareTotal(review(days, '2001-01-01', '2001-01-02')))).toBe('15%');
    expect(formatShare(0, workShareTotal(review([], '2001-01-01', '2001-01-01')))).toBe('—');
  });
  it('withholds shares for inconsistent totals or positive credits on unknown-total days', () => {
    const result = review(days, '2001-01-01', '2001-01-01');
    expect(workShareTotal({ ...result, sum: 50 })).toBeNull();
    expect(workShareTotal({ ...result, rows: [{ ...result.rows[0]!, sum: null }] })).toBeNull();
  });
  it('bases marker shares on unique covered summary dates, not the sum of overlapping labels', () => {
    const criteria = parseMarkerCriteria('### Criteria & Markers\n- 😣 | 0-29m | no-pro\n- 🦥 | 30-149m | low-pro\n- 🕶️ | any | at-ease (context: at-ease)', 'criteria.md');
    const summary = parseSummary('### Days\n2001-01-01 = 60 🦥🕶️\n2001-01-02 = 0 😣\n2001-01-03 = ?\n### Results\nDays (2001-01-01 - 2001-01-04): 4d', 'summary.md');
    const counts = markerCounts([summary], '2001-01-01', '2001-01-04', criteria, []);
    expect(counts.countedDays).toBe(3);
    expect(formatShare(counts.counts.get('🦥')!, counts.countedDays)).toBe('33.3%');
    expect(formatShare(counts.counts.get('🕶')!, counts.countedDays)).toBe('33.3%');
    const duplicate = markerCounts([summary, summary], '2001-01-01', '2001-01-04', criteria, []);
    expect(duplicate.countedDays).toBe(0); expect(formatShare(0, duplicate.countedDays)).toBe('—');
  });
});
