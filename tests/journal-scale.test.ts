import { describe, expect, it } from 'vitest';
import { HISTORY_BUDGET, Journal, compactGuards, fingerprint } from '../src/storage/journal';
const SMALL = 8192;
import type { FilePort, JournalData, Operation } from '../src/storage/journal';
import { minimalDiff } from '../src/core/changes';

function vault(notes: number) {
  const files = new Map<string, string>();
  for (let i = 0; i < notes; i++) files.set(`Ω 2025/day-${i}.md`, `## plan for day ${i}\n\n- [x] 09:00 (60) : chp\n\nCHP = 60\nSUM = 60\n`.repeat(8));
  files.set('summary.md', '### Projects\nCHP = 60\n');
  files.set('today.md', '- [ ] 09:00 (60) : chp\n');
  let saves = 0, bytes = 0, saved: JournalData | undefined;
  const port: FilePort = {
    read: async path => files.get(path) ?? null,
    replace: async (path, expected, content) => { if ((files.get(path) ?? null) !== expected) throw new Error('conflict'); files.set(path, content); },
    removeCreated: async path => { files.delete(path); }
  };
  const persist = async (value: JournalData) => { const text = JSON.stringify(value); saves++; bytes = text.length; saved = JSON.parse(text); };
  const change = (path: string, after: string) => ({ path, base: files.get(path)!, label: 'Edit', patches: minimalDiff(files.get(path)!, after) });
  const documents = () => [...files].filter(([path]) => path !== 'today.md').map(([path, text]) => ({ path, text }));
  return { files, port, persist, change, documents, get saves() { return saves; }, get bytes() { return bytes; }, get saved() { return saved; } };
}

describe('recovery journal at vault scale', () => {
  it('guards thousands of notes with a few small saves', async () => {
    const v = vault(7000), journal = new Journal(v.port, v.persist);
    const op = (await journal.perform([v.change('today.md', '- [x] 09:00 (60) : chp\n')], 'Toggle completion', true))!;
    const before = v.saves;
    await journal.append(op, v.change('summary.md', '### Projects\n🦉 CHP = 60\n'), v.documents());
    // One save records the intent and one records completion, however many notes are guarded.
    expect(v.saves - before).toBe(2);
    expect(Object.keys(op.guards!)).toHaveLength(7000);
    expect(op.writes.map(w => w.path)).toEqual(['today.md', 'summary.md']);
    // Fingerprints, not copies: well under the ~1.5 MB of guarded note text.
    expect(v.bytes).toBeLessThan(500_000);
  });
  it('blocks retry, undo and redo when a fingerprinted note changes', async () => {
    const v = vault(20), journal = new Journal(v.port, v.persist);
    const op = (await journal.perform([v.change('summary.md', 'changed summary')], 'Register projects', false, v.documents()))!;
    expect(op.guards?.['summary.md']).toBeUndefined();
    const original = v.files.get('Ω 2025/day-3.md')!;
    v.files.set('Ω 2025/day-3.md', 'manual edit');
    await expect(journal.undo()).rejects.toThrow('day-3.md');
    expect(v.files.get('summary.md')).toBe('changed summary');
    v.files.set('Ω 2025/day-3.md', original);
    await journal.undo();
    expect(v.files.get('summary.md')).toBe('### Projects\nCHP = 60\n');
    v.files.set('Ω 2025/day-5.md', 'manual edit');
    await expect(journal.redo()).rejects.toThrow('day-5.md');
  });
  it('resumes an interrupted guarded write only while the guarded notes match', async () => {
    const v = vault(20), journal = new Journal(v.port, v.persist);
    const replace = v.port.replace;
    v.port.replace = async () => { throw new Error('disk failure'); };
    await expect(journal.perform([v.change('summary.md', 'new summary')], 'Register projects', false, v.documents())).rejects.toThrow();
    v.port.replace = replace;
    const restarted = new Journal(v.port, v.persist); await restarted.load(v.saved);
    const op = restarted.data.operations[0]!;
    v.files.set('Ω 2025/day-1.md', 'manual edit');
    await expect(restarted.retry(op)).rejects.toThrow('day-1.md');
    expect(v.files.get('summary.md')).toBe('### Projects\nCHP = 60\n');
  });
  it('compacts an old journal that copied every guarded note into each operation', async () => {
    const v = vault(50);
    const copies = v.documents().filter(d => d.path !== 'summary.md').map(d => ({ path: d.path, before: d.text, after: d.text, state: 'saved' as const }));
    const legacy: Operation = { id: 'old', time: Date.now(), label: 'Insert activities', state: 'interrupted', summaryPending: true, writes: [
      { path: 'today.md', before: 'earlier', after: v.files.get('today.md')!, state: 'saved' },
      ...copies,
      { path: 'summary.md', before: 'unrelated', after: 'unrelated', state: 'saved' },
      { path: 'summary.md', before: 'stale summary', after: '🦉 summary', state: 'prepared' }
    ] };
    const checkpoint: Operation = { id: 'check', time: Date.now(), label: 'Update calculated totals', state: 'done', summaryPending: false,
      writes: [{ path: '2024-06-21.md', before: 'same', after: 'same', state: 'saved' }], resolution: { time: Date.now(), reason: 'verified' } };
    const journal = new Journal(v.port, v.persist);
    await journal.load({ version: 1, operations: [structuredClone(legacy), structuredClone(checkpoint)] });
    const compacted = journal.data.operations.find(o => o.id === 'old'), kept = journal.data.operations.find(o => o.id === 'check');
    expect(compacted!.writes.map(w => w.path)).toEqual(['today.md', 'summary.md']);
    expect(Object.keys(compacted!.guards!)).toHaveLength(50);
    expect(compacted!.guards!['Ω 2025/day-7.md']).toBe(fingerprint(v.files.get('Ω 2025/day-7.md')!));
    // Approved checkpoint evidence keeps its exact snapshot and resolution.
    expect(kept).toEqual(checkpoint);
    const again = structuredClone(compacted!); compactGuards(again);
    expect(again).toEqual(compacted);
  });
  it('closes an interrupted operation whose unfinished write later work already applied, without writing', async () => {
    const v = vault(5), journal = new Journal(v.port, v.persist);
    v.files.set('summary.md', '🦉 summary');
    await journal.load({ version: 1, operations: [{ id: 'old', time: Date.now(), label: 'Insert activities', state: 'interrupted', summaryPending: true,
      writes: [
        { path: 'today.md', before: 'earlier', after: 'since edited again', state: 'saved' },
        { path: 'summary.md', before: 'stale summary', after: '🦉 summary', state: 'prepared' }
      ], guards: { 'Ω 2025/day-1.md': 'no longer matches' } }] });
    let writes = 0; const replace = v.port.replace; v.port.replace = async (...args) => { writes++; return replace(...args); };
    const op = journal.data.operations[0]!;
    await journal.retry(op);
    expect(writes).toBe(0);
    expect(op.state).toBe('done');
    expect(op.resolution?.reason).toContain('nothing was replayed');
    expect(v.files.get('today.md')).toBe('- [ ] 09:00 (60) : chp\n');
  });
});

describe('compact recovery storage', () => {
  const bigSummary = '### Days\n' + Array.from({ length: 900 }, (_, i) => `2026-01-${String(i % 28 + 1).padStart(2, '0')} = ${i}`).join('\n') + '\n### Projects\nCHP = 60\n';
  const setup = () => {
    const v = vault(3);
    v.files.set('summary.md', bigSummary);
    v.files.set('2026-10-25.md', '- [ ] 09:00 (60) : chp\n\nCHP = 0\nSUM = 0\n');
    return v;
  };
  const edit = (v: ReturnType<typeof vault>, path: string, from: string, to: string) => v.change(path, v.files.get(path)!.replace(from, to));
  it('stores large notes as edits only, and undoes and redoes them after a restart', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist), states = [v.files.get('summary.md')!];
    for (let i = 1; i <= 3; i++) {
      const op = (await journal.perform([edit(v, '2026-10-25.md', `CHP = ${i - 1}`, `CHP = ${i}`)], 'Edit', true))!;
      await journal.append(op, edit(v, 'summary.md', `CHP = ${i === 1 ? 60 : 60 + i - 1}`, `CHP = ${60 + i}`));
      states.push(v.files.get('summary.md')!);
    }
    const stored = v.saved!.operations.flatMap(o => o.writes);
    const summary = stored.filter(w => w.path === 'summary.md'), day = stored.filter(w => w.path === '2026-10-25.md');
    expect(summary.every(w => w.before === undefined && w.after === undefined && w.sides && w.edits!.length === 1)).toBe(true);
    // Daily notes keep their prior text, so footer ownership survives later edits.
    expect(day.every(w => typeof w.before === 'string' && w.after === undefined)).toBe(true);
    expect(v.bytes).toBeLessThan(3000);
    const restarted = new Journal(v.port, v.persist); await restarted.load(v.saved);
    for (let i = 2; i >= 0; i--) { await restarted.undo(); expect(v.files.get('summary.md')).toBe(states[i]); }
    expect(v.files.get('2026-10-25.md')).toContain('CHP = 0');
    const again = new Journal(v.port, v.persist); await again.load(v.saved);
    await again.redo(); expect(v.files.get('summary.md')).toBe(states[1]);
  });
  it('refuses to undo a compact write when its note was edited since, without writing', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist);
    await journal.perform([edit(v, 'summary.md', 'CHP = 60', 'CHP = 61')], 'Edit');
    v.files.set('summary.md', v.files.get('summary.md')!.replace('2026-01-01 = 0', '2026-01-01 = 5'));
    const manual = v.files.get('summary.md');
    const restarted = new Journal(v.port, v.persist); await restarted.load(v.saved);
    await expect(restarted.undo()).rejects.toThrow('summary.md');
    expect(v.files.get('summary.md')).toBe(manual);
  });
  it('finishes an interrupted compact write after a restart', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist), replace = v.port.replace;
    const op = (await journal.perform([edit(v, '2026-10-25.md', 'CHP = 0', 'CHP = 60')], 'Edit', true))!;
    v.port.replace = async () => { throw new Error('disk failure'); };
    const target = v.files.get('summary.md')!.replace('CHP = 60', 'CHP = 120');
    await expect(journal.append(op, v.change('summary.md', target))).rejects.toThrow();
    v.port.replace = replace;
    const restarted = new Journal(v.port, v.persist); await restarted.load(v.saved);
    const stored = restarted.data.operations[0]!.writes.find(w => w.path === 'summary.md')!;
    expect(stored.state).toBe('prepared');
    await restarted.retry(restarted.data.operations[0]!);
    expect(v.files.get('summary.md')).toBe(target);
  });
  it('keeps a year of edits to a large summary small', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist);
    for (let i = 0; i < 100; i++) await journal.perform([edit(v, 'summary.md', `2026-01-${String(i % 28 + 1).padStart(2, '0')} = ${i}`, `2026-01-${String(i % 28 + 1).padStart(2, '0')} = ${i + 1000}`)], `Edit ${i}`);
    expect(bigSummary.length).toBeGreaterThan(SMALL);
    // Full copies would store 100 x 2 x ~13 KB; edits keep it to a few KB.
    expect(v.bytes).toBeLessThan(40_000);
  // One hundred full saves of a large summary can exceed the default limit when the whole suite runs in parallel.
  }, 30_000);
  it('drops the oldest finished history beyond the size budget, never unresolved evidence', async () => {
    const v = vault(30), journal = new Journal(v.port, v.persist);
    const big = 'x'.repeat(HISTORY_BUDGET / 4);
    v.files.set('@planner-project-registry', '');
    const stuck = (await journal.perform([v.change('today.md', 'stuck\n')], 'Stuck', true))!;
    stuck.state = 'interrupted'; stuck.time = 0;
    for (let i = 0; i < 6; i++) await journal.perform([v.change('@planner-project-registry', `${big}${i}`)], `Settings ${i}`);
    const labels = journal.data.operations.map(o => o.label);
    expect(labels).toContain('Stuck');
    expect(labels).toContain('Settings 5');
    expect(labels).not.toContain('Settings 0');
    expect(v.bytes).toBeLessThan(HISTORY_BUDGET + big.length * 2 + 100_000);
  });
  it('loads an old full-text journal and stores it compactly', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist);
    const after = bigSummary.replace('CHP = 60', 'CHP = 90');
    v.files.set('summary.md', after);
    await journal.load({ version: 1, operations: [{ id: 'old', time: Date.now(), label: 'Edit', state: 'done', summaryPending: false,
      writes: [{ path: 'summary.md', before: bigSummary, after, state: 'saved' }] }] });
    await journal.save();
    expect(v.saved!.operations[0]!.writes[0]!.before).toBeUndefined();
    expect(v.bytes).toBeLessThan(1000);
    await journal.undo();
    expect(v.files.get('summary.md')).toBe(bigSummary);
  });
  it('rejects a stored record whose edits do not match its text', async () => {
    const v = setup(), journal = new Journal(v.port, v.persist);
    await journal.load({ version: 1, operations: [{ id: 'bad', time: Date.now(), label: 'Edit', state: 'done', summaryPending: false,
      writes: [{ path: '2026-10-25.md', before: 'short', edits: [[40, 'missing', 'x']], state: 'saved' }] }] });
    expect(journal.data.operations).toHaveLength(0);
  });
});
