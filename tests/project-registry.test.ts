import { describe, expect, it } from 'vitest';
import { codesFromParsed, discoverProjectCodes, isRoutineSummary, missingProjectChanges, normalizedCodes, projectValue, summaryForDate } from '../src/core/project-registry';
import { parseDay } from '../src/core/reader';
import { parseSummary } from '../src/core/history';
import { applyPatches } from '../src/core/changes';
const summary = (path: string, start: string, end: string, rows = '') => parseSummary(`### Days\n### Projects\n${rows}### Results\nDays (${start} - ${end}): 1d\n`, path);
describe('shared project declarations', () => {
  const documents = [
    { path: '2020-01-01.md', text: 'XYZ = 10\nZRO = 0\nSUM = 10\n- [x] 09:00 (10) : ordinary\n' },
    { path: 'thejaz-summary-now.md', text: '### Projects\n🌱 ABC = 0\nSUM = 9\n' },
    { path: '_Codes/2020-01-02.md', text: 'BAD = 999\nSUM = 999\n' },
    { path: '_Codes/_archive/thejaz-summary-template.md', text: '### Projects\nBAD2 = 9\n' }
  ];
  it('finds the same codes from already parsed notes as from their text', () => {
    // The index never holds templates, so only the day and the current summary are passed.
    const parsed = codesFromParsed([parseDay(documents[0]!.text, documents[0]!.path)], [parseSummary(documents[1]!.text, documents[1]!.path)], ['saved', 'sum', ' bad code ']);
    expect(parsed).toEqual(discoverProjectCodes(documents, ['saved', 'sum', ' bad code '], '_Codes', 'thejaz-summary-now.md'));
  });
  it.each([{ docs: documents }, { docs: [...documents].reverse() }])('accepts three authorities without templates, zero-only footers or ordinary words', ({ docs }) => {
    expect(discoverProjectCodes(docs, ['saved', 'sum', ' bad code '], '_Codes', 'thejaz-summary-now.md').sort()).toEqual(['ABC', 'SAVED', 'XYZ']);
  });
  it('treats dated summaries in the routines folder as summaries and undated summary templates as templates', () => {
    const dated = { path: '_Codes/THEJAZ-SUMMARY-extra.MD', text: '### Days\n2011-01-01 = 15\n### Projects\nDEF = 15\nDays (2011-01-01 - 2011-01-01): 1d\n' };
    const isoDated = { path: '_Codes/2012-01-01--2012-12-31-thejaz-summary.md', text: '### Projects\nISO = 1\n' };
    const template = { path: '_Codes/_archive/thejaz-summary-template.md', text: '### Projects\nBAD2 = 9\nDays (DD.MM.YY - DD.MM.YY): 0d\n' };
    expect(isRoutineSummary(dated.path, dated.text)).toBe(true);
    expect(isRoutineSummary(isoDated.path, isoDated.text)).toBe(true);
    expect(isRoutineSummary(template.path, template.text)).toBe(false);
    expect(isRoutineSummary('_Codes/🌞 today is.md', dated.text)).toBe(false);
    expect(discoverProjectCodes([...documents, dated, isoDated, template], [], '_Codes', 'thejaz-summary-now.md').sort()).toEqual(['ABC', 'DEF', 'ISO', 'XYZ']);
  });
  it('keeps remembered codes after the final source definition is removed', () => {
    const codes = discoverProjectCodes(documents, [], '_Codes', 'thejaz-summary-now.md');
    expect(discoverProjectCodes([], codes, '_Codes', 'thejaz-summary-now.md')).toEqual(codes);
    expect(normalizedCodes(['xyz', ' XYZ ', 'SUM', '-bad', 'x9'])).toEqual(['XYZ', 'X9']);
  });
  it('zero footers are still local parsing context', () => {
    const text = '- [x] 09:00 (10) : xyz\nXYZ = 0\nSUM = 0\n';
    expect(discoverProjectCodes([{ path: '2020-01-01.md', text }], [], '_Codes', '')).toEqual([]);
    expect(parseDay(text, '2020-01-01.md', []).entries[0]!.credits).toEqual({ XYZ: 10 });
  });
});
describe('period-specific project definitions', () => {
  const old = summary('archive/thejaz-summary-2020.md', '01.01.20', '31.12.20');
  const current = summary('thejaz-summary-now.md', '01.01.21', '31.12.21');
  const days = [parseDay('## recorded totals\nXYZ = 10\nSUM = 10\n', '2020-01-01.md', []), parseDay('## recorded totals\nXYZ = 20\nSUM = 20\n', '2020-02-01.md', [])];
  it('adds exactly one project to its owning period with all period credit', () => {
    const result = missingProjectChanges(days, [old, current], '2021-10-01');
    expect(result.issues).toEqual([]); expect(result.changes).toHaveLength(1);
    const change = result.changes[0]!; expect(change.path).toBe(old.path);
    const after = applyPatches(change.base, change.patches); expect(after).toContain('🌱 XYZ = 30');
    expect(after.replace('🌱 XYZ = 30\n', '')).toBe(old.text);
    expect(missingProjectChanges(days, [parseSummary(after, old.path), current], '2021-10-01').changes).toEqual([]);
  });
  it('routes inclusive boundaries and ISO fallback periods', () => {
    const filename = parseSummary('### Projects\n', '2022-01-01--2022-12-31-thejaz-summary.md');
    expect(summaryForDate('2020-12-31', [old, current])).toBe(old);
    expect(summaryForDate('2021-01-01', [old, current])).toBe(current);
    expect(summaryForDate('2022-12-31', [filename])).toBe(filename);
    expect(() => summaryForDate('2023-01-01', [old, current])).toThrow('no summary covers');
    expect(() => summaryForDate('2020-01-01', [old, old])).toThrow('more than one summary covers');
  });
  it('reports period ambiguity and does not touch another period', () => {
    const result = missingProjectChanges(days, [old, old, current], '2021-10-01');
    expect(result.changes).toEqual([]); expect(result.issues[0]).toContain('more than one summary covers');
  });
  it('preserves existing amounts, even disputed ones', () => {
    const source = parseSummary(old.text.replace('### Projects\n', '### Projects\n🦉 XYZ = 999\n'), old.path);
    expect(missingProjectChanges(days, [source], '2021-10-01').changes).toEqual([]);
  });
  it('does not register or propagate zero daily figures or future work', () => {
    expect(missingProjectChanges([parseDay('NEW = 0\nSUM = 0\n', '2020-01-01.md', [])], [old], '2021-01-01').changes).toEqual([]);
    expect(missingProjectChanges(days, [old], '2019-12-31').changes).toEqual([]);
  });
  it('blocks duplicate dates and unknown completed credit, without inventing a value', () => {
    expect(() => projectValue([...days, days[0]!], old, 'XYZ', '2021-01-01')).toThrow('more than one note for this date');
    expect(() => projectValue([parseDay('- [x] ?\n', '2020-01-01.md', [])], old, 'XYZ', '2021-01-01')).toThrow('has no minutes for its project');
  });
});
