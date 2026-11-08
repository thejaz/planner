import { describe, expect, it } from 'vitest';
import { unitMinutes } from '../src/core/entry-math';
import { entryFields, quickEntry, requestsElapsed } from '../src/core/changes';
import { calculate, parseDay } from '../src/core/reader';

const codes = ['CHP', 'MDR'];
const start = parseDay('- [x] 10:00 (n/a) : start\n', 'x.md').entries[0];
const rows = (input: string) => quickEntry(input, 'log', start, '12:00', codes);

describe('0.2.61 entry input', () => {
  it('accepts units and saves plain minutes', () => {
    expect(['1h', '1h30', '1h 30m', '90m', '20m-1h/2h'].map(unitMinutes)).toEqual(['60', '90', '90', '90', '20-60/120']);
    expect(rows('1h chp').rows).toEqual(['- [x] 11:00 (60) : chp']);
    expect(rows('1h 30m chp').rows).toEqual(['- [x] 11:30 (90) : chp']);
    expect(rows('11:30 1h30/ chp').rows).toEqual(['- [x] 11:30 (90) : chp']);
    expect(rows('30m-30/1h chp-mdr').rows).toEqual(['- [x] 11:00 (30-30/60) : chp-mdr']);
  });
  it('treats blank, 0, / and /0 as elapsed without touching the name', () => {
    for (const duration of ['', '0 ', '/ ', '/0 ']) expect(rows(`10:45 ${duration}chp`).rows).toEqual(['- [x] 10:45 (45) : chp']);
    expect(['', '0', '/', '/0', '30/', '30/0'].every(requestsElapsed)).toBe(true);
    expect(entryFields('10:45 /0 chp')).toMatchObject({ label: 'chp', duration: '/0' });
  });
  it('caps calculated fractions while preserving explicit credit above elapsed', () => {
    expect(rows('11:00 1.2/ chp').rows).toEqual(['- [x] 11:00 (60/60) : chp']);
    expect(rows('70/60 chp').rows).toEqual(['- [x] 11:00 (70/60) : chp']);
  });
  it('normalizes lenient times', () => {
    expect(rows('10:5 chp').rows).toEqual(['- [x] 10:05 (5) : chp']);
  });
  it('rejects + and | with the current forms named', () => {
    expect(rows('11:00 20+10 chp & mdr').diagnostics[0]).toContain('use - between amounts, such as 20-10');
    expect(rows('11:00 20|10 chp & mdr').diagnostics[0]).toContain('use - between amounts');
    expect(rows('11:00 20-10 chp+mdr').diagnostics[0]).toContain('Use & between activities, such as prj & std');
    expect(rows('11:00 20-10 chp|mdr').diagnostics[0]).toContain('Use & between activities');
  });
  it('reads (+15 std) as plain context: no extra credit and no error', () => {
    expect(rows('11:00 60 chp (+15 mdr)')).toMatchObject({ diagnostics: [], rows: ['- [x] 11:00 (60) : chp (+15 mdr)'] });
    const day = parseDay('- [x] 11:00 (60) : chp (+15 mdr)\n- [x] 12:00 (60) : chp (+15 mdr)', '', codes);
    expect(day.diagnostics).toEqual([]);
    expect(calculate(day).projects).toEqual({ CHP: 120 });
  });
  it('rejects / in activity names with the joined suggestion', () => {
    expect(rows('11:00 30 chp / lunch').diagnostics[0]).toContain('Activity names cannot contain /. Join activities with &, such as prj & lunch');
    expect(rows('11:00 chp/lunch').diagnostics[0]).toContain('cannot contain /');
  });
  it('names the common mistakes specifically', () => {
    expect(rows('9.30 chp').diagnostics[0]).toContain('write the time with a colon');
    expect(rows('25:00 chp').diagnostics[0]).toContain('25:00 is not a time');
    expect(rows('chp 30').diagnostics[0]).toContain('put the minutes before the activity, such as 30 prj');
    expect(rows('11:00 chp 30/').diagnostics[0]).toContain('put the minutes before the activity');
    expect(rows('11:00 30/chp').diagnostics[0]).toContain('put a space after the minutes');
    expect(rows('30 chp').rows).toEqual(['- [x] 10:30 (30) : chp']);
  });
  it('writes the anchor as >', () => {
    expect(rows('12:55 >').rows).toEqual(['- [ ] 12:55 (n/a) : >']);
  });
});
