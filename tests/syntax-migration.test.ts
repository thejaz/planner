import { describe, expect, it } from 'vitest';
import { migrateDaily, migrateSummary, migrateSyntax } from '../src/core/syntax-migration';
import { parseDay } from '../src/core/pre-ampersand/reader';
import { parseSummary } from '../src/core/history';

const codes = ['CHP', 'FRM', 'STD'];
const retired = (text: string) => parseDay(text, 'x.md', codes).diagnostics.filter(d => d.code === 'retired-syntax').map(d => d.message);

describe('0.2.61 syntax migration', () => {
  it('rewrites footers as LABEL = number without padding', () => {
    const before = '- [x] 09:30 (30) : chp\n\n---\n\n030 : CHP\n**000 : FRM**\n030 : SUM\n';
    const result = migrateDaily(before, '2026-10-01.md', codes);
    expect(result.text).toBe('- [x] 09:30 (30) : chp\n\n---\n\nCHP = 30\n**FRM = 0**\nSUM = 30\n');
    expect(result.issues).toEqual([]);
    expect(retired(before)).toContain('Write this total as CHP = 30.');
    expect(retired(result.text)).toEqual([]);
  });
  it('rewrites anchors, timed gaps, + and | joiners and lenient times', () => {
    const before = '- [ ] 12:55 (00) : →\n- [ ] 13:00 (?) : ...\n- [x] 14:00 (20+10) : chp+frm\n- [x] 14:30 (15|15) : chp | std\n- [x] 15:0 (30) : chp\n\n060 : SUM\n';
    const result = migrateDaily(before, '2026-10-01.md', codes);
    expect(result.text).toBe('- [ ] 12:55 (n/a) : >\n- [ ] 13:00 (n/a) : ...\n- [x] 14:00 (20-10) : chp-frm\n- [x] 14:30 (15-15) : chp-std\n- [x] 15:00 (30) : chp\n\nSUM = 60\n');
    expect(result.issues).toEqual([]);
    expect(retired(result.text)).toEqual([]);
  });
  it('joins slash names with one amount each, keeping the project credit', () => {
    const before = '- [x] 19:00 (40/55) : chores / chp\n- [x] 20:00 (60) : chp / lunch\n- [x] 21:00 (25) : breakfast/suhur\n\n100 : CHP\n100 : SUM\n';
    const result = migrateDaily(before, '2026-10-01.md', codes);
    expect(result.text).toContain('- [x] 19:00 (0-40/55) : chores-chp');
    expect(result.text).toContain('- [x] 20:00 (60-0) : chp-lunch');
    expect(result.text).toContain('- [x] 21:00 (25) : breakfast-suhur');
    expect(result.issues).toEqual([]);
  });
  it('leaves free text after a name and the n/a placeholder alone', () => {
    const before = '- [x] 10:45 (15/105) : lod / chores, meal, etc\n- [x] 11:00 (15) : n/a\n\n000 : SUM\n';
    expect(migrateDaily(before, 'x.md', ['LOD']).text).toBe('- [x] 10:45 (15/105) : lod / chores, meal, etc\n- [x] 11:00 (15) : n/a\n\nSUM = 0\n');
  });
  it('converts pre-plugin rows and totals inside routine templates, fences included', () => {
    const before = '```\n- [x] **06:00 - 06:40 (40m)**: Walk\n- [ ] **22:30**: Bedtime\n\nCHP: 00m\nSum: **40m**\n```\n';
    const result = migrateDaily(before, '_Codes/_archive/routine.md', codes);
    expect(result.text).toBe('```\n- [x] 06:40 (40) : Walk\n- [ ] 22:30 (n/a) : Bedtime\n\nCHP = 0\nSUM = 40\n```\n');
    expect(result.issues).toEqual([]);
  });
  it('keeps fenced text in ordinary notes and skips notes without planner totals', () => {
    const fenced = '```\n030 : CHP\n```\n\n030 : SUM\n';
    expect(migrateDaily(fenced, 'note.md', codes).text).toBe('```\n030 : CHP\n```\n\nSUM = 30\n');
    expect(migrateDaily('A list: 10 : ABC\n', 'note.md', codes)).toMatchObject({ kind: 'none', changed: 0 });
  });
  it('refuses a note whose counted minutes would change', () => {
    // An unmatched credit split counted nothing before; joining must not invent credit.
    const result = migrateDaily('- [x] 10:00 (30) : chp / std\n\n000 : SUM\n', 'x.md', codes);
    expect(parseDay(result.text, '', codes).entries[0]!.credits).toEqual(parseDay('- [x] 10:00 (30) : chp / std\n', '', codes).entries[0]!.credits);
  });
  it('rewrites summary rows and the period in ISO form, keeping markers and formatting', () => {
    const before = '### Days\n\n12-31 : 300 ☁️🔥\n**01-01 : 060 🦥**\n==01-02 : 000 😣== (estimated)\n01-03 : ?\n\n### Results\n\nDays (31.12.25 - 03.01.26): 4d\n';
    const result = migrateSummary(before, 'thejaz-summary.md');
    expect(result.text).toBe('### Days\n\n2025-12-31 = 300 ☁️🔥\n**2026-01-01 = 60 🦥**\n==2026-01-02 = 0 😣== (estimated)\n2026-01-03 = ?\n\n### Results\n\nDays (2025-12-31 - 2026-01-03): 4d\n');
    expect(result.issues).toEqual([]);
    expect(parseSummary(result.text, 'thejaz-summary.md').retired).toEqual([]);
    expect(parseSummary(before, 'thejaz-summary.md').retired.length).toBe(5);
  });
  it('routes summaries and daily notes by the Days period line', () => {
    expect(migrateSyntax('Days (31.12.25 - 03.01.26)\n12-31 : 300\n', 's.md', codes).kind).toBe('summary');
    expect(migrateSyntax('030 : SUM\n', '2026-10-01.md', codes).kind).toBe('daily');
  });
});
