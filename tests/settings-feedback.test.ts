import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ Modal: class {} }));
import type { Controller } from '../src/controller';
import { rebuildResult, retryResult, syncResult, undoResult } from '../src/ui/settings-feedback';

function controller() {
  return {
    indexing: false, initialized: true, isAlive: true, indexed: true,
    index: vi.fn(async () => undefined), issues: new Map<string, string>(),
    days: new Map([['day', {}]]), summaries: new Map([['summary', {}]]),
    performance: { indexRuns: [{ read: 2, cached: 8 }] },
    journal: { canUndo: false, data: { operations: [] as { id: string; state: string; summaryPending?: boolean; writes: { path: string; before: string; after: string }[] }[] } },
    retrySummary: vi.fn(async () => undefined), undo: vi.fn(async () => undefined), syncProjectRegistrations: vi.fn(async () => undefined)
  };
}
const asController = (c: ReturnType<typeof controller>) => c as unknown as Controller;
describe('settings action outcomes', () => {
  it('does not report a successful rebuild or queue another when one is running', async () => {
    const c = controller(); c.indexing = true;
    expect((await rebuildResult(asController(c))).outcome).toBe('unchanged'); expect(c.index).not.toHaveBeenCalled();
  });
  it('reports indexed records, disk/cache counts and remaining attention separately', async () => {
    const c = controller(); c.issues.set('summary', 'Check the totals');
    const result = await rebuildResult(asController(c));
    expect(result.outcome).toBe('warning'); expect(result.message).toBe('Index rebuilt.');
    expect(result.details?.join(' ')).toContain('Read 2 notes; reused 8');
    expect(result.details?.join(' ')).toContain('1 item still needs attention');
  });
  it('surfaces index errors caught by the controller instead of displaying success', async () => {
    const c = controller(); c.index = vi.fn(async () => { c.issues.set('index', 'Read failed'); });
    await expect(rebuildResult(asController(c))).rejects.toThrow('Read failed');
  });
  it('refuses success after shutdown or incomplete startup', async () => {
    const c = controller(); c.initialized = false;
    await expect(rebuildResult(asController(c))).rejects.toThrow('not ready');
    c.initialized = true; c.index = vi.fn(async () => { c.isAlive = false; });
    await expect(rebuildResult(asController(c))).rejects.toThrow('stopped');
  });
  it('distinguishes no pending summary work from successful or partial retries', async () => {
    const c = controller(); expect((await retryResult(asController(c))).outcome).toBe('unchanged');
    c.journal.data.operations = ['one', 'two'].map(id => ({ id, state: 'done', summaryPending: true, writes: [] }));
    c.retrySummary = vi.fn(async () => { c.journal.data.operations[0]!.summaryPending = false; });
    expect(await retryResult(asController(c))).toMatchObject({ outcome: 'warning', message: '1 summary update still pending.' });
    c.retrySummary = vi.fn(async () => { c.journal.data.operations[1]!.summaryPending = false; });
    expect(await retryResult(asController(c))).toMatchObject({ outcome: 'success', message: '1 pending summary update completed.' });
  });
  it('propagates action failures without inventing successful results', async () => {
    const c = controller(); c.retrySummary = vi.fn(async () => { throw new Error('Note changed'); });
    await expect(retryResult(asController(c))).rejects.toThrow('Note changed');
  });
  it('explains why edits stay waiting for a paused summary', async () => {
    const c = controller();
    c.journal.data.operations.push({ id: 'a', state: 'done', summaryPending: true, writes: [] });
    c.issues.set('summary-wait:old.md', '1 saved edit is waiting for old. Automatic updates to old are paused because ORG: 10m in the summary, 20m in your daily notes.');
    const result = await retryResult(asController(c));
    expect(result).toMatchObject({ outcome: 'warning', message: '1 summary update still pending.' });
    expect(result.details?.[0]).toMatch(/paused because ORG: 10m in the summary, 20m in your daily notes/);
  });
  it('keeps a failed retry visible', async () => {
    const c = controller(); c.retrySummary = vi.fn(async () => { throw new Error('Note changed'); });
    await expect(retryResult(asController(c))).rejects.toThrow('Note changed');
  });
  it('reports no-op undo and a genuinely restored operation', async () => {
    const c = controller(); expect((await undoResult(asController(c))).outcome).toBe('unchanged');
    expect(c.undo).not.toHaveBeenCalled(); c.journal.canUndo = true;
    expect((await undoResult(asController(c))).outcome).toBe('unchanged');
    c.journal.data.operations.push({ id: 'undo', state: 'done', writes: [] });
    c.undo = vi.fn(async () => { c.journal.data.operations[0]!.state = 'undone'; });
    expect((await undoResult(asController(c))).message).toBe('Last Planner operation undone.');
  });
  it('counts actual summary writes, excluding unchanged checkpoints and settings', async () => {
    const c = controller(); expect((await syncResult(asController(c))).outcome).toBe('unchanged');
    c.syncProjectRegistrations = vi.fn(async () => { c.journal.data.operations.push({ id: 'sync', state: 'done', writes: [
      { path: 'thejaz-summary.md', before: 'old', after: 'new' }, { path: 'checkpoint.md', before: 'same', after: 'same' },
      { path: '@settings', before: 'old', after: 'new' }
    ] }); });
    const result = await syncResult(asController(c)); expect(result.message).toBe('1 summary note updated.');
    expect(result.details).toEqual(['thejaz-summary.md']);
  });
  it('does not call an unresolved project sync fully synchronized', async () => {
    const c = controller(); c.issues.set('projects', 'No summary covers this date.');
    expect(await syncResult(asController(c))).toMatchObject({ outcome: 'warning', message: 'No summary notes changed. Some projects still need attention.', details: ['No summary notes were changed.', 'No summary covers this date.'] });
  });
});
