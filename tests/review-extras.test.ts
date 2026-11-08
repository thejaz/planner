import { COMBINATION_RULES } from '../src/core/marker-combinations';
import { describe, expect, it } from 'vitest';
import { groupTotals, markerCounts, normalizeGroups, normalizeWeekends, parseMarkerCriteria } from '../src/core/review-extras';
import { marker, parseSummary, summaryPatches } from '../src/core/history';
import { applyPatches } from '../src/core/changes';
import { parseDay } from '../src/core/reader';
import { contextPatch } from '../src/core/context';

const legend = `### Criteria & Markers
- 😣 | 0-29m | can't study
- ✌ | 0-29m | light can't study (context)
- 😎 | 0-29m | no study weekends
- 🦥 | 30-149m | low pro
- ❄️ | 150-299m | cool
- 🔥 | ≥300m | hot
- 🕶️ | at-ease days (context)
- ☁️ | buffer days (context)
- ==highlights== | can't study (formatting)
- **bolds** | weekends (formatting)
${COMBINATION_RULES}
`;
const summary = (rows: string, path = 'summary.md') => parseSummary(`${legend}\n### Days\n${rows}\n### Results\nDays (2026-01-01 - 2026-12-31): 365d\n`, path);
const criteria = parseMarkerCriteria(legend, 'criteria.md');

describe('review-only project groups', () => {
  it('sanitizes persisted groups, names and codes and assigns each code only once', () => {
    const groups = normalizeGroups([null, {}, { name: ' Academy ', projects: ['chp', 'CHP', 'MDR', 1] }, { name: 'academy', projects: ['HAY'] }, { name: 'Hobbies', projects: ['CHP', 'HAY', 'not valid'] }]);
    expect(groups).toEqual([{ name: 'Academy', projects: ['CHP', 'MDR'] }, { name: 'Hobbies', projects: ['HAY'] }]);
    expect(normalizeGroups('bad')).toEqual([]);
  });
  it('adds actual project credit once, honors filtering and leaves inputs unchanged', () => {
    const groups = [{ name: 'Academy', projects: ['CHP', 'MDR'] }, { name: 'Hobbies', projects: ['HAY'] }];
    const totals = { CHP: 100, MDR: 20, HAY: 60, JIB: 5 };
    const before = JSON.stringify({ groups, totals });
    expect(groupTotals(groups, totals)).toEqual([{ name: 'Academy', minutes: 120 }, { name: 'Hobbies', minutes: 60 }, { name: 'Unassigned', minutes: 5 }]);
    expect(groupTotals(groups, totals, 'CHP')).toEqual([{ name: 'Academy', minutes: 100 }]);
    expect(groupTotals(groups, totals, 'JIB')).toEqual([{ name: 'Unassigned', minutes: 5 }]);
    expect(JSON.stringify({ groups, totals })).toBe(before);
  });
  it('allows zero groups and groups with no recorded work without inventing totals', () => {
    expect(groupTotals([], { CHP: 10 })).toEqual([{ name: 'Unassigned', minutes: 10 }]);
    expect(groupTotals([{ name: 'Empty', projects: [] }], {})).toEqual([{ name: 'Empty', minutes: 0 }]);
  });
  it('shows unassigned at zero for known projects with no credit in the selected period', () => {
    expect(groupTotals([], {}, '', ['CHP', 'MDR'])).toEqual([{ name: 'Unassigned', minutes: 0 }]);
    expect(groupTotals([], {}, 'MDR', ['CHP', 'MDR'])).toEqual([{ name: 'Unassigned', minutes: 0 }]);
  });
  it('moves totals into and out of unassigned automatically when membership changes', () => {
    const totals = { CHP: 60, MDR: 30 };
    expect(groupTotals([{ name: 'work', projects: ['CHP'] }], totals)).toEqual([{ name: 'work', minutes: 60 }, { name: 'Unassigned', minutes: 30 }]);
    expect(groupTotals([{ name: 'work', projects: ['CHP', 'MDR'] }], totals)).toEqual([{ name: 'work', minutes: 90 }]);
    expect(groupTotals([], totals)).toEqual([{ name: 'Unassigned', minutes: 90 }]);
  });
  it('does not duplicate a legacy custom group named unassigned or mutate its membership', () => {
    const groups = [{ name: 'Unassigned', projects: ['CHP'] }];
    expect(groupTotals(groups, { CHP: 60, MDR: 30 })).toEqual([{ name: 'Unassigned', minutes: 90 }]);
    expect(groupTotals(groups, { CHP: 60, MDR: 30 }, 'MDR')).toEqual([{ name: 'Unassigned', minutes: 30 }]);
    expect(groups).toEqual([{ name: 'Unassigned', projects: ['CHP'] }]);
  });
});
describe('recorded summary marker counts', () => {
  it('reads all ten supplied legend entries including styled names', () => {
    expect(criteria.issues).toEqual([]); expect(criteria.definitions).toHaveLength(10);
    expect(criteria.definitions.find(def => def.key === '❄')).toMatchObject({ min: 150, max: 299, label: 'cool' });
  });
  it('counts each marker once per date with contextual overlap and variation selectors', () => {
    const source = summary('2026-10-19 = 60 ☁️☁🦥\n2026-10-20 = 200 ❄🕶️\n**2026-10-23 = 0 😎**\n==2026-10-24 = 0 😣==\n2026-10-25 = 0 ✌️\n2026-10-26 = 300 🔥');
    const result = markerCounts([source], '2026-10-19', '2026-10-26', criteria, [5]);
    expect(Object.fromEntries(result.counts)).toEqual({ '😣': 1, '✌': 1, '😎': 1, '🦥': 1, '❄': 1, '🔥': 1, '🕶': 1, '☁': 1, highlight: 1, bold: 1 });
    expect(result.countedDays).toBe(6); expect(result.issues).toEqual([]);
  });
  it('keeps recorded wrong markers while reporting the exact correction location', () => {
    const source = summary('2026-10-20 = 200 🦥');
    const result = markerCounts([source], '2026-10-20', '2026-10-20', criteria, [5]);
    expect(result.counts.get('🦥')).toBe(1); expect(result.counts.get('❄')).toBe(0);
    expect(result.issues[0]).toMatchObject({ path: source.path, line: source.rows[0]!.line });
    expect(result.issues[0]!.message).toContain('does not fit');
  });
  it('reports missing markers without inferring them from minutes', () => {
    const result = markerCounts([summary('2026-10-20 = 300')], '2026-10-20', '2026-10-20', criteria, [5]);
    expect(result.counts.get('🔥')).toBe(0); expect(result.issues[0]!.message).toContain('earns 🔥');
  });
  it('counts formatting even with unknown minutes, with a discrepancy for ranged emojis', () => {
    const result = markerCounts([summary('==2026-10-20 = ? 😣==')], '2026-10-20', '2026-10-20', criteria, []);
    expect(result.counts.get('highlight')).toBe(1); expect(result.counts.get('😣')).toBe(1);
    expect(result.issues.some(issue => issue.message.includes('unknown minutes'))).toBe(true);
  });
  it('scopes by dates, excludes duplicate dates and ignores criteria/fenced examples', () => {
    const first = summary('2026-10-19 = 60 🦥\n```\n2026-10-20 = 300 🔥\n```\n2026-10-21 = 300 🔥', 'a.md');
    const second = summary('2026-10-21 = 300 🔥', 'b.md');
    const result = markerCounts([first, second], '2026-10-20', '2026-10-21', criteria, [5]);
    expect(result.countedDays).toBe(0); expect(result.counts.get('🔥')).toBe(0);
    expect(result.issues[0]!.message).toContain('more than one summary row');
  });
  it('reports conflicting productivity symbols but retains recorded counts', () => {
    const result = markerCounts([summary('2026-10-20 = 200 ❄🔥')], '2026-10-20', '2026-10-20', criteria, [5]);
    expect(result.counts.get('❄')).toBe(1); expect(result.counts.get('🔥')).toBe(1);
    expect(result.issues.some(issue => issue.message.includes('Combination rule'))).toBe(true);
  });
  it('checks calendar weekends against actual bold formatting without rewriting it', () => {
    const source = summary('**2026-10-23 = 0 😎**\n2026-10-24 = 0');
    const before = source.text;
    const result = markerCounts([source], '2026-10-23', '2026-10-24', criteria, [6]);
    expect(result.counts.get('bold')).toBe(1);
    expect(result.issues.some(issue => issue.message.includes('outside the selected weekend'))).toBe(true);
    expect(result.issues.some(issue => issue.message.includes('not bold'))).toBe(true);
    expect(source.text).toBe(before);
  });
  it('reports missing, duplicate, overlapping and malformed criteria', () => {
    expect(parseMarkerCriteria('', 'c.md').issues.length).toBeGreaterThan(0);
    const bad = parseMarkerCriteria('### Criteria & Markers\n- 🦥 | 30-149m | low\n- 🦥 | 30-149m | duplicate\n- ❄ | 100-299m | overlaps\n- 🔥 | 300-100m | invalid\n- 😣 | 0–x | invalid', 'c.md');
    expect(bad.issues).toHaveLength(3);
  });
  it('does not parse definitions outside the criteria section or inside fences', () => {
    const parsed = parseMarkerCriteria('### Other\n- 🦥 | 30-149m | ignore\n```\n### Criteria & Markers\n- 🔥 | ≥300m | ignore\n```\n' + legend, 'c.md');
    expect(parsed.definitions).toHaveLength(10); expect(parsed.issues).toEqual([]);
  });
});
describe('configurable weekend generation', () => {
  it('migrates to Friday, supports multiple days and explicit no-weekend settings', () => {
    expect(normalizeWeekends(undefined)).toEqual([5]); expect(normalizeWeekends([])).toEqual([]);
    expect(normalizeWeekends([6, 5, 6, '1', -1, 7, 1.5])).toEqual([5, 6]);
  });
  it('uses selected days for future summary rows and context markers without reformatting existing rows', () => {
    const source = summary('2026-10-23 = 0'); source.weekends = [6];
    const days = [parseDay('SUM = 0', '2026-10-24.md')];
    const updated = applyPatches(source.text, summaryPatches(source, days, '2026-10-24', new Set(['2026-10-24'])).patches);
    expect(updated).toContain('**2026-10-24 = 0 😎**'); expect(updated).toContain('\n2026-10-23 = 0\n');
    const parsed = parseSummary(updated, 's.md', [6]);
    expect(applyPatches(updated, [contextPatch(parsed, '2026-10-24', 'at-ease')])).toContain('😎');
    expect(marker(0, '2026-10-23', '', parsed.thresholds, [6])).toBe('😣');
  });
});
