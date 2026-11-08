import { describe, expect, it } from 'vitest';
import { CRITERIA_NOTE, isCriteriaPath, vaultCriteria } from '../src/core/criteria';
import { CANONICAL_LEGEND } from '../src/core/marker-rules';
import { parseSummary, summaryPatches } from '../src/core/history';
import { applyPatches } from '../src/core/changes';
import { parseDay } from '../src/core/reader';
import { extractCriteria } from '../src/core/criteria-migration';

const days = '### Days\n2026-10-19 = 0\n### Projects\nCHP = 0\n### Results\nDays (2026-10-19 - 2026-10-19): 1d\n';
const day = parseDay('- [x] 10:00 (350) : chp\nCHP = 350\nSUM = 350', '2026-10-19.md');
const update = (summaryText: string, criteria?: ReturnType<typeof vaultCriteria>) =>
  applyPatches(summaryText, summaryPatches(parseSummary(summaryText, 's.md', [5], criteria), [day], '2026-10-19', new Set(['2026-10-19'])).patches);

describe('one thejaz-criteria note', () => {
  it('is found by name in any folder, ignoring case', () => {
    expect(['thejaz-criteria.md', 'a/b/THEJAZ-Criteria.md'].every(isCriteriaPath)).toBe(true);
    expect(['thejaz-criteria-old.md', 'thejaz-summary-now.md', 'criteria.md'].some(isCriteriaPath)).toBe(false);
  });
  it('gives no criteria without the note, the parsed legend with one, and a blocking issue with two', () => {
    expect(vaultCriteria(new Map())).toBeNull();
    expect(vaultCriteria(new Map([[CRITERIA_NOTE, CANONICAL_LEGEND]]))!.definitions.length).toBe(10);
    const two = vaultCriteria(new Map([[CRITERIA_NOTE, CANONICAL_LEGEND], ['old/thejaz-criteria.md', CANONICAL_LEGEND]]))!;
    expect(two.issues[0]!.message).toContain('Keep one thejaz-criteria.md');
    expect(() => update(days, two)).toThrow(/Keep one/);
  });
  it('serves every summary and ignores a legend left inside one', () => {
    const hot = vaultCriteria(new Map([[CRITERIA_NOTE, CANONICAL_LEGEND.replace('>=300m', '>=400m').replace('150-299m', '150-399m')]]));
    const stale = CANONICAL_LEGEND + '\n' + days;
    expect(update(days, hot)).toContain('2026-10-19 = 350 ❄️');
    expect(update(stale, hot)).toContain('2026-10-19 = 350 ❄️');
    // Without the note the built-in minute ranges apply, still ignoring the summary's own legend.
    expect(update(stale.replace('>=300m', '>=500m'), null)).toContain('2026-10-19 = 350 🔥');
  });
});

describe('moving a summary legend into thejaz-criteria.md', () => {
  it('lifts the section with its trailing rule, keeping every other byte and reading the same', () => {
    const text = 'intro\r\n\r\n' + CANONICAL_LEGEND.replace(/\n/g, '\r\n') + '\r\n---\r\n\r\n### Days\r\n**2026-10-16 = 20 😎**\r\n### Projects\r\nCHP = 0\r\nDays (2026-10-16 - 2026-10-16): 1d\r\n';
    const result = extractCriteria(text, 's.md')!;
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe('intro\r\n\r\n### Days\r\n**2026-10-16 = 20 😎**\r\n### Projects\r\nCHP = 0\r\nDays (2026-10-16 - 2026-10-16): 1d\r\n');
    expect(result.section).toBe(CANONICAL_LEGEND.trimEnd().replace(/\n/g, '\r\n') + '\r\n');
    expect(extractCriteria(days, 's.md')).toBeNull();
  });
});
