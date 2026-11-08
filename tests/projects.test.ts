import { describe, expect, it } from 'vitest';
import { newProjectPatch, projectCode, projectLabelParts } from '../src/core/projects';
import { calculate, parseDay } from '../src/core/reader';
import { parseSummary, sortedProjectPatches, summaryPatches } from '../src/core/history';
import { applyPatches } from '../src/core/changes';

describe('project-label recognition', () => {
  it('recognizes footer-defined codes without requiring a duplicate setting', () => {
    const text = '- [x] 15:00 (170-40-20/315) : chp & mdr & pln\nCHP = 170\nMDR = 40\nPLN = 20\nSUM = 230\n';
    const day = parseDay(text, '', ['CHP', 'MDR']);
    const label = projectLabelParts(day.entries[0]!, ['CHP', 'MDR', ...Object.keys(day.recorded)]);
    expect(label.parts.filter(p => p.known).map(p => p.code)).toEqual(['CHP', 'MDR', 'PLN']);
    expect(label.unknown).toEqual([]);
    expect(calculate(day).projects).toEqual({ CHP: 170, MDR: 40, PLN: 20 });
    expect(day.text).toBe(text);
  });
  it('treats an allocated undefined component as ordinary until registered, without inventing project credit', () => {
    const text = '- [x] 15:00 (170-40-20/315) : chp & mdr & pln\n';
    const day = parseDay(text, '', ['CHP', 'MDR']);
    const label = projectLabelParts(day.entries[0]!, ['CHP', 'MDR']);
    expect(label.parts.filter(p => p.known).map(p => p.code)).toEqual(['CHP', 'MDR']);
    expect(label.unknown).toEqual(['PLN']);
    expect(day.entries[0]!.unknownCredit).toBe(false);
    expect(label.parts.find(p => p.text === 'pln')?.code).toBeNull();
    expect(calculate(day).projects).toEqual({ CHP: 170, MDR: 40 });
    expect(calculate(day).complete).toBe(true);
    const recognized = parseDay(text, '', ['CHP', 'MDR', 'PLN']);
    expect(calculate(recognized).projects).toEqual({ CHP: 170, MDR: 40, PLN: 20 });
    expect(recognized.text).toBe(text);
  });
  it.each(['ChP & mDr & PLN (my note)', 'ChP + mDr + PLN (my note)', 'ChP | mDr | PLN (my note)', 'ChP / mDr / PLN (my note)'])('preserves exact notation and matches the reader for %s', label => {
    const result = projectLabelParts({ label, duration: '10-20-30/60' }, ['CHP', 'MDR', 'PLN']);
    expect(result.parts.map(p => p.text).join('')).toBe(label);
    expect(result.parts.filter(p => p.known).map(p => p.text)).toEqual(['ChP', 'mDr', 'PLN']);
    expect(result.unknown).toEqual([]);
  });
  it('keeps ordinary activities and the supported mixed-activity slash as literal text', () => {
    expect(projectLabelParts({ label: 'breakfast', duration: '20' }, ['CHP']).unknown).toEqual([]);
    const result = projectLabelParts({ label: 'chp / breakfast', duration: '20' }, ['CHP']);
    expect(result.parts.filter(p => p.known).map(p => p.code)).toEqual(['CHP']);
    expect(result.unknown).toEqual([]);
    expect(result.parts.map(p => p.text).join('')).toBe('chp / breakfast');
  });
});

describe('new project summary insertion', () => {
  it.each(['\n', '\r\n'])('appends after the final project and preserves all trailing content with %j', eol => {
    const text = ['### Projects', '', '🦉 CHP = 10', '', '---', '', '🌼 PRT = 5', '', '---', '', '### Bookmarks', '', '- CHP = old work', '', '### Results', 'keep exactly'].join(eol);
    const summary = parseSummary(text, 'summary.md');
    const next = applyPatches(text, newProjectPatch(summary, ' abc9 ', '🌱'));
    expect(next).toBe(text.replace('🌼 PRT = 5' + eol, '🌼 PRT = 5' + eol + '🌱 ABC9 = 0' + eol));
    expect(parseSummary(next, '').projects.map(p => p.code)).toEqual(['CHP', 'PRT', 'ABC9']);
    expect(newProjectPatch(parseSummary(next, ''), 'abc9', '🌱')).toEqual([]);
  });
  it.each(['### Projects\nCHP = 0', '## Projects\n\n## Bookmarks\nkeep'])('supports EOF and empty Projects sections: %s', text => {
    const next = applyPatches(text, newProjectPatch(parseSummary(text, ''), 'NEW', '🌱'));
    expect(parseSummary(next, '').projects.some(p => p.code === 'NEW')).toBe(true);
    expect(next.endsWith('keep')).toBe(text.endsWith('keep'));
  });
  it('follows the code after manual reordering and leaves emoji, other totals and Bookmarks intact', () => {
    const text = '### Days (2015-01-01 - 2015-01-01)\n2015-01-01 = 10\n### Projects\n🌱 NEW = 0\nCHP = 0\n## Bookmarks\nNEW = 999\n';
    const day = parseDay('- [x] 09:00 (10) : new\nNEW = 10\nSUM = 10\n', '2015-01-01.md', ['NEW']);
    const summary = parseSummary(text, 'summary.md');
    expect(summary.projects.map(p => p.code)).toEqual(['NEW', 'CHP']);
    const update = summaryPatches(summary, [day], '2015-01-01', new Set(['2015-01-01']), true);
    expect(applyPatches(text, update.patches)).toBe(text.replace('🌱 NEW = 0', '🌱 NEW = 10').replace('2015-01-01 = 10 😣', '==2015-01-01 = 10 😣==').replace('2015-01-01 = 10\n', '==2015-01-01 = 10 😣==\n'));
  });
  it('rejects unsafe/reserved codes, missing sections and duplicate project totals', () => {
    for (const code of ['', 'SUM', 'abc-def', 'ABC\nCHP', '9ABC']) expect(() => projectCode(code)).toThrow();
    expect(() => newProjectPatch(parseSummary('### Bookmarks\nkeep', ''), 'NEW', '🌱')).toThrow('Projects heading');
    expect(() => newProjectPatch(parseSummary('### Projects\nNEW = 0\nNEW = 9', ''), 'NEW', '🌱')).toThrow('More than one');
  });
});

describe('summary project order', () => {
  it.each(['\n', '\r\n'])('sorts literal project lines by recorded time without changing separators/prose using %j', eol => {
    const raw = ['### Projects', '🌱 LOW = 5', '', '---', '🦉 HIGH = 90', '🌻 TIE = 5', '🍀 ZERO = 0', '', '### Bookmarks', 'LOW = keep', ''].join(eol);
    const expected = raw.replace('🌱 LOW = 5', '🦉 HIGH = 90').replace('---' + eol + '🦉 HIGH = 90', '---' + eol + '🌱 LOW = 5');
    const result = applyPatches(raw, sortedProjectPatches(parseSummary(raw, 'summary.md')));
    expect(result).toBe(expected);
    expect(sortedProjectPatches(parseSummary(result, 'summary.md'))).toEqual([]);
  });
  it('orders by updated totals and includes a newly counted project in the right place', () => {
    const raw = '### Projects\n🦉 CHP = 90\n🌍 MDR = 5\n### Bookmarks\nkeep\n';
    const next = applyPatches(raw, sortedProjectPatches(parseSummary(raw, ''), { CHP: 10, MDR: 30, NEW: 50 }));
    expect(next).toBe('### Projects\nNEW = 50\n🌍 MDR = 30\n🦉 CHP = 10\n### Bookmarks\nkeep\n');
  });
  it('retains EOF without a newline when sorting existing rows', () => {
    const raw = '### Projects\nCHP = 10\nMDR = 30';
    expect(applyPatches(raw, sortedProjectPatches(parseSummary(raw, '')))).toBe('### Projects\nMDR = 30\nCHP = 10');
  });
  it('blocks duplicate codes instead of choosing a recorded total', () => {
    expect(() => sortedProjectPatches(parseSummary('### Projects\nCHP = 10\nCHP = 30\n', ''))).toThrow('duplicate');
  });
});
