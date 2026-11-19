import { describe, expect, it } from 'vitest';
import { checkpointIssues } from '../src/core/checkpoint';
import { parseDay } from '../src/core/reader';
import { parseSummary } from '../src/core/history';

const day = (text = '## recorded totals\nCHP = 60\nSUM = 60\n') => parseDay(text, '2024-06-21.md', ['CHP']);
const summary = (value = 60) => parseSummary(`### Days (2024-06-21 - 2024-06-21)\n2024-06-21 = ${value} 🦥\n### Projects\nCHP = ${value}\n`, 'thejaz-summary-2024.md');
const dates = new Set(['2024-06-21']);
describe('obsolete checkpoint verification', () => {
  it('verifies historical records independently of the configured current period', () => {
    const current = parseSummary('### Days (2026-01-01 - 2026-12-31)\n### Projects\nCHP = 0\n', 'thejaz-summary-now.md');
    expect(checkpointIssues([day()], [current, summary()], dates, '2026-10-22')).toEqual([]);
    expect(checkpointIssues([day()], [current], dates, '2026-10-22').join()).toContain('no summary covers');
  });
  it('blocks overlapping periods and mismatching historical figures', () => {
    expect(checkpointIssues([day()], [summary(), { ...summary(), path: 'duplicate.md' }], dates, '2026-10-22').join()).toContain('more than one summary covers');
    expect(checkpointIssues([day()], [summary(50)], dates, '2026-10-22').join()).toContain('do not match the daily notes');
  });
  it('blocks missing, duplicate and disputed daily records', () => {
    for (const days of [[], [day(), day()], [day('## recorded totals\nCHP = 60\nSUM = 50\n')]])
      expect(checkpointIssues(days, [summary()], dates, '2026-10-22').join()).toContain('Open it, fix it');
  });
  it('does not accept agreement on the daily row alone when project totals differ', () => {
    const wrong = summary(); wrong.text = wrong.text.replace('CHP = 60', 'CHP = 50');
    expect(checkpointIssues([day()], [parseSummary(wrong.text, wrong.path)], dates, '2026-10-22').join()).toContain('do not match the daily notes');
  });
});
