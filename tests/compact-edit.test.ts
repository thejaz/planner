import { describe, expect, it } from 'vitest';
import { applyPatches, compactActivity, compactEdit, editParts, rebase } from '../src/core/changes';
import { parseDay } from '../src/core/reader';

const source = (raw: string) => parseDay(`Intro untouched\r\n### morning\r\n- [x] 09:00 (n/a) : start\r\n${raw}\r\n### afternoon\r\n- [ ] 12:00 (30) : buffer\r\nTail untouched\r\n`, '2007-01-01.md');
describe('compact editing of exactly one activity', () => {
  it.each(['x', ' '])('edits %s in place, preserving status, section, count and surrounding text', status => {
    const raw = `- [${status}] 09:30 (30) : chp`, day = source(raw), entry = day.entries[1]!;
    const { change } = compactEdit(day, entry, '09:45 45 frm', '15:00');
    const text = applyPatches(day.text, change.patches);
    expect(text).toBe(day.text.replace(raw, `- [${status}] 09:45 (45) : frm`));
    expect(parseDay(text).entries).toHaveLength(day.entries.length);
  });
  it.each(['0', '0/0', '20-10/30', '?', 'n/a'])('untouched %s is byte-exact with no patches', duration => {
    const day = source(`- [X]   09:30 (${duration}) : chp`), entry = day.entries[1]!;
    expect(compactEdit(day, entry, compactActivity(entry), '15:00').change.patches).toEqual([]);
  });
  it('shows a row in source order and keeps digits in its name through an edit', () => {
    const day = source('- [x] 09:30 (30) : read chapter 2'), entry = day.entries[1]!;
    expect(compactActivity(entry)).toBe('09:30 30 read chapter 2');
    expect(compactEdit(day, entry, compactActivity(entry), '15:00').change.patches).toEqual([]);
    expect(compactEdit(day, entry, '09:40 40 read chapter 2', '15:00').entry.raw).toBe('- [x] 09:40 (40) : read chapter 2');
    const numbered = source('- [ ] 09:30 (30) : 2 coffees'), first = numbered.entries[1]!;
    expect(compactActivity(first)).toBe('09:30 30 2 coffees');
    expect(compactEdit(numbered, first, '09:35 35 2 coffees', '15:00').entry.label).toBe('2 coffees');
  });
  it('locates the time, minutes and whole activity for the opening selection', () => {
    const pick = (raw: string, part: 'time' | 'minutes' | 'activity' | 'schedule') => {
      const entry = parseDay(raw).entries[0]!, text = compactActivity(entry), [start, end] = editParts(text, entry)[part];
      return text.slice(start, end);
    };
    expect(['time', 'minutes', 'activity'].map(p => pick('- [ ] 08:55 (20) : recovery', p as 'time'))).toEqual(['08:55', '20', 'recovery']);
    expect(pick('- [x] 08:35 (51) : hike (gwezakwer)', 'activity')).toBe('hike (gwezakwer)');
    expect(pick('- [ ] 10:00 (60-210/270) : frm & party 2', 'minutes')).toBe('60-210/270');
    expect(pick('- [ ] 10:00 (60-210/270) : frm & party 2', 'activity')).toBe('frm & party 2');
    expect(pick('- [ ] ...', 'activity')).toBe('...');
    expect(pick('- [x] ?', 'activity')).toBe('?');
    // Edit, E, Enter and F2 select the end time and minutes together.
    expect(pick('- [ ] 08:55 (20) : recovery', 'schedule')).toBe('08:55 20');
    expect(pick('- [ ] 10:00 (60-210/270) : frm & party 2', 'schedule')).toBe('10:00 60-210/270');
    expect(pick('- [ ] ...', 'schedule')).toBe('...');
  });
  it('preserves a recorded literal zero when only the label changes', () => {
    const day = source('- [x] 09:30 (0) : chp'), entry = day.entries[1]!;
    expect(compactEdit(day, entry, '09:30 0 frm', '15:00').entry.duration).toBe('0');
    expect(compactEdit(day, entry, '09:30 0 chp', '15:00', undefined, { durationTouched: true }).entry.duration).toBe('30');
  });
  it.each(['09:40 chp', '09:40 0 chp'])('calculates %s from the predecessor, not itself', input => {
    const day = source('- [x] 09:30 (30) : chp');
    expect(compactEdit(day, day.entries[1]!, input, '15:00', undefined, { durationTouched: true }).entry.duration).toBe('40');
  });
  it('retains split amounts and resolves /0, including now and shorthand durations', () => {
    const day = source('- [x] 09:30 (15-15/30) : chp & frm');
    expect(compactEdit(day, day.entries[1]!, '09:50 25-25/0 chp & frm', '15:00').entry.duration).toBe('25-25/50');
    expect(compactEdit(day, day.entries[1]!, 'now 20/ chp', '09:50').entry.duration).toBe('20/50');
    expect(compactEdit(day, day.entries[1]!, '50 chp', '15:00').entry.time).toBe('09:50');
  });
  it('needs a known end time before it to calculate; without minutes it saves n/a; never generates a baseline', () => {
    const day = parseDay('- [x] ?\n- [ ] 09:30 (30) : chp');
    expect(() => compactEdit(day, day.entries[1]!, '50 chp', '15:00')).toThrow('known time');
    expect(compactEdit(day, day.entries[1]!, '09:45 chp', '15:00').entry.duration).toBe('n/a');
    expect(() => compactEdit(day, day.entries[1]!, '09:30 0 chp', '15:00', undefined, { durationTouched: true })).toThrow('previous activity');
    expect(compactEdit(day, day.entries[1]!, '10:00 50 chp', '15:00').entry.time).toBe('10:00');
    expect(compactEdit(day, day.entries[0]!, '09:00 n/a start', '15:00').entry.checked).toBe(true);
  });
  it.each(['', '09:30 20 chp\n10:00 30 frm', '09:30 20 chp\n', '99:00 30 chp', '09:30 20 chp & frm', '09:30 chp 20'])('rejects invalid or multiple input %j without a change', input => {
    const day = source('- [x] 09:30 (30) : chp');
    expect(() => compactEdit(day, day.entries[1]!, input, '15:00')).toThrow();
  });
  it('rejects stale target and calculation anchor while allowing unrelated text edits', () => {
    const day = source('- [x] 09:30 (30) : chp');
    const change = compactEdit(day, day.entries[1]!, '09:40 0 chp', '15:00', undefined, { durationTouched: true }).change;
    expect(() => rebase(change, day.text.replace('09:30 (30)', '09:35 (35)'))).toThrow();
    expect(() => rebase(change, day.text.replace('09:00 (n/a)', '08:55 (n/a)'))).toThrow();
    const updated = day.text + '\r\nUnrelated prose';
    expect(applyPatches(updated, rebase(change, updated))).toContain('09:40 (40) : chp');
  });
});
