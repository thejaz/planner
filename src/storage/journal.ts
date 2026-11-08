import { applyPatches, Conflict, minimalDiff, rebase } from '../core/changes';
import type { Change, Patch } from '../core/model';
import { dateFromPath } from '../core/model';

export interface FilePort {
  read(path: string): Promise<string | null>;
  // compare-and-write must recheck the current editor/disk revision inside the operation.
  replace(path: string, expected: string | null, content: string): Promise<void>;
  removeCreated(path: string, expected: string): Promise<void>;
}
/** One replacement, at an offset in the prior text: [start, removed, inserted]. */
export type Edit = [number, string, string];
/**
 * One note write. In memory it usually holds both full texts. It is stored as edits:
 * with the prior text for daily and small notes, otherwise with only fingerprints of
 * both sides, so a loaded record may lack its texts until the current note supplies one side.
 */
export interface WriteRecord {
  path: string; state: 'prepared' | 'saved';
  before?: string | null; after?: string | null;
  edits?: Edit[];
  /** Fingerprints of the prior and resulting texts, kept when neither text is stored. */
  sides?: [string, string];
}
/** Notes up to this size keep their prior text in storage; larger ones keep only edits. */
const SMALL_NOTE = 8192;
/** Resolved history is kept within this many stored characters, dropping the oldest first. */
export const HISTORY_BUDGET = 1_000_000;
const patchesOf = (edits: Edit[]): Patch[] => edits.map(([start, removed, inserted]) => ({ start, end: start + removed.length, before: removed, after: inserted }));
const editsOf = (patches: Patch[]): Edit[] => [...patches].sort((a, b) => a.start - b.start).map(p => [p.start, p.before, p.after]);
/** The edits that turn the resulting text back into the prior one. */
function invertEdits(edits: Edit[]): Edit[] {
  let shift = 0;
  return [...edits].sort((a, b) => a[0] - b[0]).map(([start, removed, inserted]) => {
    const at = start + shift; shift += inserted.length - removed.length;
    return [at, inserted, removed];
  });
}
/** Whether the write changes its note (rather than only checking it). */
export function isChange(write: WriteRecord): boolean { return write.edits ? write.edits.length > 0 : write.before !== write.after; }
/**
 * Both texts of a write. A record stored without them is completed from `current`, the
 * note as it is now, when that equals one side: every use of old text (finishing, Undo,
 * Redo) requires exactly that, so the edits and fingerprints are enough.
 */
export function writeTexts(write: WriteRecord, current?: string | null): { before: string | null; after: string | null } | null {
  if (write.before !== undefined && write.after !== undefined) return { before: write.before, after: write.after };
  if (!write.edits) return null;
  try {
    if (typeof write.before === 'string') return { before: write.before, after: applyPatches(write.before, patchesOf(write.edits)) };
    if (typeof write.after === 'string') return { before: applyPatches(write.after, patchesOf(invertEdits(write.edits))), after: write.after };
    if (typeof current !== 'string' || !write.sides) return null;
    const seen = fingerprint(current);
    if (seen === write.sides[1]) return { before: applyPatches(current, patchesOf(invertEdits(write.edits))), after: current };
    if (seen === write.sides[0]) return { before: current, after: applyPatches(current, patchesOf(write.edits)) };
  } catch { /* Edits that no longer apply leave the text unknown. */ }
  return null;
}
/** The write that undoes `write`. */
function invert(write: WriteRecord): WriteRecord {
  const reversed: WriteRecord = { path: write.path, state: 'prepared' };
  if (write.before !== undefined && write.after !== undefined) { reversed.before = write.after; reversed.after = write.before; }
  if (write.edits) reversed.edits = invertEdits(write.edits);
  if (write.sides) reversed.sides = [write.sides[1], write.sides[0]];
  return reversed;
}
/** The stored form of a write: full text only where it is small or needed later. */
function storedWrite(write: WriteRecord): WriteRecord {
  const { path, state, before, after } = write;
  if (before === undefined || after === undefined) return write;
  // Settings, created/removed notes and unchanged checkpoints keep their exact text as evidence.
  if (before === null || after === null || before === after || path.startsWith('@')) return { path, state, before, after };
  const edits = write.edits ??= editsOf(minimalDiff(before, after));
  // Daily notes keep their prior text: footer ownership is read from it after later edits.
  if (dateFromPath(path) || before.length <= SMALL_NOTE) return { path, state, before, edits };
  return { path, state, edits, sides: [fingerprint(before), fingerprint(after)] };
}
function storedOperation(operation: Operation): Operation { return { ...operation, writes: operation.writes.map(storedWrite) }; }
const validText = (value: unknown) => value === undefined || value === null || typeof value === 'string';
function validWrite(write: WriteRecord): boolean {
  if (!write || typeof write.path !== 'string' || !validText(write.before) || !validText(write.after)) return false;
  if (write.edits !== undefined && !(Array.isArray(write.edits) && write.edits.every(e => Array.isArray(e) && e.length === 3 &&
    Number.isSafeInteger(e[0]) && e[0] >= 0 && typeof e[1] === 'string' && typeof e[2] === 'string'))) return false;
  if (write.sides !== undefined && !(Array.isArray(write.sides) && write.sides.length === 2 && write.sides.every(side => typeof side === 'string'))) return false;
  if (write.before !== undefined && write.after !== undefined) return true;
  if (!write.edits || (write.before === undefined && write.after === undefined && !write.sides)) return false;
  // A record with one stored side must reproduce the other.
  if (write.before === undefined && write.after === undefined) return true;
  const texts = writeTexts(write);
  if (!texts) return false;
  write.before = texts.before; write.after = texts.after;
  return true;
}
export interface Operation {
  id: string; time: number; label: string; writes: WriteRecord[];
  /**
   * Notes the operation depends on but does not change, by path, as text fingerprints.
   * A full copy of each would make every guarded write grow with the whole vault.
   */
  guards?: Record<string, string>;
  state: 'pending' | 'done' | 'undone' | 'interrupted'; summaryPending: boolean;
  undoOf?: string;
  redoOf?: string; redone?: boolean; redoBlocked?: boolean;
  resolution?: { time: number; reason: string };
}
/** Length plus two independent 32-bit hashes; only used to detect that a guarded note changed. */
export function fingerprint(text: string): string {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  return `${text.length.toString(36)}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}
/** Unchanged note snapshots recorded only to guard an operation; settings checkpoints (`@`) stay exact. */
function isNoteGuard(write: WriteRecord): boolean {
  return typeof write.before === 'string' && write.before === write.after && !write.path.startsWith('@');
}
/**
 * Older journals kept a full copy of every guarded note, repeated in each operation.
 * Replace those copies with fingerprints; actual writes and summary checkpoints stay unchanged.
 */
export function compactGuards(operation: Operation): void {
  if (isSummaryCheckpoint(operation) || !operation.writes.some(w => !isNoteGuard(w))) return;
  const written = new Set(operation.writes.filter(w => !isNoteGuard(w)).map(w => w.path));
  const guards = { ...operation.guards };
  for (const write of operation.writes) if (isNoteGuard(write) && !written.has(write.path)) guards[write.path] ??= fingerprint(write.before!);
  // A guard on a note the operation also writes is redundant: that write records its own prior text.
  operation.writes = operation.writes.filter(w => !isNoteGuard(w));
  if (Object.keys(guards).length) operation.guards = guards;
}
/** Only derived-total daily checkpoints may be retired without replaying writes. */
export function isSummaryCheckpoint(operation: Operation): boolean {
  return operation.summaryPending && !operation.undoOf && !operation.redoOf && operation.writes.length > 0 &&
    operation.writes.every(w => typeof w.before === 'string' && w.before === w.after && !w.path.startsWith('@') && !!dateFromPath(w.path));
}
export interface JournalData { version: 1; operations: Operation[] }
export class Journal {
  data: JournalData = { version: 1, operations: [] };
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private files: FilePort, private persist: (value: JournalData) => Promise<void>, private now = () => Date.now()) {}
  async load(value: unknown): Promise<void> {
    const candidate = value as Partial<JournalData> | null;
    if (candidate?.version === 1 && Array.isArray(candidate.operations)) {
      this.data = { version: 1, operations: candidate.operations.filter(o =>
        typeof o?.id === 'string' && Number.isFinite(o.time) && Array.isArray(o.writes) &&
        o.writes.every(validWrite)) };
    }
    for (const operation of this.data.operations) compactGuards(operation);
    // Only classify interrupted operations; loading never writes source notes.
    for (const operation of this.data.operations) {
      if (operation.state !== 'pending') continue;
      for (const write of operation.writes) {
        const current = await this.files.read(write.path);
        if ((await this.textsOf(write, current))?.after === current) write.state = 'saved';
      }
      operation.state = 'interrupted';
    }
    this.prune();
  }
  private prune(): void {
    // Retain unresolved operations even if old; silently dropping recovery evidence is unsafe.
    const unresolved = this.data.operations.filter(o => o.state === 'pending' || o.state === 'interrupted' || o.summaryPending);
    const resolved = this.data.operations.filter(o => !unresolved.includes(o) && (o.resolution?.time ?? o.time) >= this.now() - 30 * 86400000)
      .sort((a, b) => (a.resolution?.time ?? a.time) - (b.resolution?.time ?? b.time)).slice(-100);
    // A size budget bounds finished history, whatever a future change records; unresolved evidence is never dropped.
    const sizes = resolved.map(o => JSON.stringify(storedOperation(o)).length);
    let total = sizes.reduce((a, b) => a + b, 0), drop = 0;
    while (total > HISTORY_BUDGET && drop < resolved.length) total -= sizes[drop++]!;
    this.data.operations = [...new Set([...resolved.slice(drop), ...unresolved])].sort((a, b) => a.time - b.time);
  }
  async save(): Promise<void> { this.prune(); await this.persist({ version: 1, operations: this.data.operations.map(storedOperation) }); }
  /** Both texts of a write, completing a compact record from the current note when it matches one side. */
  private async textsOf(write: WriteRecord, current?: string | null): Promise<{ before: string | null; after: string | null } | null> {
    const known = writeTexts(write);
    if (known) return known;
    const texts = writeTexts(write, current === undefined ? await this.files.read(write.path) : current);
    if (texts) { write.before = texts.before; write.after = texts.after; }
    return texts;
  }
  /** Record an interruption without masking the failure that caused it. */
  private async interrupt(operation: Operation, error: unknown): Promise<never> {
    operation.state = 'interrupted';
    // If this save also fails, the durable copy still says pending, which load reclassifies as interrupted.
    try { await this.save(); } catch { /* Report the original failure. */ }
    throw error;
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => undefined);
    return result;
  }
  async perform(changes: Change[], label: string, summaryPending = false, guards: { path: string; text: string }[] = []): Promise<Operation | null> {
    return this.exclusive(async () => {
      const writes: WriteRecord[] = [], fingerprints: Record<string, string> = {};
      for (const guard of guards) {
        if (await this.files.read(guard.path) !== guard.text) throw new Conflict(`${guard.path} changed since the preview, so nothing was written. Open the preview again.`);
        if (changes.some(c => c.path === guard.path)) continue;
        if (guard.path.startsWith('@')) writes.push({ path: guard.path, before: guard.text, after: guard.text, state: 'prepared' });
        else fingerprints[guard.path] = fingerprint(guard.text);
      }
      for (const change of changes) {
        const before = await this.files.read(change.path);
        if (before === null) throw new Conflict('This note was removed or renamed, so nothing was written.');
        const guard = guards.find(g => g.path === change.path);
        if (guard && before !== guard.text) throw new Conflict(`${change.path} changed while the change was being prepared, so nothing was written. Try again.`);
        const patches = rebase(change, before), after = applyPatches(before, patches);
        // A manual edit may leave the footer unchanged while still requiring a
        // summary update. Keep a checked source snapshot so retry survives restart.
        if (before !== after) writes.push({ path: change.path, before, after, edits: editsOf(patches), state: 'prepared' });
        else if (summaryPending) writes.push({ path: change.path, before, after, state: 'prepared' });
      }
      if (!writes.length) return null;
      return this.commit(writes, label, summaryPending, undefined, undefined, fingerprints);
    });
  }
  async create(path: string, content: string): Promise<Operation> {
    return this.exclusive(async () => {
      if (await this.files.read(path) !== null) throw new Conflict('This day already exists; open it instead.');
      return this.commit([{ path, before: null, after: content, state: 'prepared' }], 'Create day', false);
    });
  }
  private finishLinks(operation: Operation): void {
    if (operation.undoOf) {
      const parent = this.data.operations.find(o => o.id === operation.undoOf);
      if (parent) { parent.state = 'undone'; parent.summaryPending = false; }
    }
    if (operation.redoOf) {
      const inverse = this.data.operations.find(o => o.id === operation.redoOf);
      if (inverse) inverse.redone = true;
    }
  }
  /** Whether every guarded note still has the text the operation depended on. */
  private async checkGuards(guards: Record<string, string> | undefined, problem: (path: string) => string): Promise<void> {
    for (const [path, expected] of Object.entries(guards ?? {})) {
      const current = await this.files.read(path);
      if (current === null || fingerprint(current) !== expected) throw new Conflict(problem(path));
    }
  }
  private async commit(writes: WriteRecord[], label: string, summaryPending: boolean, undoOf?: string, redoOf?: string, guards: Record<string, string> = {}): Promise<Operation> {
    if (!undoOf && !redoOf) for (const op of this.data.operations) if (op.undoOf) op.redoBlocked = true;
    const operation: Operation = { id: crypto.randomUUID(), time: this.now(), label, writes, state: 'pending', summaryPending, undoOf, redoOf };
    if (Object.keys(guards).length) operation.guards = guards;
    this.data.operations.push(operation);
    await this.save(); // Recovery evidence must reach storage before any note mutation.
    try {
      await this.checkGuards(operation.guards, path => `${path} changed while saving, so nothing was written. Try again.`);
      for (const write of writes) {
        await this.write(write);
        write.state = 'saved';
        // The complete intent is already durable. Read-only source checkpoints
        // need no separate disk snapshot each; load can verify them unchanged.
        if (isChange(write)) await this.save();
      }
      operation.state = 'done';
      this.finishLinks(operation);
      await this.save();
      return operation;
    } catch (error) { return this.interrupt(operation, error); }
  }
  private async write(write: WriteRecord): Promise<void> {
    const texts = await this.textsOf(write);
    if (!texts) throw new Conflict(`${write.path} was edited since this change was recorded, so nothing was written.`);
    const { before, after } = texts;
    if (before === after) {
      if (await this.files.read(write.path) !== before) throw new Conflict('The note changed before its summary check, so nothing was written.');
      return;
    }
    if (after === null) {
      if (before === null) throw new Error('An empty recovery operation is invalid.');
      await this.files.removeCreated(write.path, before);
    } else await this.files.replace(write.path, before, after);
  }
  /** Whether the note currently holds the write's resulting text. */
  private async applied(write: WriteRecord, current?: string | null): Promise<boolean> {
    if (current === undefined) current = await this.files.read(write.path);
    return (await this.textsOf(write, current))?.after === current;
  }
  async retry(operation: Operation): Promise<void> {
    return this.exclusive(async () => {
      // Verify the latest acknowledged value for each file before resuming.
      const byPath = new Map<string, WriteRecord[]>();
      for (const write of operation.writes) byPath.set(write.path, [...(byPath.get(write.path) ?? []), write]);
      // Unfinished writes that later work already brought to their intended text need no replay.
      const unfinished = operation.writes.filter(w => w.state === 'prepared');
      let present = unfinished.length > 0;
      for (const write of unfinished) if (present && !await this.applied(write)) present = false;
      if (present) {
        for (const write of unfinished) write.state = 'saved';
        operation.state = 'done'; this.finishLinks(operation);
        operation.resolution = { time: this.now(), reason: 'Every unfinished write was already present in the current notes; nothing was replayed.' };
        await this.save(); return;
      }
      for (const [path, writes] of byPath) {
        const expected = writes.find(w => w.state === 'prepared') ?? writes.at(-1)!;
        const current = await this.files.read(path), texts = await this.textsOf(expected, current);
        if (!texts || (current !== texts.after && (expected.state === 'saved' || current !== texts.before)))
          throw new Conflict(`${path} was edited after this change stopped. Finishing now could overwrite that edit, so nothing was written.`);
      }
      await this.checkGuards(operation.guards, path => `${path} was edited after this change stopped. Finishing now could overwrite that edit, so nothing was written.`);
      operation.state = 'pending'; await this.save();
      try {
        for (const write of operation.writes) {
          if (write.state === 'saved') continue;
          if (!await this.applied(write)) await this.write(write);
          write.state = 'saved'; await this.save();
        }
        operation.state = 'done';
        this.finishLinks(operation);
        await this.save();
      } catch (error) { await this.interrupt(operation, error); }
    });
  }
  async append(operation: Operation, change: Change, guards: { path: string; text: string }[] = []): Promise<void> {
    return this.exclusive(async () => {
      const before = await this.files.read(change.path);
      if (before === null) throw new Conflict('The summary was removed or renamed.');
      const patches = rebase(change, before), after = applyPatches(before, patches);
      if (after === before) return;
      const checkpoints: WriteRecord[] = [], fingerprints: Record<string, string> = {};
      for (const guard of guards) {
        const latest = operation.writes.filter(w => w.path === guard.path && w.state === 'saved').at(-1);
        const expected = latest ? (await this.textsOf(latest))?.after : guard.text;
        if (await this.files.read(guard.path) !== expected) throw new Conflict(`${guard.path} changed during this change, so it was stopped before writing.`);
        if (latest || guard.path === change.path || operation.guards?.[guard.path]) continue;
        if (guard.path.startsWith('@')) checkpoints.push({ path: guard.path, before: guard.text, after: guard.text, state: 'prepared' });
        else fingerprints[guard.path] = fingerprint(guard.text);
      }
      const write: WriteRecord = { path: change.path, before, after, edits: editsOf(patches), state: 'prepared' };
      const guarded = { ...operation.guards, ...fingerprints };
      // The write records this note's prior text itself.
      delete guarded[change.path];
      if (Object.keys(guarded).length) operation.guards = guarded; else delete operation.guards;
      operation.writes.push(...checkpoints, write); operation.state = 'pending';
      await this.save();
      try {
        // Checkpoints only verify unchanged text; the intent above is already durable.
        for (const checkpoint of checkpoints) { await this.write(checkpoint); checkpoint.state = 'saved'; }
        await this.checkGuards(fingerprints, path => `${path} changed during this change, so it was stopped before writing.`);
        await this.files.replace(write.path, before, after);
        write.state = 'saved'; operation.state = 'done';
        await this.save();
      } catch (error) { await this.interrupt(operation, error); }
    });
  }
  async finishSummary(operation: Operation): Promise<void> {
    operation.summaryPending = false;
    if (operation.writes.every(w => w.state === 'saved')) operation.state = 'done';
    await this.save();
  }
  async resolveCheckpoint(operation: Operation, guards: { path: string; text: string }[], checkScope: () => void): Promise<void> {
    return this.exclusive(async () => {
      if (!this.data.operations.includes(operation) || !isSummaryCheckpoint(operation) ||
        !['pending', 'interrupted', 'done'].includes(operation.state)) throw new Conflict('This operation is not an unchanged daily summary checkpoint.');
      for (const write of operation.writes) if (!guards.some(g => g.path === write.path)) throw new Conflict('A daily source was not verified.');
      for (const guard of guards) if (await this.files.read(guard.path) !== guard.text) throw new Conflict(`${guard.path} changed while checking. Choose Check again.`);
      checkScope();
      const previous = { state: operation.state, summaryPending: operation.summaryPending, resolution: operation.resolution };
      operation.state = 'done'; operation.summaryPending = false;
      operation.resolution = { time: this.now(), reason: 'Current daily sources and their owning summaries verified; obsolete read-only checkpoint retired without replaying source.' };
      try { await this.save(); }
      catch (error) { Object.assign(operation, previous); throw error; }
    });
  }
  async undo(): Promise<Operation | null> {
    return this.exclusive(async () => {
      const operation = [...this.data.operations].reverse().find(o => !o.undoOf && o.state !== 'undone' && o.writes.some(w => w.state === 'saved' && isChange(w)));
      if (!operation) return null;
      const writes = operation.writes.filter(w => w.state === 'saved');
      // Check the entire group first. A conflict must not cause a partial undo.
      const final = new Map<string, WriteRecord>();
      for (const write of writes) final.set(write.path, write);
      for (const write of final.values()) if (!await this.applied(write))
        throw new Conflict(`Cannot undo: ${write.path} was edited afterwards, and undoing would overwrite that edit.`);
      await this.checkGuards(operation.guards, path => `Cannot undo: ${path} was edited afterwards, and undoing would overwrite that edit.`);
      const inverse = [...writes].reverse().map(invert);
      await this.commit(inverse, `Undo: ${operation.label}`, false, operation.id, undefined, operation.guards);
      return operation;
    });
  }
  get canUndo(): boolean {
    return this.data.operations.some(o => !o.undoOf && o.state !== 'undone' && o.writes.some(w => w.state === 'saved' && isChange(w)));
  }
  private redoCandidate(): Operation | undefined {
    if (this.data.operations.some(o => (o.undoOf || o.redoOf) && (o.state === 'pending' || o.state === 'interrupted'))) return undefined;
    return [...this.data.operations].reverse().find(o => o.undoOf && o.state === 'done' && !o.redone && !o.redoBlocked);
  }
  get canRedo(): boolean { return !!this.redoCandidate(); }
  async redo(): Promise<Operation | null> {
    return this.exclusive(async () => {
      const inverse = this.redoCandidate();
      if (!inverse) return null;
      const writes = inverse.writes.filter(w => w.state === 'saved');
      const final = new Map<string, WriteRecord>();
      for (const write of writes) final.set(write.path, write);
      for (const write of final.values()) if (!await this.applied(write))
        throw new Conflict(`Cannot redo: ${write.path} was edited after Undo, and redoing would overwrite that edit.`);
      await this.checkGuards(inverse.guards, path => `Cannot redo: ${path} was edited after Undo, and redoing would overwrite that edit.`);
      const forward = [...writes].reverse().map(invert);
      return this.commit(forward, `Redo: ${inverse.label.replace(/^Undo: /, '')}`, false, undefined, inverse.id, inverse.guards);
    });
  }
}
