import { describe, expect, it } from 'vitest';
import { headingDate, isPlannerDay, planHeading } from '../src/core/syntax';
import { chooseDay, folderCounts } from '../src/core/day-choice';
import { adoptDay, makeDay } from '../src/core/changes';
import { parseDay } from '../src/core/reader';
import { migrateDaily } from '../src/core/syntax-migration';

describe('plan heading 5 oct 26', () => {
  it('writes the day without a leading zero, a lowercase month and a two-digit year', () => {
    expect(planHeading('2026-10-05')).toBe('## plan for 5 oct 26');
    expect(planHeading('2025-06-23')).toBe('## plan for 23 jun 25');
    expect(makeDay('2026-10-05').split('\n')[0]).toBe('## plan for 5 oct 26');
  });
  it('reads the date a heading names, in either form', () => {
    expect(headingDate('## plan for 5 oct 26')).toBe('2026-10-05');
    expect(headingDate('## plan for 05.10.26')).toBe('2026-10-05');
    expect(headingDate('## plan for ?? ??? 26')).toBeNull();
  });
  it('reports a retired or mismatched heading without blocking the day', () => {
    const retired = parseDay('## plan for 05.10.26\n- [x] 09:00 (30) : chp\nCHP = 30\nSUM = 30\n', '2026-10-05.md');
    expect(retired.diagnostics.find(d => d.code === 'retired-syntax')).toMatchObject({ message: 'Write this heading as ## plan for 5 oct 26.', blocks: false });
    const other = parseDay('## plan for 6 oct 26\nSUM = 0\n', '2026-10-05.md');
    expect(other.diagnostics.find(d => d.code === 'heading-date')?.blocks).toBe(false);
    expect(parseDay('## plan for 5 oct 26\nSUM = 0\n', '2026-10-05.md').diagnostics).toEqual([]);
  });
});

describe('a planner day is a plan heading with a SUM total', () => {
  it('recognises plans and recorded-totals days, whatever their formatting', () => {
    expect(isPlannerDay('## plan for 5 oct 26\n\n### morning\n\n---\n\nSUM = 0\n')).toBe(true);
    expect(isPlannerDay('## recorded totals\r\n\r\nCHP = 30\r\n**SUM = 30**\r\n')).toBe(true);
    expect(isPlannerDay('﻿## plan for 05.10.26\nSUM = 30[^1]\n')).toBe(true);
  });
  it('ignores journals, a heading without SUM, SUM without a heading, and fenced examples', () => {
    expect(isPlannerDay('# Tuesday\nWrote three pages. SUM = 30 felt good.\n')).toBe(false);
    expect(isPlannerDay('## plan for 5 oct 26\n- [ ] 09:00 (30) : chp\n')).toBe(false);
    expect(isPlannerDay('- [x] 09:00 (30) : chp\nSUM = 30\n')).toBe(false);
    expect(isPlannerDay('Example:\n```\n## plan for 5 oct 26\nSUM = 0\n```\n')).toBe(false);
  });
});

describe('two plans for one date', () => {
  const all = ['Ω 2026/2026-10/2026-10-01.md', 'Ω 2026/2026-10/2026-10-02.md', 'notes/2026-10-03.md', 'Ω 2026/2026-10/2026-10-03.md'].map(path => ({ path }));
  it('counts the one in the folder with the most plans and names the others', () => {
    const { chosen, others } = chooseDay([all[2]!, all[3]!], folderCounts(all));
    expect(chosen.path).toBe('Ω 2026/2026-10/2026-10-03.md');
    expect(others.map(d => d.path)).toEqual(['notes/2026-10-03.md']);
  });
  it('breaks ties by the shorter path, then alphabetically', () => {
    expect(chooseDay([{ path: 'b/2026-10-03.md' }, { path: '2026-10-03.md' }], new Map()).chosen.path).toBe('2026-10-03.md');
    expect(chooseDay([{ path: 'b/2026-10-03.md' }, { path: 'a/2026-10-03.md' }], new Map()).chosen.path).toBe('a/2026-10-03.md');
  });
});

describe('adding the plan to a note that holds the name', () => {
  it('puts the plan on top and keeps every byte of the note below it', () => {
    const journal = '﻿Wrote three pages.\r\nKeep this.\r\n';
    const adopted = adoptDay(journal, '2026-10-05');
    expect(adopted.startsWith('﻿## plan for 5 oct 26\r\n')).toBe(true);
    expect(adopted.endsWith('\r\n' + journal.slice(1))).toBe(true);
    expect(isPlannerDay(adopted)).toBe(true);
    expect(adopted.replace(/\r\n/g, '\n')).toContain('SUM = 0\n\nWrote three pages.');
  });
});

describe('heading migration', () => {
  it('rewrites dated and template headings and refuses a heading naming another date', () => {
    const day = migrateDaily('## plan for 05.10.26\n- [x] 09:00 (30) : chp\n\nCHP = 30\nSUM = 30\n', '2026-10-05.md', ['CHP']);
    expect(day.text.split('\n')[0]).toBe('## plan for 5 oct 26'); expect(day.issues).toEqual([]);
    const template = migrateDaily('```\n## plan for ??.??.26\nSUM = 0\n```\n', '_Codes/routine.md', ['CHP']);
    expect(template.text).toContain('## plan for ?? ??? 26');
    expect(migrateDaily('## plan for DD.MM.YY\nSUM = 0\n', '_Codes/r.md', []).text).toContain('## plan for D mon YY');
    expect(migrateDaily('## plan for 06.10.26\nSUM = 0\n', '2026-10-05.md', []).issues[0]).toContain('names 2026-10-06');
  });
});
