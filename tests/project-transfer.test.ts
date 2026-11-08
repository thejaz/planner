import { describe, expect, it } from 'vitest';
import { applyPatches, makeDay } from '../src/core/changes';
import { transferProject } from '../src/core/project-transfer';
import type { ProjectDocument, ProjectIdentity, ProjectTransferMode } from '../src/core/project-transfer';
import { calculate, parseDay } from '../src/core/reader';

const identity = (mode: ProjectTransferMode = 'rename'): ProjectIdentity => ({ projectCodes: mode === 'merge' ? ['DTFL', 'DTF', 'CHP'] : ['DTFL', 'CHP'], projectGroups: [{ name: 'Source', projects: ['DTFL'] }, { name: 'Destination', projects: mode === 'merge' ? ['DTF'] : [] }], projectEmojis: { DTFL: '🌱', ...(mode === 'merge' ? { DTF: '🦉' } : {}), CHP: '🧭' } });
const day = (text: string, path = '2020-01-01.md'): ProjectDocument => ({ text, path, kind: 'day' });
const summary = (text: string): ProjectDocument => ({ text, path: 'thejaz-summary-now.md', kind: 'summary' });
function run(documents: ProjectDocument[], mode: ProjectTransferMode = 'rename', settings = identity(mode)) {
  const result = transferProject(documents, 'dtfl', 'dtf', mode, settings);
  const output = documents.map(doc => { const c = result.changes.find(c => c.path === doc.path); return c ? applyPatches(doc.text, c.patches) : doc.text; });
  return { result, output };
}
describe('parser-based project rename', () => {
  it.each(['\n', '\r\n'])('changes complete code references and preserves descriptions, words, formatting and numbers (%j)', eol => {
    const text = ['## plan for 01.01.20', '- [x] 09:00 (n/a) : awake', '- [x] 10:00 (20-40/60) : DTFL & chp (dtfl)', '- [ ] 11:00 (60) : dtflont', '**DTFL = 20**', 'CHP = 40', 'SUM = 60', 'DTFL is mentioned in this prose.', ''].join(eol);
    const { result, output } = run([day(text)]);
    expect(result.blockers).toEqual([]);
    expect(output[0]).toBe(text.replace(': DTFL & chp', ': dtf & chp').replace('DTFL = 20', 'DTF = 20'));
    expect(result.after.projectCodes).toEqual(['DTF','CHP']);
    expect(result.after.projectGroups[0]!.projects).toEqual(['DTF']);
    expect(result.after.projectEmojis).toEqual({ DTF: '🌱', CHP: '🧭' });
  });
  it('renames & components but not descriptive parentheses', () => {
    const text = '- [x] 10:00 (30-5/30) : chp & DTFL (dtfl)\nCHP = 30\nDTFL = 5\nSUM = 35\n';
    const { result, output } = run([day(text)]); expect(result.blockers).toEqual([]);
    expect(output[0]).toBe(text.replace('& DTFL', '& dtf').replace('DTFL = 5','DTF = 5'));
  });
  it('renames historical ranges and hour/minute totals without reformatting them', () => {
    const text = '- [x] **09:00 - 10:00 (60) : dtfl**\nTotal DTFL Time: 1h 0m (observed)\nTotal Time: 1h\n';
    const { result, output } = run([day(text)]); expect(result.blockers).toEqual([]);
    expect(output[0]).toBe(text.replace(': dtfl', ': dtf').replace('Total DTFL', 'Total DTF'));
  });
  it('supports compact historical hour/minute expressions', () => {
    const text='Total DTFL Time: 1h30m (observed)\nTotal Time: 1h30m\n';
    const {result,output}=run([day(text)]);expect(result.blockers).toEqual([]);expect(output[0]).toBe(text.replace('Total DTFL','Total DTF'));
  });
  it('preserves unrelated existing errors when removing a footer shifts their line numbers', () => {
    const text='## recorded totals\nDTFL = 10\nDTF = 20\nSUM = 30\n? : OTHER\n';
    const settings=identity('merge');settings.projectCodes.push('OTHER');
    expect(run([day(text)],'merge',settings).result.blockers).toEqual([]);
  });
  it('patches numeric summary declarations only, preserving prose, periods and emojis', () => {
    const text = '### Projects\n**🌱 DTFL = 0005**\n### Bookmarks\nDTFL = proposal\n### Results\nDays (2020-01-01 - 2020-12-31)\n';
    const { result, output } = run([summary(text)]); expect(result.blockers).toEqual([]);
    expect(output[0]).toBe(text.replace('DTFL = 0005','DTF = 0005'));
  });
  it.each(['', '```md\r\n'])('includes archived templates and preserves enclosing fences (%j)', wrapper => {
    const body = '- [ ] 09:00 (20-30/50) : dtfl & chp\r\nDTFL = 0\r\nCHP = 0\r\nSUM = 0\r\n';
    const text = wrapper ? wrapper + body + '```\r\n' : body;
    const { result, output } = run([{ path: '_Codes/archive/old.md', text, kind: 'template' }]); expect(result.blockers).toEqual([]);
    expect(output[0]).toBe(text.replace(': dtfl & chp', ': dtf & chp').replace('DTFL = 0','DTF = 0'));
  });
  it('does not replace sample code fences in an actual daily note', () => {
    const text = '```md\n- [x] 09:00 (20) : dtfl\nDTFL = 20\n```\n';
    const { result, output } = run([day(text)]); expect(result.changes).toEqual([]); expect(output[0]).toBe(text);
  });
  it.each(['DTF = 0\n', '- [x] 09:00 (10) : dtf\n', '- [x] 09:00 (30) : dtf / breakfast\n'])('blocks target declarations or accidental new attribution (%j)', text => {
    expect(run([day(text)]).result.blockers.length).toBeGreaterThan(0);
  });
  it('blocks target code references in a template even with zero credit', () => {
    expect(run([{ kind:'template',path:'_Codes/a.md',text:'- [ ] 09:00 (0) : dtf\n' }]).result.blockers.length).toBeGreaterThan(0);
  });
  it('blocks an already registered destination and exposes merge instead', () => {
    const { result } = run([], 'rename', identity('merge')); expect(result.targetExists).toBe(true); expect(result.blockers[0]!.message).toContain('merge');
  });
  it.each(['? : DTFL\n','### Projects\nDTFL = ?\n'])('blocks malformed affected declarations (%j)', text => {
    const doc = text.startsWith('###') ? summary(text) : day(text); expect(run([doc]).result.blockers.length).toBeGreaterThan(0);
  });
  it('preserves an existing known discrepancy during a pure rename', () => {
    const text = '- [x] 09:00 (10) : dtfl\nDTFL = 20\nSUM = 20\n';
    expect(run([day(text)]).result.blockers).toEqual([]);
  });
  it('treats case-only rename as no change and validates code rules', () => {
    const result = transferProject([], 'DTFL','dtfl','rename',identity()); expect(result.blockers).toEqual([]); expect(result.changes).toEqual([]); expect(result.after).toEqual(result.before);
    expect(() => transferProject([], 'DTFL','SUM','rename',identity())).toThrow('reserved');
    expect(() => transferProject([], 'DTFL','DT F','rename',identity())).toThrow('code');
  });
  it('does not reintroduce renamed built-in codes through blank-day defaults', () => {
    const initial: ProjectIdentity={projectCodes:['IRP','CHP'],projectGroups:[],projectEmojis:{IRP:'🌱',CHP:'🧭'}};
    const renamed=transferProject([],'IRP','NEW','rename',initial);
    const blank=makeDay('2020-01-01','',renamed.after.projectCodes);
    expect(blank).not.toContain(': IRP');expect(blank).toContain('CHP = 0');expect(blank).toContain('SUM = 0');
  });
});
describe('explicit project merge', () => {
  it('combines activity allocations and recorded totals without changing SUM or elapsed', () => {
    const text = '- [x] 09:00 (n/a) : awake\n- [x] 10:00 (20-30/60) : dtfl & dtf (dtfl)\nDTFL = 20\nDTF = 30\nSUM = 50\n';
    const { result, output } = run([day(text)],'merge'); expect(result.blockers).toEqual([]);
    expect(output[0]).toBe('- [x] 09:00 (n/a) : awake\n- [x] 10:00 (50/60) : dtf (dtfl)\nDTF = 50\nSUM = 50\n');
    expect(result.after.projectCodes).toEqual(['DTF','CHP']); expect(result.after.projectEmojis.DTF).toBe('🦉'); expect(result.after.projectEmojis.DTFL).toBeUndefined();
    expect(result.after.projectGroups).toEqual([{name:'Source',projects:[]},{name:'Destination',projects:['DTF']}]);
  });
  it.each(['20 - 30 + 10 / 60','20|30|10/60'])('keeps ordinary components, split notation and elapsed time (%s)', duration => {
    const text = `- [x] 10:00 (${duration}) : dtf & party & dtfl\n`;
    const { result, output } = run([day(text)],'merge'); expect(result.blockers).toEqual([]);
    const calc = calculate(parseDay(output[0]!, '', result.after.projectCodes)); expect(calc.projects).toEqual({ DTF:30 }); expect(output[0]).toContain(': dtf & party'); expect(output[0]).toContain(duration.includes('/ ') ? '/ 60' : '/60');
  });
  it('retains credit overflow and existing non-project allocation', () => {
    const { result, output } = run([day('- [x] 10:00 (50-60-5/60) : dtfl & dtf & party\n')],'merge'); expect(result.blockers).toEqual([]); expect(output[0]).toContain('(110-5/60) : dtf & party');
  });
  it('preserves separate sessions and an Unassigned destination', () => {
    const settings=identity('merge');settings.projectGroups[1]!.projects=[];
    const text='- [x] 09:00 (10) : dtfl\n- [x] 09:20 (20) : dtf\nDTFL = 10\nDTF = 20\nSUM = 30\n';
    const {result,output}=run([day(text)],'merge',settings);expect(result.blockers).toEqual([]);expect(output[0]!.match(/: dtf\n/g)).toHaveLength(2);expect(result.after.projectGroups.every(g=>!g.projects.includes('DTF'))).toBe(true);
  });
  it('merges recorded-only and summary-only values without fabricating sessions', () => {
    const s='### Projects\n🌱 DTFL = 0010\n🦉 DTF = 0020\n### Bookmarks\nKeep DTFL in prose\n';
    const d='## recorded totals\nDTFL = 10\nDTF = 20\nSUM = 30\n';
    const {result,output}=run([day(d),summary(s)],'merge');expect(result.blockers).toEqual([]);expect(output[0]).toBe('## recorded totals\nDTF = 30\nSUM = 30\n');expect(output[1]).toBe('### Projects\n🦉 DTF = 0030\n### Bookmarks\nKeep DTFL in prose\n');
  });
  it('renames source-only summary rows using the destination emoji, without adding other periods', () => {
    const {result,output}=run([summary('### Projects\n**🌱 DTFL = 10**\n')],'merge');expect(result.blockers).toEqual([]);expect(output[0]).toBe('### Projects\n**🦉 DTF = 10**\n');
  });
  it('combines legacy totals preserving their explanatory destination annotation', () => {
    const text='Total DTFL Time: 1h\nTotal DTF Time: 30m (kept)\nTotal Time: 1h 30m\n';
    const {result,output}=run([day(text)],'merge');expect(result.blockers).toEqual([]);expect(output[0]).toBe('Total DTF Time: 1h 30m (kept)\nTotal Time: 1h 30m\n');
  });
  it.each(['- [x] 10:00 (30) : dtfl & dtf\n','DTFL = 10\nDTFL = 20\n','- [x] 09:00 (10) : dtfl\nDTFL = 20\nSUM = 20\n','DTFL = 10[^note]\nDTF = 20\nSUM = 30\n'])('blocks ambiguous or conflicting affected data (%j)', text => {
    expect(run([day(text)],'merge').result.blockers.length).toBeGreaterThan(0);
  });
  it('blocks unsafe combined values and self-merges', () => {
    expect(run([day(`## recorded totals\n${Number.MAX_SAFE_INTEGER} : DTFL\nDTF = 1\n${Number.MAX_SAFE_INTEGER} : SUM\n`)],'merge').result.blockers.length).toBeGreaterThan(0);
    expect(transferProject([], 'DTFL','dtfl','merge',identity('merge')).blockers.length).toBeGreaterThan(0);
  });
  it('blocks unsafe explicit credit even during a rename', () => {
    expect(run([day(`- [x] 09:00 (30-${Number.MAX_SAFE_INTEGER + 1}/30) : chp & dtfl\n`)]).result.blockers.length).toBeGreaterThan(0);
  });
  it('blocks conflicting summary aggregates when complete daily evidence exists', () => {
    const s='### Days (2020-01-01 - 2020-01-01)\n2020-01-01 = 30\n### Projects\n🌱 DTFL = 11\n🦉 DTF = 20\n';
    const d='## recorded totals\nDTFL = 10\nDTF = 20\nSUM = 30\n';
    expect(run([day(d),summary(s)],'merge').result.blockers.some(b=>b.message.includes('does not match the daily notes'))).toBe(true);
  });
});
