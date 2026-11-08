import { describe, expect, it } from 'vitest';
import { isSummaryPath, parseSummary } from '../src/core/history';

describe('filename-based summary discovery', () => {
  it.each(['thejaz-summary-now.md', 'history/2024-01-01--2024-12-31-thejaz-summary.md', 'nested/a THEJAZ-SUMMARY copy.MD', '_Codes/thejaz-summary.md'])('recognizes %s without reading its contents', path => {
    expect(isSummaryPath(path)).toBe(true);
  });
  it.each(['zArchives ⚙/notes.md', 'thejaz-summary/notes.md', 'thejaz-summary.txt', '2024-01-01.md', '⌚.md'])('does not discover %s by folder/content/old conventions', path => {
    expect(isSummaryPath(path)).toBe(false);
  });
  it('reads optional ISO filename periods, including summaries with no Days period line', () => {
    const summary = parseSummary('### Days\n2024-12-31 = 30 🦥\n2025-01-01 = 60 🦥\n', 'elsewhere/2024-12-01--2025-01-31-thejaz-summary.md');
    expect([summary.start, summary.end]).toEqual(['2024-12-01', '2025-01-31']);
    expect(summary.rows.map(row => row.date)).toEqual(['2024-12-31', '2025-01-01']);
  });
  it('prefers the content period over optional filename dates', () => {
    const summary = parseSummary('Days (2025-01-01 - 2025-12-31): 365d\n2025-01-01 = 60', '2024-01-01--2024-12-31-thejaz-summary.md');
    expect([summary.start, summary.end]).toEqual(['2025-01-01', '2025-12-31']);
  });
  it.each(['2024-02-31--2024-12-31-thejaz-summary.md', '2025-01-01--2024-12-31-thejaz-summary.md', 'thejaz-summary-now.md'])('does not invent a period for %s', path => {
    expect(parseSummary('### Days\n2026-01-01 = 30', path).start).toBeNull();
  });
});
