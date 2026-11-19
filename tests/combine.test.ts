import { describe, expect, it } from 'vitest';
import { applyPatches } from '../src/core/changes';
import { combineEntries } from '../src/core/combine';
import { calculate, parseDay } from '../src/core/reader';

const codes = ['NVE', 'ORG', 'PRJ'];
const note = (rows: string) => `## plan for 19 nov 26\n### morning\n${rows}\n\n---\n\nNVE = 0\nORG = 0\nSUM = 0\n`;
const combined = (text: string, from: number, to: number) => {
  const day = parseDay(text, '2026-11-19.md', codes), result = combineEntries(day, day.entries.slice(from, to + 1), codes);
  return { day, result, after: parseDay(applyPatches(text, result.change.patches), '2026-11-19.md', codes) };
};

describe('combine activities', () => {
  const text = note('- [x] 08:18 (5) : setup\n- [x] 08:24 (6) : nve\n- [x] 08:26 (2) : org\n- [x] 08:28 (2) : nve\n- [x] 08:29 (1) : org\n- [x] 08:32 (3) : nve\n- [ ] ...');
  it('joins repeated activities into one row per name, ending at the last row', () => {
    const { result, day, after } = combined(text, 1, 5);
    expect(result.row).toBe('- [x] 08:32 (11-3) : nve & org');
    expect(after.entries.map(e => e.raw)).toEqual(['- [x] 08:18 (5) : setup', '- [x] 08:32 (11-3) : nve & org', '- [ ] ...']);
    expect(calculate(after)).toMatchObject({ sum: calculate(day).sum, projects: calculate(day).projects });
  });
  it('keeps elapsed time when it differs from credit, and one name stays one amount', () => {
    const t = note('- [x] 09:00 (n/a) : awake\n- [x] 09:30 (20/30) : prj (draft)\n- [x] 10:00 (30) : prj');
    expect(combined(t, 1, 2).result.row).toBe('- [x] 10:00 (50/60) : prj (draft)');
  });
  it('maps split rows by name and keeps ordinary activities in place', () => {
    const t = note('- [ ] 09:30 (20-10) : nve & lunch\n- [ ] 10:00 (30) : lunch\n- [ ] 10:10 (10) : org');
    expect(combined(t, 0, 2).result.row).toBe('- [ ] 10:10 (20-40-10) : nve & lunch & org');
  });
  it('refuses selections it cannot merge exactly', () => {
    const t = note('- [x] 08:00 (n/a) : awake\n- [x] 08:10 (10) : nve\n- [ ] 08:20 (10) : org\n- [ ] ...\n- [ ] 09:00 (10) : org\n- [ ] 09:10 (10-5-5) : nve & org');
    const day = parseDay(t, '2026-11-19.md', codes), e = day.entries;
    expect(() => combineEntries(day, [e[1]!], codes)).toThrow(/two or more/);
    expect(() => combineEntries(day, [e[1]!, e[2]!], codes)).toThrow(/all selected activities completed, or all planned/);
    expect(() => combineEntries(day, [e[0]!, e[1]!], codes)).toThrow(/written minutes/);
    expect(() => combineEntries(day, [e[2]!, e[4]!], codes)).toThrow(/next to each other/);
    expect(() => combineEntries(day, [e[4]!, e[5]!], codes)).toThrow(/one amount per activity/);
  });
});

describe('combine keeps descriptions (review fix)', () => {
  it('keeps a distinct shorter description and includes an exact repeat only once', () => {
    const t = note('- [x] 09:10 (10) : prj drafting\n- [x] 09:20 (10) : prj draft\n- [x] 09:30 (10) : prj draft');
    expect(combined(t, 0, 2).result.row).toBe('- [x] 09:30 (30) : prj drafting draft');
  });
  it('merges same-name rows and keeps each distinct description', () => {
    const t = note('- [x] 09:00 (n/a) : awake\n- [x] 09:20 (20) : std (chapter 3)\n- [x] 09:50 (30) : std (chapter 4)\n- [x] 10:00 (10) : std');
    expect(combined(t, 1, 3).result.row).toBe('- [x] 10:00 (60) : std (chapter 3) (chapter 4)');
  });
});

describe('combine with one amount on a group (0.3.0)', () => {
  it('reads one amount as crediting the first activity, like the note does', () => {
    const t = note('- [x] 09:00 (n/a) : awake\n- [x] 09:30 (30) : breakfast & news\n- [x] 10:00 (30) : breakfast');
    expect(combined(t, 1, 2).result.row).toBe('- [x] 10:00 (60-0) : breakfast & news');
  });
});
