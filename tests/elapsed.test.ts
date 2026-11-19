import { describe, expect, it } from 'vitest';
import { applyPatches, editEntry, guardElapsedAnchor, insertRows, quickEntry, rebase, resolveDuration } from '../src/core/changes';
import { calculate, parseDay } from '../src/core/reader';

describe('elapsed-time input shortcuts', () => {
  it.each([
    ['chp & frm', 72, '36-36/0'],
    ['chp & frm', 73, '37-36/0'],
    ['chp & frm & mdr', 73, '25-24-24/0'],
    ['chp & frm & mdr & jib', 73, '19-18-18-18/0']
  ])('offers an explicit, balanced allocation for %s without silently applying it', (projects, minutes, allocation) => {
    const previous = parseDay('- [x] 16:10 (n/a) : setup').entries[0];
    const end = `${Math.floor((970 + minutes) / 60)}:${String((970 + minutes) % 60).padStart(2, '0')}`;
    const result = quickEntry(`now ${projects}`, 'log', previous, end);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]!.input).toBe(`now ${allocation} ${projects}`);
    const accepted = quickEntry(result.splits[0]!.input, 'log', previous, end);
    expect(accepted.diagnostics).toEqual([]);
    expect(calculate(parseDay(accepted.rows.join('\n'))).sum).toBe(minutes);
  });
  it('does not replace explicit allocations and does not guess for unknown project names', () => {
    const previous = parseDay('- [x] 16:10 (n/a) : setup').entries[0];
    expect(quickEntry('now 40-32/0 chp & frm', 'log', previous, '17:22').splits).toEqual([]);
    expect(quickEntry('now chp-unknown', 'log', previous, '17:22').splits).toEqual([]);
    expect(quickEntry('now chp & frm', 'log', undefined, '17:22').splits).toEqual([]);
  });
  it.each([
    ['', '285'], [' ', '285'], ['0', '285'], ['95-95/0', '95-95/285'], ['70/0', '70/285'],
    ['0/0', '0/285'], ['10-20-30-40/0', '10-20-30-40/285'],
    ['0/200', '0/200'], ['95-95/200', '95-95/200'], ['?', '?'], ['n/a', 'n/a']
  ])('resolves %s without changing explicit credits', (input, output) => {
    expect(resolveDuration(input, 585, '14:30')).toBe(output);
  });
  it('handles clear midnight and repeated endpoints', () => {
    expect(resolveDuration('0', 23 * 60 + 50, '00:10')).toBe('20');
    expect(resolveDuration('0', 585, '09:45')).toBe('0');
  });
  it('treats omitted quick-entry minutes and an explicitly cleared edit duration like zero', () => {
    const day = parseDay('- [x] 09:45 (n/a) : awake\n- [ ] 14:30 (200) : chp');
    const omitted = quickEntry('14:30 chp', 'log', day.entries[0], '14:30');
    const zero = quickEntry('14:30 0 chp', 'log', day.entries[0], '14:30');
    expect(omitted).toEqual(zero);
    expect(omitted.rows).toEqual(['- [x] 14:30 (285) : chp']);
    expect(applyPatches(day.text, editEntry(day, day.entries[1]!, '14:30', '', 'chp').patches)).toContain('(285) : chp');
    expect(() => resolveDuration('', null, '14:30')).toThrow('previous activity');
  });
  it('rejects missing, unknown, invalid and ambiguous anchors', () => {
    expect(() => resolveDuration('0', null, '14:30')).toThrow('previous activity');
    expect(() => resolveDuration('95/0', 585, '25:00')).toThrow('valid end time');
    expect(() => resolveDuration('95/0', 900, '14:30')).toThrow('backwards ambiguously');
    const day = parseDay('- [x] 09:45 (n/a) : awake\n- [ ] ?\n- [ ] 14:30 (200) : chp');
    expect(() => editEntry(day, day.entries[2]!, '14:30', '0', 'chp')).toThrow('previous activity');
  });
  it('changes only the requested row and retains checkbox, label, credit and line endings', () => {
    const raw = '## personal title\r\n- [x] 09:45 (n/a) : awake\r\n- [ ] 14:30 (95-95/200) : chp & mdr (my text)\r\n\r\nunrelated **notes**';
    const day = parseDay(raw);
    const change = editEntry(day, day.entries[1]!, '14:30', '95-95/0', 'chp & mdr (my text)');
    expect(applyPatches(raw, change.patches)).toBe(raw.replace('95-95/200', '95-95/285'));
    const completed = parseDay(applyPatches(raw, change.patches).replace('[ ]', '[x]'));
    expect(calculate(completed).projects).toEqual({ CHP: 95, MDR: 95 });
  });
  it('does not invent split credits for bare zero', () => {
    const day = parseDay('- [x] 09:45 (n/a) : awake\n- [ ] 14:30 (95-95/200) : chp & mdr');
    expect(() => editEntry(day, day.entries[1]!, '14:30', '0', 'chp & mdr')).toThrow('project split');
    expect(quickEntry('14:30 0 chp & mdr', 'log', day.entries[0], '14:30').diagnostics.length).toBeGreaterThan(0);
  });
  it('keeps existing zeroes literal on read or an unrelated edit', () => {
    const day = parseDay('- [x] 09:45 (n/a) : awake\n- [x] 14:30 (0) : chp');
    expect(calculate(day).sum).toBe(0);
    const change = editEntry(day, day.entries[1]!, '14:30', '0', 'chp (note)', undefined, false);
    expect(applyPatches(day.text, change.patches)).toContain('(0) : chp (note)');
  });
  it('resolves each multiline input against its own preceding endpoint', () => {
    const previous = parseDay('- [x] 09:45 (n/a) : awake').entries[0];
    const result = quickEntry('14:30 95-95/0 chp & mdr\n15:00 0 chp\n15:45 20/0 mdr', 'log', previous, '15:45');
    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toEqual([
      '- [x] 14:30 (95-95/285) : chp & mdr', '- [x] 15:00 (30) : chp', '- [x] 15:45 (20/45) : mdr'
    ]);
    expect(quickEntry('now 0 chp', 'plan', previous, '14:30').rows[0]).toBe('- [ ] 14:30 (285) : chp');
  });
  it('rejects a stale calculation if a long preceding row changes while editing', () => {
    const raw = `- [x] 09:45 (n/a) : awake ${'a'.repeat(100)}\n- [ ] 14:30 (200) : chp`;
    const day = parseDay(raw);
    const change = editEntry(day, day.entries[1]!, '14:30', '0', 'chp');
    expect(() => rebase(change, raw.replace('09:45', '10:00'))).toThrow('changed elsewhere');
    const current = `new note\n${raw}`;
    expect(applyPatches(current, rebase(change, current))).toContain('(285) : chp');
    const insertion = guardElapsedAnchor(day, insertRows(day, ['- [x] 10:00 (15) : chp'], day.entries[0]), day.entries[0]);
    expect(() => rebase(insertion, raw.replace('09:45', '09:50'))).toThrow('changed elsewhere');
    expect(applyPatches(raw, insertion.patches)).toContain('10:00 (15)');
  });
});
