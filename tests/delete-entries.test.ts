import { describe, expect, it } from 'vitest';
import { applyPatches, deleteEntries, footerPatches, rebase } from '../src/core/changes';
import { calculate, parseDay } from '../src/core/reader';
import { Journal } from '../src/storage/journal';

describe('delete selected activities together', () => {
  it.each(['\n', '\r\n'])('removes selected rows across headings while preserving other source bytes with %j', eol => {
    const raw = [
      '## plan for 21.10.26', '### morning', '- [x] 09:00 (n/a) : awake',
      '- [x] 09:30 (30) : chp', 'Keep **this annotation**.', '- [ ] 10:00 (30) : mdr',
      '### afternoon', '- [x] 14:00 (60) : hay', '- [ ] 14:30 (30) : meal',
      '---', 'CHP = 30', 'HAY = 60', 'SUM = 90', '[^1]: Personal reference.', ''
    ].join(eol);
    const day = parseDay(raw), selected = [day.entries[1]!, day.entries[2]!, day.entries[3]!];
    const change = deleteEntries(day, selected), next = applyPatches(raw, change.patches);
    expect(change.label).toBe('Delete 3 activities');
    expect(next).toBe([
      '## plan for 21.10.26', '### morning', '- [x] 09:00 (n/a) : awake',
      'Keep **this annotation**.', '### afternoon', '- [ ] 14:30 (30) : meal',
      '---', 'CHP = 30', 'HAY = 60', 'SUM = 90', '[^1]: Personal reference.', ''
    ].join(eol));
    const result = applyPatches(next, footerPatches(parseDay(next)));
    expect(result).toContain(`CHP = 0${eol}HAY = 0${eol}SUM = 0`);
    expect(calculate(parseDay(result)).sum).toBe(0);
  });
  it('deduplicates a selection and deletes only selected occurrences of identical rows', () => {
    const raw = '### morning\n- [ ] 10:00 (30) : chp\nKeep me\n- [ ] 10:00 (30) : chp\n';
    const day = parseDay(raw);
    expect(applyPatches(raw, deleteEntries(day, [day.entries[1]!, day.entries[1]!]).patches))
      .toBe('### morning\n- [ ] 10:00 (30) : chp\nKeep me\n');
  });
  it('preserves headings, fenced examples and annotations when deleting all actual activities', () => {
    const raw = '### morning\n- [ ] 10:00 (30) : chp\n```md\n- [x] 11:00 (99) : hay\n```\n### afternoon\nA note\n- [ ] ?';
    const day = parseDay(raw);
    const after = applyPatches(raw, deleteEntries(day, day.entries).patches);
    expect(after).toBe('### morning\n```md\n- [x] 11:00 (99) : hay\n```\n### afternoon\nA note\n');
    expect(parseDay(after).entries).toHaveLength(0);
  });
  it('rejects empty, stale or historical selections', () => {
    const day = parseDay('- [ ] 10:00 (30) : chp');
    expect(() => deleteEntries(day, [])).toThrow('at least one');
    expect(() => deleteEntries(day, parseDay(day.text).entries)).toThrow('no longer match');
    const old = parseDay('- [x] 09:00 - 10:00 : chp\nTotal CHP Time: 1h');
    expect(() => deleteEntries(old, old.entries)).toThrow('read-only');
  });
  it('allows an unrelated distant edit to rebase while rejecting changes to a selected row', () => {
    const raw = 'intro\n' + 'padding '.repeat(20) + '\n- [ ] 10:00 (30) : chp\n- [ ] 11:00 (60) : mdr\n';
    const day = parseDay(raw), change = deleteEntries(day, day.entries);
    const unrelated = raw.replace('intro', 'My new introduction');
    expect(applyPatches(unrelated, rebase(change, unrelated))).toContain('My new introduction');
    expect(() => rebase(change, raw.replace('(60) : mdr', '(45) : mdr'))).toThrow('changed elsewhere');
  });
  it('checks every selected target before creating any recovery record or deleting a row', async () => {
    const raw = '- [ ] 10:00 (30) : chp\n- [ ] 11:00 (60) : mdr\n';
    const day = parseDay(raw, '2026-10-21.md'), change = deleteEntries(day, day.entries);
    let current = raw.replace('mdr', 'hay'), writes = 0, snapshots = 0;
    const journal = new Journal({
      read: async () => current,
      replace: async (_path, _expected, text) => { current = text; writes++; },
      removeCreated: async () => { throw new Error('Do not remove notes'); }
    }, async () => { snapshots++; });
    await expect(journal.perform([change], change.label)).rejects.toThrow('changed elsewhere');
    expect(current).toContain('chp'); expect(current).toContain('hay');
    expect(writes).toBe(0); expect(snapshots).toBe(0);
  });
});
