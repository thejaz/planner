import { describe, expect, it } from 'vitest';
import { activityGroup, canonicalJoiners } from '../src/core/model';
import { calculate, parseDay } from '../src/core/reader';
import { applyPatches, quickEntry } from '../src/core/changes';
import { equalSplit } from '../src/core/entry-math';
import { removeProject } from '../src/core/project-removal';
import { transferProject } from '../src/core/project-transfer';
import { projectLabelParts } from '../src/core/projects';

const codes = ['CHP', 'MDR', 'PLN', 'FRM', 'ZOT'];
const row = (duration: string, label: string, checked = true) => parseDay(`- [${checked ? 'x' : ' '}] 09:00 (${duration}) : ${label}\n`, 'd.md', codes);
const credits = (duration: string, label: string) => calculate(row(duration, label)).projects;
const start = parseDay('- [x] 08:00 (n/a) : start\n', 'd.md', codes).entries[0];

describe('the whole label is one activity group', () => {
  it('reads multiword parts in any position', () => {
    expect(credits('20-10/30', 'free time & chp')).toEqual({ CHP: 10 });
    expect(credits('10-20-30/60', 'chp review & free time & mdr notes')).toEqual({ CHP: 10, MDR: 30 });
    expect(credits('30', 'free time with chp')).toEqual({});
  });
  it('lets parentheses describe the part before them and never adds credit', () => {
    const lunch = row('60', 'prepare meal (lunch) & lunch');
    expect(calculate(lunch).projects).toEqual({}); expect(lunch.diagnostics).toEqual([]);
    expect(credits('20-10', 'chp (client) & mdr')).toEqual({ CHP: 20, MDR: 10 });
    expect(credits('20-10', 'chp & mdr (client & home)')).toEqual({ CHP: 20, MDR: 10 });
    expect(credits('5/90', 'zot (hobbies (news) & free time 1)')).toEqual({ ZOT: 5 });
    expect(activityGroup('zot (hobbies (news) & free time 1)').units.map(u => u.name)).toEqual(['zot']);
  });
  it('names a project only when its word ends cleanly', () => {
    for (const label of ["car's maintenance", 'chp_notes', 'chp. review']) expect(credits('30', label)).toEqual({});
    expect(row('97', "jamaat & sh. fateh's class").diagnostics).toEqual([]);
    expect(activityGroup("jamaat & sh. fateh's class").units.map(u => u.name)).toEqual(['jamaat', '']);
    expect(row('15/105', 'lod / chores, meal, etc').diagnostics.some(d => d.code === 'retired-syntax')).toBe(false);
    const text = "- [x] 09:00 (30) : car's maintenance\n- [x] 09:30 (30) : chp_notes\n";
    const renamed = transferProject([{ text, path: '2020-01-01.md', kind: 'day' }], 'chp', 'xyz', 'rename', { projectCodes: [...codes, 'CAR'], projectGroups: [], projectEmojis: {} });
    expect(renamed.changes.flatMap(c => c.patches)).toEqual([]);
  });
  it('keeps a numeric or non-Latin part in its place within a group', () => {
    expect(credits('20-10/30', '2 chapters & chp')).toEqual({ CHP: 10 });
    expect(credits('20-10/30', 'مطالعه & chp')).toEqual({ CHP: 10 });
    expect(row('20-10/30', '2 chapters & chp').diagnostics).toEqual([]);
    for (const input of ['08:30 20-10/30 2 chapters & chp', '08:30; 20-10/30; 2 chapters & chp', '08:30 20-10/30 مطالعه & chp'])
      expect(quickEntry(input, 'log', start, '12:00', codes).diagnostics).toEqual([]);
    expect(projectLabelParts({ label: '2 chapters & chp', duration: '20-10/30' }, codes).parts.filter(p => p.code).map(p => p.text)).toEqual(['chp']);
    const text = '- [x] 09:00 (20-10/30) : 2 chapters & chp\nCHP = 10\nSUM = 10\n';
    const removed = removeProject([{ path: '2018-01-01.md', text }], 'CHP', 'delete', codes);
    expect(applyPatches(text, removed.changes[0]!.patches)).toContain('(20/30) : 2 chapters\n');
  });
  it('keeps hyphens in names, the hyphen check and first-part credit', () => {
    expect(credits('10-20', 'check-in & chp')).toEqual({ CHP: 20 });
    expect(row('20-10', 'chp-mdr').diagnostics.some(d => d.code === 'hyphen-joiner' && d.blocks)).toBe(true);
    expect(credits('30', 'chp & mdr')).toEqual({ CHP: 30 });
  });
  it('blocks malformed groups only when project credit depends on them', () => {
    for (const label of ['chp & & mdr', '& chp', 'chp &', 'chp (client']) {
      const day = row('20-10', label);
      expect(day.entries[0]!.unknownCredit).toBe(true);
      expect(day.diagnostics.find(d => d.code === 'activity-group')).toMatchObject({ blocks: true });
      expect(row('20-10', label, false).diagnostics.find(d => d.code === 'activity-group')).toMatchObject({ blocks: false });
    }
    const ordinary = row('30', 'lunch & & tea');
    expect(ordinary.entries[0]!.unknownCredit).toBe(false);
    expect(ordinary.diagnostics.find(d => d.code === 'activity-group')).toMatchObject({ blocks: false });
    expect(ordinary.diagnostics[0]!.message).toContain('"lunch & & tea" has an empty activity beside &');
    expect(quickEntry('09:00 30 lunch & & tea', 'log', start, '12:00', codes).diagnostics[0]).toContain('empty activity');
    expect(quickEntry('09:00 30 lunch (at home', 'log', start, '12:00', codes).diagnostics[0]).toContain('unbalanced parentheses');
  });
  it('writes a spaced & only between parts, keeping context as written', () => {
    expect(canonicalJoiners('chp&mdr (a&b)')).toBe('chp & mdr (a&b)');
    expect(canonicalJoiners('2 coffees')).toBe('2 coffees');
  });
  it('styles only each part\'s leading name', () => {
    const { parts } = projectLabelParts({ label: 'free time & chp (with mdr)', duration: '20-10/30' }, codes);
    expect(parts.filter(p => p.code).map(p => p.text)).toEqual(['chp']);
  });
});

describe('(+N code) is plain context', () => {
  it('earns nothing, raises nothing and survives project operations', () => {
    const text = '## plan for 1 jan 20\n- [x] 08:00 (n/a) : awake\n- [x] 10:00 (45/120) : frm (+15 chp)\n- [x] 10:30 (30) : chp\nFRM = 45\nCHP = 30\nSUM = 75\n';
    const day = parseDay(text, '2020-01-01.md', codes);
    expect(calculate(day).projects).toEqual({ FRM: 45, CHP: 30 }); expect(day.diagnostics).toEqual([]);
    const renamed = transferProject([{ text, path: '2020-01-01.md', kind: 'day' }], 'chp', 'xyz', 'rename', { projectCodes: codes, projectGroups: [], projectEmojis: {} });
    expect(renamed.blockers).toEqual([]);
    expect(applyPatches(text, renamed.changes[0]!.patches)).toContain('(45/120) : frm (+15 chp)\n- [x] 10:30 (30) : xyz');
    const removed = removeProject([{ path: '2020-01-01.md', text }], 'CHP', 'delete', codes);
    expect(removed.blockers).toEqual([]);
    expect(applyPatches(text, removed.changes[0]!.patches)).toContain('(45/120) : frm (+15 chp)');
  });
});

describe('project operations keep each part\'s own text', () => {
  it('removes a part with its words and parentheses', () => {
    const text = '- [x] 09:00 (20-10/30) : chp review (x) & mdr notes\nCHP = 20\nMDR = 10\nSUM = 30\n';
    const plan = removeProject([{ path: '2018-01-01.md', text }], 'CHP', 'delete', codes);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(text, plan.changes[0]!.patches)).toContain('(10/30) : mdr notes\n');
  });
});

describe('equal splits', () => {
  it('divides whole minutes or 5-minute units, earlier parts taking the remainder', () => {
    expect(equalSplit(10, 3)).toEqual([4, 3, 3]);
    expect(equalSplit(10, 3, true)).toEqual([5, 5, 0]);
    expect(equalSplit(12, 2, true)).toEqual([5, 5]);
    expect(equalSplit(17, 3, true)).toEqual([5, 5, 5]);
    expect(equalSplit(0, 2, true)).toEqual([0, 0]);
    expect(equalSplit(100, 4)).toEqual([25, 25, 25, 25]);
  });
  it('suggests a split whose saved credits match it, with rounding on or off', () => {
    for (const [roundCredits, split, saved] of [[false, '08:10 4-3-3/0 chp & mdr & pln', '(4-3-3/10)'], [true, '08:10 5-5-0/0 chp & mdr & pln', '(5-5-0/10)']] as const) {
      const offered = quickEntry('08:10 chp & mdr & pln', 'log', start, '12:00', codes, { roundCredits });
      expect(offered.splits.map(s => s.input)).toEqual([split]);
      const chosen = quickEntry(split, 'log', start, '12:00', codes, { roundCredits });
      expect(chosen.diagnostics).toEqual([]); expect(chosen.rows[0]).toContain(saved);
    }
  });
});
