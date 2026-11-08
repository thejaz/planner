import { describe, expect, it } from 'vitest';
import { calculate, parseDay } from '../src/core/reader';
import { applyPatches, editEntry, footerPatches, quickEntry } from '../src/core/changes';
import { projectLabelParts } from '../src/core/projects';

describe('project and ordinary activity allocations', () => {
  it.each(['frm + party', 'frm / party', 'frm|party'])('reports the retired joiner in %s with the & form named, still counting it', label => {
    const day = parseDay(`- [x] 00:10 (60-210/270) : ${label}\r\nFRM = 60\r\nSUM = 60\r\n`);
    expect(calculate(day).projects).toEqual({ FRM: 60 });
    expect(day.diagnostics.filter(d => d.code === 'retired-syntax').map(d => d.message).join(' ')).toMatch(/Use & between activities|cannot contain \//);
  });
  it.each(['frm & party', 'frm&party', 'frm &party', 'frm& party'])('pairs both amounts in %s without counting ordinary activity as credit', label => {
    const text = `- [x] 00:10 (60 - 210 / 270) : ${label} (mal runak)\r\nFRM = 60\r\nSUM = 60\r\nKeep annotation.\r\n`;
    const day = parseDay(text);
    expect(calculate(day)).toMatchObject({ projects: { FRM: 60 }, sum: 60, complete: true });
    expect(day.entries[0]!.elapsed).toBe(270);
    expect(day.diagnostics.filter(d => d.blocks || d.code === 'total-conflict')).toEqual([]);
    const parts = projectLabelParts(day.entries[0]!, ['FRM']);
    expect(parts.parts.map(p => p.text).join('')).toBe(`${label} (mal runak)`);
    expect(parts.parts.find(p => p.text === 'party')?.code).toBeNull();
    expect(parts.unknown).toEqual(['PARTY']);
    expect(applyPatches(text, footerPatches(day))).toBe(text);
  });
  it.each([
    ['party & frm', '210-60/270', { FRM: 60 }],
    ['frm & chp & party', '60-15-210/285', { FRM: 60, CHP: 15 }],
    ['party & frm & chp', '210-60-15/285', { FRM: 60, CHP: 15 }],
    ['frm & party & frm', '20-210-40/270', { FRM: 60 }],
    ['frm & party', '0-210/210', { FRM: 0 }],
    ['frm & party', '100-20/60', { FRM: 100 }],
    ['frm & writing an email', '60-45/105', { FRM: 60 }]
  ])('handles order, repeated projects, zero and intentional overflow in %s', (label, duration, projects) => {
    const day = parseDay(`- [x] 15:00 (${duration}) : ${label}`);
    expect(calculate(day)).toMatchObject({ projects, complete: true });
  });
  it('credits one amount on a group to its first component only', () => {
    expect(calculate(parseDay('- [x] 15:00 (60/270) : frm & party')).projects).toEqual({ FRM: 60 });
    expect(calculate(parseDay('- [x] 15:00 (60/270) : party & frm')).projects).toEqual({});
    expect(calculate(parseDay('- [x] 15:00 (30) : breakfast & news')).sum).toBe(0);
  });
  it.each(['60-210-10/270', '60-?/270', '?', 'n/a', '60-210/nope'])('blocks missing/malformed allocations %s without partial project credit', duration => {
    const day = parseDay(`- [x] 15:00 (${duration}) : frm & party`);
    expect(calculate(day)).toMatchObject({ projects: {}, complete: false });
    expect(day.diagnostics.some(d => d.blocks)).toBe(true);
    expect(() => footerPatches(day)).toThrow();
  });
  it('keeps multiword ordinary text and parenthesized descriptions out of project matching', () => {
    const day = parseDay('- [x] 15:00 (45) : writing an email\n- [x] 16:00 (60-10/70) : frm & party (chp & mdr)');
    expect(calculate(day)).toMatchObject({ projects: { FRM: 60 }, sum: 60, complete: true });
  });
  it('retains historical one-credit mixed slash notation', () => {
    expect(calculate(parseDay('- [x] 09:00 (10/36) : chp / breakfast\n- [x] 10:00 (40/55) : chores / chp'))).toMatchObject({ projects: { CHP: 50 }, complete: true });
  });
  it('parses spaced quick entry and /0, preserves label text and supports inline edits without rewriting surrounding prose', () => {
    const text = '### evening\n- [x] 19:40 (n/a) : setup\n- [ ] 00:10 (60-210/270) : frm & party (mal runak)\nKeep annotation.\n';
    const day = parseDay(text);
    const input = '00:10 60 - 210 / 0 frm & party (mal runak)';
    const result = quickEntry(input, 'log', day.entries[0], '00:10');
    expect(result.diagnostics).toEqual([]); expect(result.splits).toEqual([]);
    expect(result.rows).toEqual(['- [x] 00:10 (60 - 210 / 270) : frm & party (mal runak)']);
    const edited = applyPatches(text, editEntry(day, day.entries[1]!, '00:10', '60 - 210 / 0', 'frm & party (mal runak)').patches);
    expect(edited).toContain('- [ ] 00:10 (60 - 210 / 270) : frm & party (mal runak)\nKeep annotation.');
    expect(calculate(parseDay(edited))).toMatchObject({ planned: { FRM: 60 }, plannedSum: 60 });
  });
  it('does not guess a split for mixed quick entry with one amount', () => {
    const result = quickEntry('15:00 60/270 frm & party', 'log', undefined, '15:00');
    expect(result.diagnostics.length).toBeGreaterThan(0); expect(result.splits).toEqual([]);
  });
  it('keeps equal-split suggestions for recognized projects with spaced separators', () => {
    const result = quickEntry('15:00 60 frm & chp', 'log', undefined, '15:00');
    expect(result.splits).toHaveLength(1);
  });
});
