import { describe, expect, it } from 'vitest';
import { makeDay } from '../src/core/changes';
import { activityGroup } from '../src/core/model';
import { ORDINARY_DAY, ORDINARY_DAY_NOTE } from '../src/core/ordinary-day';
import { calculate, parseDay } from '../src/core/reader';

describe('the offered ordinary day (0.3.2)', () => {
  it('is written as a fenced routine note that makes the same day', () => {
    expect(ORDINARY_DAY_NOTE.startsWith('```\n## plan for')).toBe(true);
    expect(ORDINARY_DAY_NOTE.endsWith('SUM = 0\n```\n')).toBe(true);
    expect(makeDay('2026-11-19', ORDINARY_DAY_NOTE)).toBe(makeDay('2026-11-19', ORDINARY_DAY));
  });
  it('becomes a dated, fully planned day with no warnings', () => {
    const text = makeDay('2026-11-19', ORDINARY_DAY);
    expect(text.split('\n')[0]).toBe('## plan for 19 nov 26');
    const day = parseDay(text, '2026-11-19.md');
    expect(day.entries.every(entry => !entry.checked)).toBe(true);
    expect(day.entries.map(entry => entry.label)).toContain('iwbs (wash & meditate)');
    expect(day.diagnostics).toEqual([]);
    expect(calculate(day)).toMatchObject({ sum: 0, complete: true });
    expect(text.trimEnd().endsWith('SUM = 0')).toBe(true);
  });
  it('keeps an & inside a description as one activity', () => {
    const group = activityGroup('iwbs (wash & meditate)');
    expect(group.units.map(unit => unit.name)).toEqual(['iwbs']);
    expect(group.issues).toEqual([]);
    const done = parseDay('- [x] 05:00 (n/a) : awake\n- [x] 05:18 (18) : iwbs (wash & meditate)\nSUM = 0\n', 'd.md');
    expect(done.diagnostics).toEqual([]);
  });
});
