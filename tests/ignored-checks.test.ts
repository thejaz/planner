import { describe, expect, it } from 'vitest';
import { activeIgnores, checkKey, groupChecks, keyFor, visibleChecks } from '../src/core/ignored-checks';
import { parseDay } from '../src/core/reader';

const text = '## plan for x\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 10:00 (70/60) : prj\n- [x] 11:00 (90/60) : prj\n- [x] 11:30 (30) : prj\n';
const day = () => parseDay(text, '2026-07-29.md', ['PRJ']);

describe('ignored note checks', () => {
  it('groups repeated checks once, with every line in note order', () => {
    const groups = groupChecks(day().diagnostics);
    const over = groups.find(group => group.code === 'credit-exceeds-elapsed')!;
    expect(over.checks.map(check => check.line)).toEqual([3, 4]);
    expect(groups.filter(group => group.code === 'credit-exceeds-elapsed')).toHaveLength(1);
  });
  it('hides an ignored row only while it is written the same way', () => {
    const d = day(), over = d.diagnostics.filter(check => check.code === 'credit-exceeds-elapsed');
    const ignored = new Set([keyFor(d, over[0]!)]);
    expect(visibleChecks(d, ignored).filter(check => check.code === 'credit-exceeds-elapsed').map(check => check.line)).toEqual([4]);
    // Editing that row brings its check back.
    const edited = parseDay(text.replace('(70/60)', '(75/60)'), '2026-07-29.md', ['PRJ']);
    expect(visibleChecks(edited, ignored).filter(check => check.code === 'credit-exceeds-elapsed')).toHaveLength(2);
    // Another note with the same row text is not affected.
    const other = parseDay(text, '2026-07-30.md', ['PRJ']);
    expect(visibleChecks(other, ignored).filter(check => check.code === 'credit-exceeds-elapsed')).toHaveLength(2);
  });
  it('never hides checks that block totals', () => {
    const blocking = parseDay('## plan for x\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 10:00 (?) : prj\n', 'd.md', ['PRJ']);
    const check = blocking.diagnostics.find(item => item.blocks)!;
    expect(check).toBeDefined();
    expect(visibleChecks(blocking, new Set([keyFor(blocking, check)]))).toContain(check);
  });
  it('keys ignore surrounding spaces but not the row text', () => {
    expect(checkKey('a.md', 'x', ' row ')).toBe(checkKey('a.md', 'x', 'row'));
    expect(checkKey('a.md', 'x', 'row')).not.toBe(checkKey('a.md', 'x', 'row 2'));
  });
});

describe('what can be ignored (review fix)', () => {
  it('offers ignore only for advisory checks, never for disputed totals', () => {
    const disputed = parseDay('## plan for x\n### morning\n- [x] 09:00 (n/a) : awake\n- [x] 10:00 (60) : prj\n\n---\n\nPRJ = 90\nSUM = 90\n', 'd.md', ['PRJ']);
    const conflict = disputed.diagnostics.find(check => check.code === 'total-conflict')!;
    expect(conflict.blocks).toBe(false);
    expect(visibleChecks(disputed, new Set([keyFor(disputed, conflict)]))).toContain(conflict);
    const d = day(), over = d.diagnostics.find(check => check.code === 'credit-exceeds-elapsed')!;
    expect(visibleChecks(d, new Set([keyFor(d, over)]))).not.toContain(over);
  });
  it('counts only ignores that still match a row', () => {
    const d = day(), keys = d.diagnostics.filter(check => check.code === 'credit-exceeds-elapsed').map(check => keyFor(d, check));
    const edited = parseDay(text.replace('(70/60)', '(75/60)'), '2026-07-29.md', ['PRJ']);
    expect(activeIgnores([edited], new Set(keys)).size).toBe(1);
    expect(activeIgnores([d], new Set(keys)).size).toBe(2);
  });
});
