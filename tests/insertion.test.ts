import { expect, it } from 'vitest';
import { applyPatches, insertRows } from '../src/core/changes';
import { parseDay } from '../src/core/reader';

it.each(['\n', '\r\n'])('inserts multiple activities without replacing selected plans or completed rows (%j)', eol => {
  for (const checked of [' ', 'x']) {
    const original = [`### morning`, `- [${checked}] 09:00 (30) : prj`, 'Keep this annotation.',
      '- [ ] 10:00 (60) : later', '### afternoon', 'PRJ = 30', 'SUM = 30', ''].join(eol);
    const day = parseDay(original, '2026-10-26.md', ['PRJ']);
    const change = insertRows(day, ['- [ ] 09:15 (15) : first', '- [x] 09:30 (15) : second'], day.entries[0]);
    const after = applyPatches(original, change.patches), parsed = parseDay(after, day.path, ['PRJ']);
    expect(parsed.entries.map(entry => entry.label)).toEqual(['prj', 'first', 'second', 'later']);
    expect(parsed.entries[0]?.raw).toBe(day.entries[0]?.raw);
    expect(parsed.entries[3]?.raw).toBe(day.entries[1]?.raw);
    expect(after).toContain(`Keep this annotation.${eol}- [ ] 10:00 (60) : later`);
    expect(after).toContain(`PRJ = 30${eol}SUM = 30`);
  }
});
