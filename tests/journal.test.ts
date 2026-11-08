import { describe, expect, it } from 'vitest';
import { Journal, isSummaryCheckpoint } from '../src/storage/journal';
import type { FilePort, JournalData } from '../src/storage/journal';
import { minimalDiff } from '../src/core/changes';
import { transferProject } from '../src/core/project-transfer';
import type { ProjectDocument, ProjectIdentity } from '../src/core/project-transfer';
function harness(initial: Record<string, string> = { 'day.md': 'before', 'summary.md': 'old' }) {
  const files = new Map(Object.entries(initial));
  let saved: JournalData | undefined, failPath = '', failPersist = false;
  const port: FilePort = {
    read: async path => files.get(path) ?? null,
    replace: async (path, expected, content) => {
      if (failPath === path) throw new Error('disk failure');
      if ((files.get(path) ?? null) !== expected) throw new Error('conflict');
      files.set(path, content);
    },
    removeCreated: async (path, expected) => {
      if (files.get(path) !== expected) throw new Error('conflict');
      files.delete(path);
    }
  };
  const persist = async (value: JournalData) => { if (failPersist) throw new Error('recovery storage unavailable'); saved = structuredClone(value); };
  const journal = new Journal(port, persist);
  const change = (path: string, base: string, after: string) => ({ path, base, label: 'Edit', patches: minimalDiff(base, after) });
  return { files, port, persist, journal, change, get saved() { return saved; },
    fail: (path: string) => failPath = path, failPersist: () => failPersist = true };
}
describe('recoverable writes', () => {
  it('retains newly resolved old checkpoint evidence when the history limit is full', async () => {
    const path = '2024-06-21.md', h = harness({ [path]: 'old', 'day.md': '0' });
    const op = (await h.journal.perform([h.change(path, 'old', 'old')], 'Update calculated totals', true))!;
    op.state = 'interrupted'; op.time = 1;
    for (let i = 0; i < 105; i++) await h.journal.perform([h.change('day.md', String(i), String(i + 1))], `Edit ${i}`);
    await h.journal.resolveCheckpoint(op, [{ path, text: 'old' }], () => {});
    expect(h.saved?.operations.some(o => o.id === op.id && o.resolution)).toBe(true);
    expect(h.saved?.operations).toHaveLength(100);
  });
  it('retires a verified obsolete daily checkpoint without changing its source or stored snapshot', async () => {
    const path = '2024-06-21.md', h = harness({ [path]: 'old', 'summary.md': 'verified' });
    const op = (await h.journal.perform([h.change(path, 'old', 'old')], 'Update calculated totals', true))!;
    op.state = 'interrupted'; op.time = 1; op.writes[0]!.state = 'prepared'; h.files.set(path, 'corrected manually');
    await h.journal.resolveCheckpoint(op, [{ path, text: 'corrected manually' }, { path: 'summary.md', text: 'verified' }], () => {});
    expect(h.files.get(path)).toBe('corrected manually'); expect(op.writes[0]!.before).toBe('old');
    expect(op.state).toBe('done'); expect(op.summaryPending).toBe(false); expect(op.resolution?.reason).toContain('without replaying');
    const loaded = new Journal(h.port, h.persist); await loaded.load(h.saved);
    expect(loaded.data.operations[0]?.resolution).toEqual(op.resolution); expect(await loaded.undo()).toBeNull();
  });
  it('rejects stale source, summary and discovery scope during checkpoint closure', async () => {
    const path = '2024-06-21.md', h = harness({ [path]: 'old', 'summary.md': 'newer' });
    const op = (await h.journal.perform([h.change(path, 'old', 'old')], 'Update calculated totals', true))!; op.state = 'interrupted';
    for (const guards of [[{ path, text: 'stale' }], [{ path, text: 'old' }, { path: 'summary.md', text: 'stale' }]])
      await expect(h.journal.resolveCheckpoint(op, guards, () => {})).rejects.toThrow('changed');
    await expect(h.journal.resolveCheckpoint(op, [{ path, text: 'old' }], () => { throw Error('list changed'); })).rejects.toThrow('list changed');
    expect(op.state).toBe('interrupted'); expect(op.summaryPending).toBe(true);
  });
  it('never treats settings, actual writes, create/delete, undo/redo or empty operations as eligible checkpoints', () => {
    const base = { id: 'op', time: Date.now(), label: 'x', state: 'interrupted' as const, summaryPending: true, writes: [{ path: '2024-06-21.md', before: 'old', after: 'old', state: 'prepared' as const }] };
    expect(isSummaryCheckpoint(base)).toBe(true);
    for (const op of [{ ...base, undoOf: 'parent' }, { ...base, redoOf: 'parent' }, { ...base, summaryPending: false }, { ...base, writes: [] },
      ...[{ path: '@planner-project-registry', before: 'old', after: 'old' }, { path: '2024-06-21.md', before: 'old', after: 'new' }, { path: '2024-06-21.md', before: null, after: 'new' }, { path: '2024-06-21.md', before: 'old', after: null }].map(w => ({ ...base, writes: [{ ...w, state: 'prepared' as const }] }))]) expect(isSummaryCheckpoint(op)).toBe(false);
  });
  it('keeps a checkpoint unresolved if resolution cannot be persisted', async () => {
    const path = '2024-06-21.md', h = harness({ [path]: 'old' });
    const op = (await h.journal.perform([h.change(path, 'old', 'old')], 'Update calculated totals', true))!; op.state = 'interrupted'; h.failPersist();
    await expect(h.journal.resolveCheckpoint(op, [{ path, text: 'old' }], () => {})).rejects.toThrow('storage unavailable');
    expect(op.state).toBe('interrupted'); expect(op.summaryPending).toBe(true); expect(op.resolution).toBeUndefined();
  });
  it.each(['rename', 'merge'] as const)('recovers a whole %s across notes, templates, emoji and registry at every interrupted write', async mode => {
    const before: ProjectIdentity = { projectCodes: mode === 'merge' ? ['OLD','NEW'] : ['OLD'], projectGroups: [{name:'Work',projects:['OLD']}], projectEmojis: {OLD:'🌱',...(mode === 'merge' ? {NEW:'🦉'} : {})} };
    const docs: ProjectDocument[] = [
      {path:'2020-01-01.md',kind:'day',text:'## recorded totals\nOLD = 10\nSUM = 10\n'},
      {path:'thejaz-summary.md',kind:'summary',text:'### Projects\n🌱 OLD = 10\n'},
      {path:'_Codes/archive/routine.md',kind:'template',text:'```md\n- [ ] 09:00 (10) : old\nOLD = 0\n```\n'}
    ];
    const plan=transferProject(docs,'OLD','NEW',mode,before);expect(plan.blockers).toEqual([]);
    const registry = (s: ProjectIdentity) => JSON.stringify({projectCodes:s.projectCodes,projectGroups:s.projectGroups});
    const initial = Object.fromEntries([...docs.map(d=>[d.path,d.text]),['@planner-project-registry',registry(before)],['@planner-project-emojis',JSON.stringify(before.projectEmojis)],['@planner-project-sources','same guarded list']]);
    for (const failPath of [...docs.map(d=>d.path),'@planner-project-registry','@planner-project-emojis']) {
      const h=harness(initial);h.fail(failPath);
      await expect(h.journal.perform([...plan.changes,h.change('@planner-project-registry',registry(before),registry(plan.after)),h.change('@planner-project-emojis',JSON.stringify(before.projectEmojis),JSON.stringify(plan.after.projectEmojis))],mode,false,[...docs,{path:'@planner-project-sources',text:'same guarded list'}])).rejects.toThrow();
      const resumed=new Journal(h.port,h.persist);await resumed.load(h.saved);h.fail('');await resumed.retry(resumed.data.operations[0]!);
      const applied=Object.fromEntries(h.files);expect(applied['2020-01-01.md']).toContain('NEW = 10');expect(applied['@planner-project-emojis']).toBe(JSON.stringify(plan.after.projectEmojis));
      await resumed.undo();expect(Object.fromEntries(h.files)).toEqual(initial);
      await resumed.redo();expect(Object.fromEntries(h.files)).toEqual(applied);
    }
  });
  it('recovers emoji assignments with summaries and registration after an interrupted Settings write', async () => {
    const initial = { '@planner-project-registry': 'codes/groups', '@planner-project-emojis': '{"CAR":"🚗"}', 'summary.md': '🚗 CAR = 50' };
    const h = harness(initial);
    h.fail('@planner-project-emojis');
    await expect(h.journal.perform([
      h.change('summary.md', initial['summary.md'], '🦉 CAR = 50'),
      h.change('@planner-project-emojis', initial['@planner-project-emojis'], '{"CAR":"🦉"}')
    ], 'Change emoji', false, [{ path: '@planner-project-registry', text: 'codes/groups' }])).rejects.toThrow();
    const resumed = new Journal(h.port, h.persist); await resumed.load(h.saved); h.fail('');
    await resumed.retry(resumed.data.operations[0]!);
    expect(h.files.get('@planner-project-emojis')).toBe('{"CAR":"🦉"}');
    await resumed.undo(); expect(Object.fromEntries(h.files)).toEqual(initial);
    await resumed.redo(); expect(h.files.get('summary.md')).toBe('🦉 CAR = 50');
    expect(h.files.get('@planner-project-registry')).toBe('codes/groups');
  });
  it('groups project registry and notes through failure, restart, Undo and Redo', async () => {
    const h = harness({ '@planner-project-registry': 'old codes/groups', 'summary.md': 'old summary', 'source.md': 'recorded credit' });
    h.fail('@planner-project-registry');
    await expect(h.journal.perform([h.change('summary.md', 'old summary', 'new summary'), h.change('@planner-project-registry', 'old codes/groups', 'new codes/groups')], 'Register projects', false, [{ path: 'source.md', text: 'recorded credit' }])).rejects.toThrow();
    expect(h.files.get('summary.md')).toBe('new summary');
    const restarted = new Journal(h.port, h.persist); await restarted.load(h.saved);
    h.fail(''); await restarted.retry(restarted.data.operations[0]!);
    expect(h.files.get('@planner-project-registry')).toBe('new codes/groups');
    await restarted.undo(); expect(h.files.get('summary.md')).toBe('old summary'); expect(h.files.get('@planner-project-registry')).toBe('old codes/groups');
    await restarted.redo(); expect(h.files.get('@planner-project-registry')).toBe('new codes/groups');
    expect(h.files.get('summary.md')).toBe('new summary'); expect(h.files.get('source.md')).toBe('recorded credit');
  });
  it('rejects stale declaration snapshots before writing either Settings or notes', async () => {
    const h = harness();
    await expect(h.journal.perform([h.change('summary.md', 'old', 'new')], 'Register', false, [{ path: 'day.md', text: 'stale' }])).rejects.toThrow('changed');
    expect(h.files.get('summary.md')).toBe('old'); expect(h.saved).toBeUndefined();
  });
  it('does not rebase a guarded summary when its period changes during preparation', async () => {
    const h = harness(); let reads = 0;
    const read = h.port.read;
    h.port.read = async path => { if (path === 'summary.md' && ++reads === 2) h.files.set(path, 'manual period change'); return read(path); };
    await expect(h.journal.perform([h.change('summary.md', 'old', 'new project total')], 'Register', false, [{ path: 'summary.md', text: 'old' }])).rejects.toThrow('changed');
    expect(h.files.get('summary.md')).toBe('manual period change'); expect(h.saved).toBeUndefined();
  });
  it('redoes grouped source/footer/summary writes and supports repeated undo/redo', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit');
    await h.journal.append(op!, h.change('day.md', 'after', 'after + footer'));
    await h.journal.append(op!, h.change('summary.md', 'old', 'new'));
    expect(h.journal.canRedo).toBe(false);
    for (let i = 0; i < 3; i++) {
      await h.journal.undo(); expect(h.journal.canRedo).toBe(true);
      await h.journal.redo();
      expect(Object.fromEntries(h.files)).toEqual({ 'day.md': 'after + footer', 'summary.md': 'new' });
      expect(h.journal.canRedo).toBe(false);
    }
  });
  it('redoes several undone operations in order and clears the redo branch after a new edit', async () => {
    const h = harness();
    await h.journal.perform([h.change('day.md', 'before', 'A')], 'A');
    await h.journal.perform([h.change('day.md', 'A', 'B')], 'B');
    await h.journal.undo(); await h.journal.undo();
    await h.journal.redo(); expect(h.files.get('day.md')).toBe('A');
    await h.journal.redo(); expect(h.files.get('day.md')).toBe('B');
    await h.journal.undo();
    await h.journal.perform([h.change('day.md', 'A', 'C')], 'C');
    expect(h.journal.canRedo).toBe(false); expect(await h.journal.redo()).toBeNull();
    expect(h.files.get('day.md')).toBe('C');
  });
  it('persists redo across reload and checks all files before any redo write', async () => {
    const h = harness();
    await h.journal.perform([h.change('day.md', 'before', 'after'), h.change('summary.md', 'old', 'new')], 'Group');
    await h.journal.undo();
    const restarted = new Journal(h.port, h.persist); await restarted.load(h.saved);
    expect(restarted.canRedo).toBe(true);
    h.files.set('summary.md', 'manual');
    await expect(restarted.redo()).rejects.toThrow('would overwrite that edit');
    expect(h.files.get('day.md')).toBe('before');
    h.files.set('summary.md', 'old'); await restarted.redo();
    expect(h.files.get('day.md')).toBe('after');
  });
  it('recovers a partial redo without consuming it twice or allowing another redo during recovery', async () => {
    const h = harness();
    await h.journal.perform([h.change('day.md', 'before', 'after'), h.change('summary.md', 'old', 'new')], 'Group');
    await h.journal.undo(); h.fail('summary.md');
    await expect(h.journal.redo()).rejects.toThrow('disk failure');
    expect(h.journal.canRedo).toBe(false);
    const redo = h.journal.data.operations.at(-1)!;
    expect(redo.redoOf).toBeTruthy();
    h.fail(''); await h.journal.retry(redo);
    expect(Object.fromEntries(h.files)).toEqual({ 'day.md': 'after', 'summary.md': 'new' });
    expect(h.journal.canRedo).toBe(false);
    await h.journal.undo(); expect(h.journal.canRedo).toBe(true);
  });
  it('safely redoes creation and rejects a replacement file after undo', async () => {
    const h = harness(); await h.journal.create('new.md', 'content');
    await h.journal.undo(); h.files.set('new.md', 'manual');
    await expect(h.journal.redo()).rejects.toThrow('would overwrite that edit');
    h.files.delete('new.md'); await h.journal.redo();
    expect(h.files.get('new.md')).toBe('content');
  });
  it('persists a summary checkpoint without rewriting an unchanged source', async () => {
    const h = harness();
    h.fail('day.md');
    const op = await h.journal.perform([h.change('day.md', 'before', 'before')], 'Pending summary', true);
    expect(op?.summaryPending).toBe(true);
    expect(h.files.get('day.md')).toBe('before');
    const restarted = new Journal(h.port, h.persist);
    await restarted.load(h.saved);
    expect(restarted.data.operations[0]?.summaryPending).toBe(true);
    expect(await restarted.undo()).toBeNull();
  });
  it('never mutates a note if recovery evidence cannot be saved', async () => {
    const h = harness(); h.failPersist();
    await expect(h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit')).rejects.toThrow();
    expect(h.files.get('day.md')).toBe('before');
  });
  it('reports the write failure when recording the interruption also fails', async () => {
    const h = harness();
    h.port.replace = async () => { h.failPersist(); throw new Error('disk failure'); };
    await expect(h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit')).rejects.toThrow('disk failure');
    expect(h.saved!.operations[0]!.state).toBe('pending');
    const restarted = new Journal(h.port, h.persist);
    await restarted.load(h.saved);
    expect(restarted.data.operations[0]!.state).toBe('interrupted');
    expect(h.files.get('day.md')).toBe('before');
  });
  it('retains a successful source when a following summary write fails', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit', true);
    h.fail('summary.md');
    await expect(h.journal.append(op!, h.change('summary.md', 'old', 'new'))).rejects.toThrow();
    expect(h.files.get('day.md')).toBe('after');
    expect(op!.summaryPending).toBe(true);
    expect(op!.state).toBe('interrupted');
    expect(h.saved!.operations[0]!.writes[0]!.before).toBe('before');
  });
  it('detects interrupted writes on restart without changing sources', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit', true);
    op!.state = 'pending'; op!.writes[0]!.state = 'prepared'; await h.journal.save();
    const restarted = new Journal(h.port, h.persist);
    await restarted.load(h.saved);
    expect(restarted.data.operations[0]!.state).toBe('interrupted');
    expect(restarted.data.operations[0]!.writes[0]!.state).toBe('saved');
    expect(h.files.get('day.md')).toBe('after');
  });
  it('undoes a source and summary together, including successive edits to one source', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit', true);
    await h.journal.append(op!, h.change('day.md', 'after', 'after + footer'));
    await h.journal.append(op!, h.change('summary.md', 'old', 'new'));
    await h.journal.finishSummary(op!);
    await h.journal.undo();
    expect(Object.fromEntries(h.files)).toEqual({ 'day.md': 'before', 'summary.md': 'old' });
  });
  it('checks every file before undo and protects later manual work', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit', true);
    await h.journal.append(op!, h.change('summary.md', 'old', 'new'));
    h.files.set('summary.md', 'manual');
    await expect(h.journal.undo()).rejects.toThrow();
    expect(h.files.get('day.md')).toBe('after');
    expect(h.files.get('summary.md')).toBe('manual');
  });
  it('does not overwrite an existing day and safely undoes creation', async () => {
    const h = harness();
    await expect(h.journal.create('day.md', 'new')).rejects.toThrow();
    await h.journal.create('new.md', 'content');
    await h.journal.undo();
    expect(h.files.has('new.md')).toBe(false);
  });
  it('expires resolved records but retains unresolved recovery evidence', async () => {
    const h = harness();
    const operation = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit');
    operation!.time = 1; await h.journal.save();
    expect(h.journal.data.operations).toHaveLength(0);
    const pending = await h.journal.perform([h.change('day.md', 'after', 'after2')], 'Edit', true);
    pending!.time = 1; await h.journal.save();
    expect(h.journal.data.operations).toHaveLength(1);
  });
  it('keeps the latest 100 resolved operations', async () => {
    const h = harness({ 'day.md': '0' });
    for (let i = 0; i < 105; i++) await h.journal.perform([h.change('day.md', String(i), String(i + 1))], `Edit ${i}`);
    expect(h.journal.data.operations).toHaveLength(100);
    expect(h.journal.data.operations[0]?.label).toBe('Edit 5');
    expect(h.journal.data.operations.at(-1)?.label).toBe('Edit 104');
  });
  it('resumes a failed write only when its source version still matches', async () => {
    const h = harness(); h.fail('day.md');
    await expect(h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit')).rejects.toThrow();
    const operation = h.journal.data.operations[0]!;
    h.fail(''); await h.journal.retry(operation);
    expect(h.files.get('day.md')).toBe('after');
    expect(operation.state).toBe('done');
  });
  it('journals undo and can recover after a failure between undo writes', async () => {
    const h = harness();
    const op = await h.journal.perform([h.change('day.md', 'before', 'after')], 'Edit');
    await h.journal.append(op!, h.change('summary.md', 'old', 'new'));
    h.fail('day.md');
    await expect(h.journal.undo()).rejects.toThrow();
    expect(h.files.get('summary.md')).toBe('old');
    const undo = h.journal.data.operations.at(-1)!;
    expect(undo.undoOf).toBe(op!.id);
    h.fail(''); await h.journal.retry(undo);
    expect(h.files.get('day.md')).toBe('before');
    expect(op!.state).toBe('undone');
  });
});
