import { describe, expect, it } from 'vitest';
import { calculate, parseDay } from '../src/core/reader';
import { EntryInputError, applyPatches, compactEdit, quickEntry } from '../src/core/changes';
import { removeProject } from '../src/core/project-removal';

const codes = ['CHP', 'MDR'];
const row = (duration: string, label: string) => parseDay(`- [x] 09:00 (${duration}) : ${label}\n`, 'd.md', codes);
const start = parseDay('- [x] 08:00 (n/a) : start\n', 'd.md', codes).entries[0];
const quick = (input: string) => quickEntry(input, 'log', start, '12:00', codes);

describe('& joins activities; - separates amounts', () => {
  it.each(['chp & mdr', 'chp&mdr', 'chp &mdr'])('maps amounts left to right in %s', label => {
    expect(calculate(row('20-10', label)).projects).toEqual({ CHP: 20, MDR: 10 });
  });
  it('reads a hyphen as part of one name', () => {
    const day = row('15', 'check-in');
    expect(calculate(day).projects).toEqual({});
    expect(day.diagnostics.filter(d => d.blocks)).toEqual([]);
  });
  it('flags a hyphen that still joins projects instead of dropping their credit', () => {
    for (const day of [row('20-10', 'chp-mdr'), row('230-30/260', 'free-chp')]) {
      expect(day.entries[0]!.unknownCredit).toBe(true);
      expect(day.diagnostics.find(d => d.code === 'hyphen-joiner')).toMatchObject({ blocks: true });
    }
    expect(row('20-10', 'chp-mdr').diagnostics.find(d => d.code === 'hyphen-joiner')!.action).toContain('chp & mdr');
    expect(row('30', 'chp-notes').diagnostics.some(d => d.code === 'hyphen-joiner')).toBe(false);
  });
  it('keeps parenthesized context literal, including & and project codes', () => {
    expect(calculate(row('20-10/40', 'chp & mdr (client & home)')).projects).toEqual({ CHP: 20, MDR: 10 });
    expect(calculate(row('30', 'breakfast & news (about chp)')).projects).toEqual({});
  });
  it('writes a spaced & and asks new project groups for one amount each', () => {
    expect(quick('12:00 20-10 chp&mdr').rows).toEqual(['- [x] 12:00 (20-10) : chp & mdr']);
    expect(quick('12:00 30 breakfast & news').rows).toEqual(['- [x] 12:00 (30) : breakfast & news']);
    const projects = quick('12:00 30 chp & mdr');
    expect(projects.diagnostics[0]).toContain('divide credit'); expect(projects.splits[0]?.input).toBe('12:00 15-15/30 chp & mdr');
    const mixed = quick('12:00 30 chp & lunch');
    expect(mixed.splits).toEqual([]); expect(mixed.diagnostics[0]).toContain('one amount per activity');
  });
  it('names the written text, the reason and a valid example', () => {
    expect(row('20-10', 'chp-mdr').diagnostics.find(d => d.code === 'hyphen-joiner')!.message).toContain('"chp-mdr" reads as one activity');
    expect(quick('12:00 30 chp & lunch').diagnostics[0]).toContain('"30 chp & lunch" has one amount for 2 activities, so only chp would earn it. Give one amount per activity, such as 30-0 chp & lunch.');
  });
  it('gives the activity editor the same Split equally choice without saving', () => {
    const day = parseDay('- [x] 09:00 (n/a) : awake\n- [ ] 09:30 (30) : chp\n', 'd.md', codes);
    let error: unknown;
    try { compactEdit(day, day.entries[1]!, '09:30 30 chp & mdr', '12:00', codes, { durationTouched: true }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(EntryInputError);
    expect((error as EntryInputError).splits.map(s => s.input)).toEqual(['09:30 15-15/30 chp & mdr']);
    expect(compactEdit(day, day.entries[1]!, '09:30 15-15/30 chp & mdr', '12:00', codes, { durationTouched: true }).change.patches[0]!.after).toBe('- [ ] 09:30 (15-15/30) : chp & mdr');
    expect(() => compactEdit(day, day.entries[1]!, '09:30 30 chp & lunch', '12:00', codes, { durationTouched: true })).toThrow('one amount per activity');
  });
  it('removes one project from an & group and keeps its joiners', () => {
    const text = '- [x] 09:00 (20-10-5/40) : chp & mdr & lunch\nCHP = 20\nMDR = 10\nSUM = 30\n';
    const plan = removeProject([{ path: '2018-01-01.md', text }], 'MDR', 'delete', codes);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(text, plan.changes[0]!.patches)).toContain('(20-5/40) : chp & lunch');
  });
});
