import { describe, expect, it } from 'vitest';
import { removeProject } from '../src/core/project-removal';
import { applyPatches } from '../src/core/changes';
const day = '### morning\n- [x] 09:00 (10) : mql\n- [x] 09:30 (20-10/30) : chp & mql\n\n---\nCHP = 20\nMQL = 20\nSUM = 40\nKeep MQL in this sentence.\n';
const summary = '### Days (2018-01-01 - 2018-01-01)\n2018-01-01 = 40 🦥\n### Projects\n🌱 MQL = 20\n🦉 CHP = 20\n### Bookmarks\nMQL = 999\n';
const docs = [{ path: '2018-01-01.md', text: day }, { path: 'summary.md', text: summary }];
describe('explicit project removal', () => {
  it('unlinks attribution while preserving activities/prose and subtracting work totals', () => {
    const plan = removeProject(docs, 'mql', 'unlink', ['MQL', 'CHP']);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(day, plan.changes[0]!.patches)).toBe(day.replace('MQL = 20\n', '').replace('SUM = 40', 'SUM = 20'));
    expect(applyPatches(summary, plan.changes[1]!.patches)).toBe(summary.replace('🌱 MQL = 20\n', '').replace('2018-01-01 = 40 🦥', '==2018-01-01 = 20 😣=='));
  });
  it.each(['\n', '\r\n'])('deletes only the selected project and credits with %j', eol => {
    const documents = docs.map(d => ({ ...d, text: d.text.replaceAll('\n', eol) }));
    const plan = removeProject(documents, 'MQL', 'delete', ['MQL', 'CHP']);
    expect(plan.blockers).toEqual([]);
    const expected = day.replace('- [x] 09:00 (10) : mql\n', '').replace('(20-10/30) : chp & mql', '(20/30) : chp').replace('MQL = 20\n', '').replace('SUM = 40', 'SUM = 20');
    expect(applyPatches(documents[0]!.text, plan.changes[0]!.patches)).toBe(expected.replaceAll('\n', eol));
    expect(applyPatches(documents[1]!.text, plan.changes[1]!.patches)).toBe(summary.replace('🌱 MQL = 20\n', '').replace('2018-01-01 = 40 🦥', '==2018-01-01 = 20 😣==').replaceAll('\n', eol));
  });
  it('does not match longer codes or free-text mentions and safely clears a zero definition', () => {
    const text = '- [ ] 09:00 (10) : mql9\n- [ ] 09:10 (10) : discuss mql\nMQL = 0\nSUM = 0\n';
    const plan = removeProject([{ path: '2018-01-01.md', text }], 'MQL', 'delete', ['MQL']);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(text, plan.changes[0]!.patches)).toBe(text.replace('MQL = 0\n', ''));
  });
  it('keeps the ordinary part of a mixed activity', () => {
    const text = '- [x] 09:00 (10) : mql / breakfast\nMQL = 10\nSUM = 10\n';
    const plan = removeProject([{ path: '2018-01-01.md', text }], 'MQL', 'delete', ['MQL']);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(text, plan.changes[0]!.patches)).toContain('(10) : breakfast');
  });
  it('blocks unknown splits, impossible totals and duplicate daily dates without applying anything', () => {
    const bad = day.replace('20-10/30', '?/30');
    expect(removeProject([{ path: '2018-01-01.md', text: bad }], 'MQL', 'delete', ['MQL', 'CHP']).blockers.join(' ')).toContain('older format or unclear minutes');
    expect(removeProject([{ path: '2018-01-01.md', text: day.replace('SUM = 40', 'SUM = 1') }], 'MQL', 'delete', ['MQL', 'CHP']).blockers.join(' ')).toContain('SUM');
    expect(removeProject([{ path: '2018-01-01.md', text: day.replace('SUM = 40', '? : SUM') }], 'MQL', 'delete', ['MQL', 'CHP']).blockers.join(' ')).toContain('cannot be read');
    expect(removeProject([...docs, { path: 'duplicate/2018-01-01.md', text: day }], 'MQL', 'delete', ['MQL', 'CHP']).blockers.join(' ')).toContain('more than one note for this date');
  });
  it('does not delete illustrative project lines inside fenced code blocks', () => {
    const text = '### Projects\n```md\nMQL = 123\n```\n🌱 MQL = 0\n### Bookmarks\nMQL = 999\n';
    const plan = removeProject([{ path: 'summary.md', text }], 'MQL', 'unlink', []);
    expect(applyPatches(text, plan.changes[0]!.patches)).toBe(text.replace('🌱 MQL = 0\n', ''));
  });
  it.each(['unlink', 'delete'] as const)('blocks %s when summary attribution cannot be traced to available daily figures', mode => {
    const plan = removeProject([{ path: 'summary.md', text: summary }], 'MQL', mode, ['MQL']);
    expect(plan.blockers.join(' ')).toContain('does not match the daily notes');
  });
  it('uses the same prefix reader when a description follows a code without a space', () => {
    const text = '- [x] 09:00 (10) : mql(note)\nMQL = 10\nSUM = 10\n';
    const plan = removeProject([{ path: '2018-01-01.md', text }], 'MQL', 'delete', ['MQL']);
    expect(plan.blockers).toEqual([]);
    expect(applyPatches(text, plan.changes[0]!.patches)).toBe('SUM = 0\n');
  });
});
