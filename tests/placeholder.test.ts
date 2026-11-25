import { describe, expect, it } from 'vitest';
import { fillTarget, measureFrom, quickEntry } from '../src/core/changes';
import { parseDay } from '../src/core/reader';

// 0.3.11: a `...` row is a placeholder, not elapsed time; rows added or edited after it
// measure from the last known end time, and fill looks past it in both directions.
const day = parseDay('## plan for 19 nov 26\n### evening\n- [x] 20:21 (20) : tea\n- [ ] ...\n- [ ] 22:30 (60) : reading\nSUM = 0\n', '2026-11-19.md', ['PRJ']);
const [tea, gap, reading] = day.entries;

describe('a ... placeholder', () => {
  it('is looked past to the last known end time, and to the next activity for fill', () => {
    expect(measureFrom(day.entries, 1)).toEqual({ previous: tea, bridged: true });
    expect(measureFrom(day.entries, 0)).toEqual({ previous: tea, bridged: false });
    expect(fillTarget(day.entries, 1)).toBe(reading);
    expect(fillTarget(day.entries, 2)).toBe(reading);
    expect(gap!.label).toBe('...');
  });
  it('lets fill, now and an end time count from the row before it', () => {
    expect(quickEntry('fill prj', 'plan', tea, '23:00', ['PRJ'], { following: reading, bridged: true }).rows).toEqual(['- [ ] 21:30 (69) : prj']);
    expect(quickEntry('21:00 prj', 'log', tea, '23:00', ['PRJ'], { bridged: true }).rows).toEqual(['- [x] 21:00 (39) : prj']);
    expect(quickEntry('now prj', 'log', tea, '20:50', ['PRJ'], { bridged: true }).rows).toEqual(['- [x] 20:50 (29) : prj']);
  });
  it('starts afresh (n/a) instead of reading an earlier end time as a backward step', () => {
    expect(quickEntry('10:00 walk', 'plan', tea, '23:00', [], { bridged: true })).toMatchObject({ rows: ['- [ ] 10:00 (n/a) : walk'], diagnostics: [] });
    expect(quickEntry('10:00 walk', 'plan', tea, '23:00', []).diagnostics.join()).toMatch(/backward/);
  });
  it('is looked past when typed in the same entry', () => {
    for (const gapLine of ['...', '?'])
      expect(quickEntry(`${gapLine}\n21:00 prj`, 'log', tea, '23:00', ['PRJ']).rows).toEqual(['- [ ] ...', '- [x] 21:00 (39) : prj']);
  });
  it('is not looked past at a restart or an unknown end time', () => {
    const restart = parseDay('- [x] 20:21 (20) : tea\n- [ ] 21:00 (n/a) : >\n- [ ] ...\n', 'x.md');
    expect(measureFrom(restart.entries, 2).previous?.time).toBe('21:00');
    const unknown = parseDay('- [x] 20:21 (20) : tea\n- [x] ? (30) : walk\n- [ ] ...\n', 'x.md');
    expect(measureFrom(unknown.entries, 2).previous?.label).toBe('walk');
    expect(quickEntry('21:00 prj', 'log', unknown.entries[1], '23:00', ['PRJ'], { bridged: true }).rows).toEqual(['- [x] 21:00 (n/a) : prj']);
  });
});
