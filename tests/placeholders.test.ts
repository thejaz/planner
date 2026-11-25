import { describe, expect, it } from 'vitest';
import { applyPatches, editEntry, footerPatches, insertRows, quickEntry, toggleEntry } from '../src/core/changes';
import { calculate, effectiveTotals, parseDay } from '../src/core/reader';
import { parseSummary, review, summaryPatches } from '../src/core/history';

describe('plain Markdown unknown placeholders', () => {
  it.each(['plan', 'log'] as const)('always inserts unchecked placeholders in %s mode', mode => {
    const result = quickEntry('?\n12:55 >', mode, undefined, '13:00');
    // A bare ? is a gap: nothing about it is known.
    expect(result.rows).toEqual(['- [ ] ...', '- [ ] 12:55 (n/a) : >']);
    expect(result.diagnostics).toEqual([]); expect(result.calculated).toBe(false);
  });
  it('breaks unknown time chains and resumes at a timed anchor without inventing credits', () => {
    const result = quickEntry('?\n12:55 >\n13:15 0 chp', 'log', undefined, '13:15');
    expect(result.diagnostics).toEqual([]);
    expect(result.rows.at(-1)).toBe('- [x] 13:15 (20) : chp');
    expect(quickEntry('?\n13:15 0 chp', 'plan', undefined, '13:15').diagnostics.join()).toContain('previous activity');
    const day = parseDay(result.rows.join('\n'));
    expect(day.entries[1]!.elapsed).toBeNull(); expect(day.entries[1]!.credits).toEqual({});
    expect(calculate(day).sum).toBe(20); expect(calculate(day).complete).toBe(true);
  });
  it('validates anchor times and preserves midnight handling', () => {
    const prev = parseDay('- [x] 23:50 (n/a) : awake').entries[0];
    expect(quickEntry('00:10 >', 'plan', prev, '00:10').diagnostics).toEqual([]);
    expect(quickEntry('25:00 >', 'plan', prev, '00:10').diagnostics.join()).toContain('invalid time');
    expect(quickEntry('22:00 >', 'plan', prev, '00:10').diagnostics.join()).toContain('backward');
  });
  it.each(['?', '12:55 (n/a) : >'])('keeps %s unknown when checked and blocks derived writes', placeholder => {
    const raw = `- [x] 12:00 (60) : chp\n- [ ] ${placeholder}\nCHP = 60\nSUM = 60\nMy annotation.\n`;
    const planned = parseDay(raw, '2009-01-01.md');
    expect(planned.entries[1]!.unknownCredit).toBe(true); expect(calculate(planned).complete).toBe(true);
    const checked = parseDay(applyPatches(raw, toggleEntry(planned, planned.entries[1]!).patches), planned.path);
    expect(calculate(checked)).toMatchObject({ sum: 60, complete: false });
    expect(effectiveTotals(checked)).toMatchObject({ sum: 60, complete: false });
    expect(() => footerPatches(checked)).toThrow();
    const summary = parseSummary('### Days\n2009-01-01 = 60 🦥\n### Projects\nCHP = 60\n### Results\nDays (2009-01-01 - 2009-01-01): 1d\n', 'summary.md');
    const update = summaryPatches(summary, [checked], '2009-01-01', new Set(['2009-01-01']));
    expect(update.patches).toEqual([]); expect(update.issues.length).toBeGreaterThan(0);
    expect(review([checked], '2009-01-01', '2009-01-01').complete).toBe(false);
    const uncheck = parseDay(applyPatches(checked.text, toggleEntry(checked, checked.entries[1]!).patches));
    expect(calculate(uncheck).complete).toBe(true); expect(uncheck.text).toContain('My annotation.');
  });
  it('preserves existing placeholders on edit and permits explicit replacement', () => {
    const day = parseDay('- [ ] ?\r\n- [ ] 12:55 (n/a) : >\r\n');
    expect(applyPatches(day.text, editEntry(day, day.entries[0]!, '', '?', '?', undefined, false).patches)).toBe(day.text);
    const replaced = applyPatches(day.text, editEntry(day, day.entries[0]!, '12:00', '20', 'chp').patches);
    expect(replaced).toBe('- [ ] 12:00 (20) : chp\r\n- [ ] 12:55 (n/a) : >\r\n');
  });
  it('distinguishes literal zero from unknown duration without a recorded footer', () => {
    expect(calculate(parseDay('- [x] 12:00 (0) : chp')).complete).toBe(true);
    const day = parseDay('- [x] 12:00 (60) : chp\n- [x] ?');
    expect(calculate(day)).toMatchObject({ sum: 60, complete: false }); expect(effectiveTotals(day).sum).toBeNull();
    expect(parseDay('- [x] 12:00 (?) : meeting').entries[0]!.unknownCredit).toBe(true);
  });
  it.each(['20/10', '30/20', '100/60'])('preserves intentional overflow %s', duration => {
    const result = quickEntry(`13:00 ${duration} chp`, 'log', undefined, '13:00');
    expect(result.diagnostics).toEqual([]);
    const day = parseDay(result.rows.join('\n'));
    expect(calculate(day).sum).toBe(Number(duration.split('/')[0]));
    expect(day.diagnostics.find(d => d.code === 'credit-exceeds-elapsed')?.blocks).toBe(false);
    expect(calculate(day).complete).toBe(true);
  });
});

describe('review fixes in the reader (0.3.0)', () => {
  it('gives an unchecked restart anchor no warning; a checked one still blocks', () => {
    const planned = parseDay('- [x] 12:00 (60) : chp\n- [ ] 12:55 (n/a) : >\nCHP = 60\nSUM = 60\n', '2009-01-01.md');
    expect(planned.diagnostics.map(d => d.code)).not.toContain('unknown-activity');
    const checked = parseDay('- [x] 12:00 (60) : chp\n- [x] 12:55 (n/a) : >\nCHP = 60\nSUM = 60\n', '2009-01-01.md');
    expect(checked.diagnostics.some(d => d.code === 'unknown-activity' && d.blocks)).toBe(true);
  });
  it('updates the total after its = sign, never a footnote number', () => {
    const raw = '## plan for x\n### morning\n- [ ] 12:55 (n/a) : >\n- [x] 13:25 (30) : prj\n\n---\n\nPRJ = 1 [^1]\nSUM = 1[^1]\n';
    const day = parseDay(raw, '2009-01-01.md', ['PRJ']);
    const next = applyPatches(raw, footerPatches(day, false, ['PRJ']));
    expect(next).toContain('PRJ = 30 [^1]'); expect(next).toContain('SUM = 30[^1]');
  });
  it('reads prose that starts with a code as text, not as an unreadable total', () => {
    const day = parseDay('## plan for x\n### morning\n- [x] 09:00 (n/a) : awake\nprj: call John about the report\nNote: prj\n\nPRJ = 0\nSUM = 0\n', '2009-01-01.md', ['PRJ']);
    expect(day.diagnostics.map(d => d.code)).not.toContain('invalid-total');
    const broken = parseDay('## plan for x\nPRJ: 30m?\nSUM = 0\n', '2009-01-01.md', ['PRJ']);
    expect(broken.diagnostics.map(d => d.code)).toContain('invalid-total');
  });
  it('never glues an inserted row onto a last line without a newline', () => {
    const day = parseDay('## plan for 5 oct 26', '2026-10-05.md');
    expect(applyPatches(day.text, insertRows(day, ['- [ ] 08:00 (30) : prj'], undefined, 'evening').patches)).toBe('## plan for 5 oct 26\n- [ ] 08:00 (30) : prj\n');
  });
  it('reads 2h30 in a summary row as 150 minutes', () => {
    expect(parseSummary('### Days\n2026-05-01 = 2h30\nDays (2026-05-01 - 2026-05-01)\n', 's.md').rows[0]!.value).toBe(150);
  });
});
