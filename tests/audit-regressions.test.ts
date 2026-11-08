import { describe, it, expect } from 'vitest';
import { applyPatches, makeDay, refreshedEntryIndex } from '../src/core/changes';
import { parseSummary, summaryPatches } from '../src/core/history';
import { parseDay } from '../src/core/reader';

describe('audit regression fixes', () => {
  it('does not interpret or overwrite dates under Bookmarks or Results', () => {
    const text = '### Days\n2026-10-23 = 30\n### Projects\nCHP = 90\n### Bookmarks\n2026-10-24 = 999\n### Results\n2026-10-24 = 888\nDays (2026-10-23 - 2026-10-24)\n';
    const summary = parseSummary(text, 'thejaz-summary.md');
    expect(summary.rows.map(r => r.date)).toEqual(['2026-10-23']);
    const days = [23, 24].map(d => parseDay(`- [x] 09:00 (${d === 23 ? 30 : 60}) : chp`, `2026-10-${d}.md`));
    const result = summaryPatches(summary, days, '2026-10-24', new Set(['2026-10-24']));
    expect(result.issues).toEqual([]);
    const changed = applyPatches(text, result.patches);
    expect(changed.split('### Bookmarks')[1]).toBe(text.split('### Bookmarks')[1]);
    expect(parseSummary(changed, 'thejaz-summary.md').rows).toHaveLength(2);
  });
  it('keeps legacy unheaded rows and year rollover while ignoring fenced/outside dates', () => {
    const text = '2025-12-31 = 10\n2026-01-01 = 20\n### Bookmarks\n2026-01-02 = 900\nDays (2025-12-31 - 2026-01-02)';
    expect(parseSummary(text, '').rows.map(r => r.date)).toEqual(['2025-12-31', '2026-01-01']);
    expect(parseSummary('## Days\n```\n2026-01-01 = 900\n```\n#### January\n2026-01-01 = 30\n## Bookmarks\n2026-01-02 = 900\nDays (2026-01-01 - 2026-01-02)', '').rows).toHaveLength(1);
    expect(parseSummary('## Days\n2026-01-01 = 30\n### Bookmarks\n2026-01-02 = 900\nDays (2026-01-01 - 2026-01-02)', '').rows).toHaveLength(1);
  });
  it('blank days include all registered codes once, while templates inherit only their own footer', () => {
    const blank = makeDay('2026-10-23', '', ['CHP', 'IR2', 'KCW', 'ABC', 'ABC']);
    expect(Object.keys(parseDay(blank).recorded)).toEqual(['CHP', 'IR2', 'KCW', 'ABC']);
    const template = '## plan for template\n### morning\n- [x] 09:00 (30) : chp\nCHP = 30\nSUM = 30\n';
    const day = makeDay('2026-10-23', template, ['CHP', 'IR2', 'ABC']);
    expect(Object.keys(parseDay(day).recorded)).toEqual(['CHP']);
    expect(day).toContain('CHP = 0'); expect(day).toContain('- [ ]');
  });
  it('keeps the clicked activity after an insertion; rejects changed, ambiguous and different-day targets', () => {
    const original = parseDay('- [ ] 09:00 (30) : alpha\n- [ ] 09:30 (30) : beta', '2001-01-01.md');
    const entry = original.entries[1]!;
    const refreshed = parseDay('- [ ] 08:30 (30) : inserted\n' + original.text, original.path);
    expect(refreshedEntryIndex(original, entry, refreshed)).toBe(2);
    expect(() => refreshedEntryIndex(original, entry, parseDay(original.text.replace('beta', 'changed'), original.path))).toThrow();
    expect(() => refreshedEntryIndex(original, entry, parseDay(original.text + '\n' + entry.raw, original.path))).toThrow();
    expect(() => refreshedEntryIndex(original, entry, parseDay(original.text, '2001-01-02.md'))).toThrow();
  });
});
