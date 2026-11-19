import { describe, expect, it } from 'vitest';
import { compactEdit, quickEntry } from '../src/core/changes';
import { applyPatches } from '../src/core/changes';
import { parseDay } from '../src/core/reader';

const text = '## plan for 19 nov 26\n### morning\n- [ ] 09:00 (10) : setup\n- [ ] 10:00 (5) : break\n\n---\n\nSUM = 0\n';
const day = parseDay(text, '2026-11-19.md');
const [setup, pause] = day.entries;
const fill = (input: string, previous = setup, following = pause) => quickEntry(input, 'plan', previous, '12:00', [], { following });

describe('fill', () => {
  it('ends where the next activity starts and takes the gap as its minutes', () => {
    for (const input of ['fill : task', 'fill: task', 'FILL : task', 'fill; ; task'])
      expect(fill(input), input).toMatchObject({ rows: ['- [ ] 09:55 (55) : task'], diagnostics: [] });
    expect(fill('fill').rows).toEqual(['- [ ] 09:55 (55) : activity']);
  });
  it('keeps explicit credit and elapsed shortcuts', () => {
    expect(fill('fill 30/ task').rows).toEqual(['- [ ] 09:55 (30/55) : task']);
    expect(quickEntry('fill : task', 'log', setup, '12:00', [], { following: pause }).rows).toEqual(['- [x] 09:55 (55) : task']);
  });
  it('explains when there is nothing to fill or no neighbor to measure from', () => {
    expect(quickEntry('fill : task', 'plan', pause, '12:00', [], {}).diagnostics.join()).toMatch(/activity after it/);
    expect(quickEntry('fill : task', 'plan', undefined, '12:00', [], { following: pause }).diagnostics.join()).toMatch(/known end time before it/);
    const tight = parseDay('- [ ] 09:00 (10) : a\n- [ ] 09:10 (10) : b\n', 'x.md');
    expect(fill('fill : task', tight.entries[0], tight.entries[1]).diagnostics.join()).toMatch(/no gap to fill/);
    const open = parseDay('- [ ] 09:00 (10) : a\n- [ ] 09:30 (n/a) : b\n', 'x.md');
    expect(fill('fill : task', open.entries[0], open.entries[1]).diagnostics.join()).toMatch(/end time and minutes/);
    expect(fill('fill : task\nlunch').diagnostics.join()).toMatch(/last line only/);
  });
  it('is not mistaken for an activity named fill', () => {
    expect(fill('filler task').rows[0]).not.toContain('09:55');
    // A word after fill without a colon is an activity name, not the keyword.
    for (const input of ['fill water bottles', 'fill task', '10:30 fill tank'])
      expect(fill(input).rows[0], input).not.toContain('09:55');
    expect(fill('fill water bottles').rows[0]).toContain(': fill water bottles');
  });
  it('works in Edit, filling up to the row after the edited one', () => {
    const t = '## plan for x\n### morning\n- [ ] 09:00 (10) : setup\n- [ ] 09:20 (20) : task\n- [ ] 10:00 (5) : break\n';
    const d = parseDay(t, '2026-11-19.md'), result = compactEdit(d, d.entries[1]!, 'fill : task', '12:00', [], { following: d.entries[2] });
    expect(applyPatches(t, result.change.patches)).toContain('- [ ] 09:55 (55) : task');
  });
});

describe('fill written into a note', () => {
  const t = '## plan for x\n### morning\n- [ ] 09:00 (10) : setup\n- [ ] fill : task\n- [ ] 10:00 (5) : break\nSUM = 0\n';
  it('is a note check, not an unknown activity, and resolves like Edit', () => {
    const d = parseDay(t, '2026-11-19.md'), row = d.entries[1]!;
    expect(d.diagnostics.map(x => x.code)).toEqual(['fill-row']);
    const { change } = compactEdit(d, row, row.label, '12:00', [], { durationTouched: true, following: d.entries[2] });
    expect(applyPatches(t, change.patches)).toContain('- [ ] 09:55 (55) : task\n');
  });
});
