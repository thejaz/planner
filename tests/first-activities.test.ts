import { describe, expect, it } from 'vitest';
import { compactEdit, quickEntry } from '../src/core/changes';
import { parseDay } from '../src/core/reader';
import { ActivityOccurrences, IndexedDays, occurrenceNames } from '../src/core/activity-occurrences';

describe('a first activity with an end time and no minutes', () => {
  it('saves n/a instead of inserting the start row', () => {
    const result = quickEntry('05:35 frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true });
    expect(result.rows).toEqual(['- [ ] 05:35 (n/a) : frm']);
    expect(result.warnings).toEqual([]); expect(result.diagnostics).toEqual([]);
    expect(quickEntry('05:35 walk', 'log', undefined, '12:00').rows).toEqual(['- [x] 05:35 (n/a) : walk']);
    expect(quickEntry('now lunch & walk', 'log', undefined, '12:00').rows).toEqual(['- [x] 12:00 (n/a) : lunch & walk']);
  });
  it('calculates later lines from it and keeps written or requested minutes as before', () => {
    expect(quickEntry('05:35 frm\n06:00 chp', 'log', undefined, '12:00').rows).toEqual(['- [x] 05:35 (n/a) : frm', '- [x] 06:00 (25) : chp']);
    expect(quickEntry('05:35 50 frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows).toEqual(['- [ ] 05:35 (50) : frm']);
    // An elapsed request still needs a start: the configured baseline supplies it.
    expect(quickEntry('05:35 / frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows).toEqual(['- [ ] 04:45 (n/a) : awake', '- [ ] 05:35 (50) : frm']);
    expect(quickEntry('50 frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows[0]).toBe('- [ ] 04:45 (n/a) : awake');
  });
  it('edits the first row to n/a when its minutes are left out', () => {
    const day = parseDay('- [x] 09:30 (30) : walk\n- [ ] 10:00 (30) : frm');
    expect(compactEdit(day, day.entries[0]!, '09:15 walk', '15:00').entry.duration).toBe('n/a');
    expect(() => compactEdit(day, day.entries[0]!, '09:15 / walk', '15:00')).toThrow('previous activity');
  });
  it('edits a row after a gap or an unknown end time to n/a when its minutes are left out', () => {
    for (const before of ['- [ ] ...', '- [x] ? (30) : walk']) {
      const day = parseDay(`- [x] 09:00 (n/a) : walk\n${before}\n- [ ] 10:00 (30) : read`);
      expect(compactEdit(day, day.entries[2]!, '10:15 read', '15:00').entry.duration).toBe('n/a');
      expect(compactEdit(day, day.entries[2]!, '10:15 read', '15:00', undefined, { durationTouched: true }).entry.duration).toBe('n/a');
      expect(() => compactEdit(day, day.entries[2]!, '10:15 / read', '15:00')).toThrow('previous activity');
    }
  });
  it('still asks for minutes when a completed first project would earn no credit, saying how', () => {
    const message = quickEntry('05:35 frm', 'log', undefined, '12:00', undefined, { allowBaseline: true }).diagnostics.join(' ');
    expect(message).toContain('Add them, such as 05:35 30 frm, or 05:35 / frm to count from the configured start.');
    expect(quickEntry('05:35 frm', 'log', undefined, '12:00').diagnostics.join(' ')).not.toContain('configured start');
  });
  it('gives n/a groups no amount-splitting advice', () => {
    expect(quickEntry('05:35 walk & chp', 'plan', undefined, '12:00')).toMatchObject({ rows: ['- [ ] 05:35 (n/a) : walk & chp'], diagnostics: [], splits: [] });
    const logged = quickEntry('05:35 chp & frm', 'log', undefined, '12:00');
    expect(logged.splits).toEqual([]);
    expect(logged.diagnostics.join(' ')).not.toMatch(/n-0\/a|Split equally/);
  });
});

describe('activity occurrences', () => {
  const day = (text: string) => parseDay(text);
  it('names each part once per occurrence, without placeholders', () => {
    expect(occurrenceNames({ label: 'Lunch (with friends) & walk' })).toEqual(['lunch', 'walk']);
    for (const label of ['?', '...', '>', 'n/a', 'N/A (asleep)', '2 chapters']) expect(occurrenceNames({ label })).toEqual([]);
    expect(occurrenceNames({ label: 'n/a & walk' })).toEqual(['walk']);
    expect(occurrenceNames({ label: 'van/a' })).toEqual(['van', 'a']);
  });
  it('counts across days and adjusts only the replaced or removed day', () => {
    const index = new ActivityOccurrences();
    index.set('a.md', day('- [x] 09:00 (n/a) : yoga\n- [x] 10:00 (60) : chp & yoga'));
    index.set('b.md', day('- [x] 09:00 (n/a) : swim'));
    expect([index.count('yoga'), index.isFirst('swim'), index.isFirst('chp')]).toEqual([2, true, true]);
    index.set('a.md', day('- [x] 09:00 (n/a) : swim'));
    expect([index.count('yoga'), index.isFirst('swim')]).toEqual([0, false]);
    index.delete('b.md');
    expect(index.isFirst('SWIM')).toBe(true);
  });
  it('stays current through every Map change of the indexed days', () => {
    const days = new IndexedDays();
    days.set('a.md', day('- [x] 09:00 (n/a) : yoga'));
    expect(days.occurrences.isFirst('yoga')).toBe(true);
    days.set('b.md', day('- [ ] 18:00 (n/a) : yoga'));
    expect(days.occurrences.isFirst('yoga')).toBe(false);
    days.delete('a.md');
    expect(days.occurrences.isFirst('yoga')).toBe(true);
    days.clear();
    expect([days.size, days.occurrences.count('yoga')]).toEqual([0, 0]);
  });
});
