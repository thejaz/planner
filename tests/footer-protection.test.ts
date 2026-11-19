import { describe, expect, it } from 'vitest';
import { applyPatches, editEntry, fixHeading, footerPatches } from '../src/core/changes';
import { effectiveTotals, parseDay, userDisputed } from '../src/core/reader';

const codes = ['CHP', 'MDR'];
const note = '## plan for 5 oct 26\n- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : chp\n\nCHP = 30\nSUM = 30\n';

describe('calculated and protected footers', () => {
  it('keeps planner-written footers in step with a valid activity edit', () => {
    const day = parseDay(note, '2026-10-05.md', codes);
    const edited = applyPatches(note, editEntry(day, day.entries[1]!, '09:45', '45', 'chp', codes).patches);
    const after = parseDay(edited, '2026-10-05.md', codes);
    expect(userDisputed(after, note, codes)).toBe(false);
    expect(applyPatches(edited, footerPatches(after, false, codes))).toContain('CHP = 45\nSUM = 45\n');
  });
  it('keeps a total the owner changed, explains it and offers Compare totals', () => {
    const manual = note.replace('CHP = 30\nSUM = 30', 'CHP = 40\nSUM = 40');
    const day = parseDay(manual, '2026-10-05.md', codes);
    expect(userDisputed(day, note, codes)).toBe(true);
    const conflict = day.diagnostics.find(d => d.code === 'total-conflict')!;
    expect(conflict).toMatchObject({ blocks: false });
    expect(conflict.message).toContain('CHP: the note says 40m, but completed activities add up to 30m.');
    expect(conflict.action).toContain('Compare totals');
  });
  it('treats ## recorded totals notes as authoritative', () => {
    const recorded = '## recorded totals\nCHP = 12\nSUM = 12\n';
    const day = parseDay(recorded, '2026-10-05.md', codes);
    expect(effectiveTotals(day)).toMatchObject({ projects: { CHP: 12 }, sum: 12 });
    expect(applyPatches(recorded, footerPatches(day, false, codes))).toBe(recorded);
  });
});

describe('Fix heading', () => {
  it('renames only a heading that names another date, keeping surrounding spaces', () => {
    const text = note.replace('## plan for 5 oct 26', '## plan for 4 oct 26 ');
    const day = parseDay(text, '2026-10-05.md', codes), line = day.diagnostics.find(d => d.code === 'heading-date')!.line;
    const fixed = applyPatches(text, fixHeading(day, line).patches);
    expect(fixed).toBe(note.replace('## plan for 5 oct 26', '## plan for 5 oct 26 '));
    expect(parseDay(fixed, '2026-10-05.md', codes).diagnostics.some(d => d.code === 'heading-date')).toBe(false);
  });
  it('refuses a heading that is already right or a template', () => {
    const day = parseDay(note, '2026-10-05.md', codes);
    expect(() => fixHeading(day, 0)).toThrow('already');
    const template = parseDay(note.replace('5 oct 26', '?? ??? 26'), '2026-10-05.md', codes);
    expect(() => fixHeading(template, 0)).toThrow('already');
  });
});
