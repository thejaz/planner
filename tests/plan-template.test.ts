import { describe, expect, it } from 'vitest';
import { applyPatches, rebase } from '../src/core/changes';
import { replacePlan } from '../src/core/plan-template';
import { calculate, parseDay } from '../src/core/reader';
import { parseSummary, summaryPatches } from '../src/core/history';
import { Journal } from '../src/storage/journal';
import type { JournalData } from '../src/storage/journal';

const datePath = '2026-10-21.md';
const current = '## plan for 21.10.26\n\nPersonal introduction **keep**.\n\n### morning\n\n- [x] 09:30 (30) : chp\nA handwritten annotation.\n- [ ] 10:00 (30) : mdr\n\n### afternoon\n\n- [ ] 14:00 (60) : hay\n\n---\n\nCHP = 30\nMDR = 0\nSUM = 30\n\n[^1]: Preserve my reference.\n';
const routine = '```\n## plan for ??.??.26\n\n### morning\n- [x] 08:00 (n/a) : awake\n- [x] 10:00 (90/120) : mdr\n### afternoon\n- [ ] 14:30 (60) : hay\n### evening\n- [ ] ?\n\nMDR = 999\nSUM = 999\n```';
const replacement = (text = current, template = routine) => replacePlan(parseDay(text, datePath), template);

describe('replace an existing plan from a template', () => {
  it('replaces every activity, clears completed credit and preserves ordinary prose and the template', () => {
    const plan = replacement();
    expect([plan.removed, plan.completed, plan.added]).toEqual([3, 1, 4]);
    const next = applyPatches(current, plan.change.patches), day = parseDay(next, datePath);
    expect(day.entries.map(e => [e.checked, e.time, e.duration, e.label])).toEqual([
      [false, '08:00', 'n/a', 'awake'], [false, '10:00', '90/120', 'mdr'],
      [false, '14:30', '60', 'hay'], [false, null, '?', '?']
    ]);
    expect(day.recordedSum).toBe(0); expect(day.recorded.CHP).toBe(0);
    expect(calculate(day).planned).toEqual({ MDR: 90, HAY: 60 });
    for (const text of ['Personal introduction **keep**.', 'A handwritten annotation.', '[^1]: Preserve my reference.', '## plan for 21.10.26']) expect(next).toContain(text);
    expect(next).not.toContain('```'); expect(routine).toContain('- [x] 10:00');
  });
  it('retains CRLF, exact surrounding prose, and code-fenced checklists', () => {
    const code = '```md\r\n### example\r\n- [x] 10:00 (999) : chp\r\n```\r\n';
    const raw = current.replaceAll('\n', '\r\n') + code;
    const next = applyPatches(raw, replacement(raw).change.patches);
    expect(next).toContain('Personal introduction **keep**.\r\n\r\n### morning\r\n');
    expect(next).toContain('A handwritten annotation.\r\n');
    expect(next.endsWith(code)).toBe(true);
    expect(next.replaceAll('\r\n', '')).not.toContain('\n');
  });
  it('fills an empty section, creates missing sections and ordinary totals without losing the final note', () => {
    const raw = '## plan for 21.10.26\n### morning\n\nMy note at EOF';
    const next = applyPatches(raw, replacement(raw).change.patches);
    expect(next).toContain('### morning\n\n- [ ] 08:00');
    expect(next).toContain('### afternoon\n\n- [ ] 14:30');
    expect(next).toContain('### evening\n\n- [ ] ?');
    expect(next).toContain('My note at EOF'); expect(next).toContain('SUM = 0');
  });
  it('preserves literal zeroes and template-specific project definitions', () => {
    const template = '### morning\n- [x] 10:00 (0) : pln\nPLN = 123\nSUM = 123';
    const next = applyPatches(current, replacement(current, template).change.patches);
    const day = parseDay(next, datePath);
    expect(day.recorded.PLN).toBe(0); expect(day.entries[0]!.duration).toBe('0');
    expect(day.entries[0]!.unknownCredit).toBe(false); expect(day.entries[0]!.checked).toBe(false);
    expect(next).not.toContain('123');
  });
  it('supports a deliberate blank plan and a final unterminated activity', () => {
    const blank = replacement(current, '### morning\n### afternoon\n### evening');
    const next = parseDay(applyPatches(current, blank.change.patches), datePath);
    expect(next.entries).toEqual([]); expect(next.recordedSum).toBe(0);
    const raw = '- [x] 10:00 (30) : chp';
    const after = applyPatches(raw, replacement(raw, '- [ ] 11:00 (60) : mdr').change.patches);
    expect(after).toContain('- [ ] 11:00 (60) : mdr'); expect(after).toContain('SUM = 0');
  });
  it.each([
    ['### morning\n- [ ] 25:00 (30) : chp', 'not a valid time'],
    ['### morning\n- [ ] 11:00 (30) : chp\n- [ ] 10:00 (30) : mdr', 'earlier than the activity before it'],
    ['### morning\n### morning', 'unique heading'],
    ['## plan for a\n## plan for b', 'one daily plan'],
    ['Total CHP Time: 1h', 'current end-time']
  ])('rejects an ambiguous or invalid template before writing: %s', (template, message) => {
    expect(() => replacement(current, template)).toThrow(message);
  });
  it('rejects older daily formats, malformed totals, ambiguous sections and unchanged plans', () => {
    expect(() => replacement('- [x] 09:00 - 10:00 : chp\nTotal CHP Time: 1h')).toThrow('older format');
    expect(() => replacement(current.replace('SUM = 30', '??? : SUM'))).toThrow('cannot be read');
    expect(() => replacement(current.replace('### afternoon', '### morning'))).toThrow('unique heading');
    const once = replacement(), after = applyPatches(current, once.change.patches);
    expect(() => replacement(after)).toThrow('already matches');
  });
  it('stops if the previewed day was edited in the meantime', () => {
    const plan = replacement();
    expect(() => rebase(plan.change, current.replace('A handwritten annotation.', 'Edited while previewing.'))).toThrow('changed elsewhere');
    expect(() => rebase(plan.change, current.replace('(30) : chp', '(40) : chp'))).toThrow('changed elsewhere');
  });
  it('journals replacement and summary together, then restores exact bytes after reload with undo and redo', async () => {
    const summary = '### Days\n2026-10-21 = 30 🦥\n### Projects\nCHP = 30\nMDR = 0\n### Results\nDays (2026-10-21 - 2026-10-21): 1d\n';
    const files = new Map([[datePath, current], ['summary.md', summary]]);
    let saved: JournalData | undefined;
    const port = {
      read: async (path: string) => files.get(path) ?? null,
      replace: async (path: string, expected: string | null, text: string) => {
        if (files.get(path) !== expected) throw new Error('Concurrent edit'); files.set(path, text);
      },
      removeCreated: async () => { throw new Error('Replacement must never remove the daily note'); }
    };
    const persist = async (value: JournalData) => { saved = structuredClone(value); };
    const journal = new Journal(port, persist), plan = replacement();
    const operation = await journal.perform([plan.change], plan.change.label, true);
    const day = parseDay(files.get(datePath)!, datePath);
    const update = summaryPatches(parseSummary(summary, 'summary.md'), [day], '2026-10-21', new Set(['2026-10-21']));
    await journal.append(operation!, { path: 'summary.md', base: summary, patches: update.patches, label: 'Update summary' });
    await journal.finishSummary(operation!);
    expect(files.get('summary.md')).toContain('2026-10-21 = 0');
    const after = new Map(files), restarted = new Journal(port, persist); await restarted.load(saved);
    await restarted.undo(); expect(files.get(datePath)).toBe(current); expect(files.get('summary.md')).toBe(summary);
    await restarted.redo(); expect(files).toEqual(after);
  });
});
