import { describe, expect, it } from 'vitest';
import { applyPatches, guardElapsedAnchor, insertRows, quickEntry, rebase, resolveDuration } from '../src/core/changes';
import { calculate, parseDay } from '../src/core/reader';
import { ENTRY_DEFAULTS, normalizeEntryDefaults, validateEntryDefaults } from '../src/core/entry-defaults';

const previous = parseDay('- [x] 09:30 (n/a) : awake').entries[0];
describe('duration-based entry and elapsed shortcuts', () => {
  it.each([
    ['frm', '10:10', '40'], ['50 frm', '10:20', '50'], ['30/50 frm', '10:20', '30/50'],
    ['20-30/50 frm & party', '10:20', '20-30/50'], ['20 - 30 frm & party', '10:20', '20 - 30'],
    ['50 writing an email', '10:20', '50'], ['100/50 frm', '10:20', '100/50'],
    ['10:20 frm', '10:20', '50'], ['10:20 30/ frm', '10:20', '30/50'],
    ['10:00 30/ frm', '10:00', '30'], ['10:00 30/0 frm', '10:00', '30'],
    ['10:20 30 / frm', '10:20', '30 /50']
  ])('resolves %s to the expected plain Markdown', (input, time, duration) => {
    const result = quickEntry(input, 'log', previous, '12:00');
    expect(result.diagnostics).toEqual([]); expect(result.calculated).toBe(true);
    const parsed = parseDay(result.rows.join('\n'));
    expect(parsed.entries[0]).toMatchObject({ time, duration, checked: true });
    expect(parsed.entries[0]!.unknownCredit).toBe(false);
  });
  it.each(['0 frm', '-5 frm', '1.5 frm', '30/ frm', '30/0 frm', '? frm', 'n/a frm', '1440 frm', '9007199254740992 frm', '25:00 50 frm', 'frm 50'])('rejects %s without inventing elapsed time', input => {
    expect(quickEntry(input, 'log', previous, '12:00').diagnostics.length).toBeGreaterThan(0);
  });
  it('uses custom blocks and requires a known anchor unless a truly empty plan permits the baseline', () => {
    expect(quickEntry('frm', 'plan', previous, '12:00', undefined, { defaultBlockMinutes: 25 }).rows).toEqual(['- [ ] 09:55 (25) : frm']);
    expect(quickEntry('50 frm', 'plan', undefined, '12:00').diagnostics.length).toBeGreaterThan(0);
    const result = quickEntry('50 frm', 'log', undefined, '12:00', undefined, { allowBaseline: true });
    expect(result.rows).toEqual(['- [ ] 04:45 (n/a) : awake', '- [x] 05:35 (50) : frm']);
    expect(result.warnings).toHaveLength(1);
    expect(quickEntry('05:35 50 frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows).toHaveLength(1);
    expect(quickEntry('05:35 >', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows).toHaveLength(1);
    expect(quickEntry('05:35 frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true }).rows).toEqual(['- [ ] 05:35 (n/a) : frm']);
  });
  it.each(['...', '?'])('breaks the chain at %s and requires explicit re-anchoring', gap => {
    const broken = quickEntry(`${gap}\n50 frm`, 'log', undefined, '12:00', undefined, { allowBaseline: true });
    // An unknown entry with nothing known is written as the gap ...
    expect(broken.rows).toEqual(['- [ ] ...']); expect(broken.diagnostics.length).toBeGreaterThan(0);
    const valid = quickEntry(`${gap}\n14:00 >\nfrm`, 'log', previous, '12:00');
    expect(valid.diagnostics).toEqual([]); expect(valid.rows.at(-1)).toBe('- [x] 14:40 (40) : frm');
    expect(quickEntry(`${gap}\n14:00 50 frm`, 'log', previous, '12:00').diagnostics).toEqual([]);
    const untimed = parseDay(`- [ ] ${gap}`).entries[0];
    expect(quickEntry('frm', 'plan', untimed, '12:00', undefined, { allowBaseline: true }).diagnostics.length).toBeGreaterThan(0);
  });
  it('does not infer across a gap and gives intentional gaps no unknown-credit warning', () => {
    const text = '- [x] 09:00 (40) : frm\n- [ ] ...\n- [x] 14:00 (50) : chp';
    const day = parseDay(text);
    expect(day.entries[2]!.interval).toBeNull(); expect(day.diagnostics).toEqual([]);
    expect(calculate(day)).toMatchObject({ sum: 90, complete: true });
    expect(day.entries[1]!.unknownCredit).toBe(false);
  });
  it.each(['30/', '30/0'])('shortens %s only when resolving, not when reading a literal duration', duration => {
    expect(resolveDuration(duration, 570, '10:00')).toBe('30');
    expect(resolveDuration(duration, 570, '10:20')).toBe('30/50');
    expect(resolveDuration(duration, 570, '09:50')).toBe('30/20');
    expect(resolveDuration('30/30', 570, '10:00')).toBe('30/30');
    expect(parseDay('- [ ] 10:00 (30/30) : frm').entries[0]!.duration).toBe('30/30');
    expect(() => resolveDuration(duration, null, '10:00')).toThrow();
  });
  it('retains split amounts and supports midnight and long unambiguous duration blocks', () => {
    expect(resolveDuration('20-10/', 570, '10:20')).toBe('20-10/50');
    const midnight = parseDay('- [x] 23:50 (n/a) : setup').entries[0];
    expect(quickEntry('30 frm', 'log', midnight, '12:00').rows).toEqual(['- [x] 00:20 (30) : frm']);
    const result = quickEntry('1000 frm', 'log', previous, '12:00');
    expect(result.diagnostics).toEqual([]);
    const day = parseDay(`${previous!.raw}\n${result.rows.join('\n')}`);
    expect(day.diagnostics.some(d => d.blocks)).toBe(false);
    expect(day.entries[1]!.interval).toBe(1000);
  });
  it('offers explicit split choices for bare multi-project input and never silently divides credit', () => {
    const result = quickEntry('frm & chp', 'log', previous, '12:00');
    expect(result.diagnostics.length).toBeGreaterThan(0); expect(result.splits[0]!.input).toBe('20-20/40 frm & chp');
    expect(quickEntry(result.splits[0]!.input, 'log', previous, '12:00').diagnostics).toEqual([]);
  });
  it('guards both generated endpoints and empty-plan baseline eligibility against source races', () => {
    const day = parseDay('### morning\n- [x] 09:30 (n/a) : awake\nKeep prose.\n', '2012-01-01.md');
    const result = quickEntry('50 frm', 'plan', day.entries[0], '12:00');
    const change = guardElapsedAnchor(day, insertRows(day, result.rows, day.entries[0]), day.entries[0]);
    expect(() => rebase(change, day.text.replace('09:30', '09:40'))).toThrow();
    const empty = parseDay('### morning\nKeep prose.\n', '2012-01-02.md');
    const baseline = quickEntry('frm', 'plan', undefined, '12:00', undefined, { allowBaseline: true });
    const guarded = guardElapsedAnchor(empty, insertRows(empty, baseline.rows, undefined), undefined);
    expect(() => rebase(guarded, empty.text + '- [ ] ?\n')).toThrow();
    expect(applyPatches(empty.text, guarded.patches)).toContain('04:45 (n/a) : awake');
  });
});
describe('entry defaults validation', () => {
  it.each([
    { defaultBlockMinutes: 0 }, { defaultBlockMinutes: 1440 }, { defaultBlockMinutes: 1.5 },
    { defaultStartTime: '25:00' }, { defaultStartTime: '24:00' }, { defaultStartActivity: '' }, { defaultStartActivity: 'a\nb' }
  ])('rejects invalid changes without losing defaults: %j', change => {
    expect(() => validateEntryDefaults({ ...ENTRY_DEFAULTS, ...change })).toThrow();
    expect(normalizeEntryDefaults(change)).toEqual(ENTRY_DEFAULTS);
  });
});
