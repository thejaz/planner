import { describe, expect, it } from 'vitest';
import { applyPatches } from '../src/core/changes';
import { materialPatches, parseSummary, recordedReviewRows, summaryBests, summaryPatches } from '../src/core/history';
import { parseDay } from '../src/core/reader';
import { dayRecords, earlierBests, markRecord, recordsSetOn, TOTAL_RECORD } from '../src/core/records';

const day = (date: string, minutes: number, code = 'STD') => parseDay(`## plan for x\n### morning\n- [x] 08:00 (n/a) : awake\n- [x] 23:00 (${minutes}) : ${code.toLowerCase()}\n\n---\n\n${code} = ${minutes}\nSUM = ${minutes}\n`, `${date}.md`, [code, 'PRJ']);

describe('day records', () => {
  it('keeps the best day per project and overall, with the best it beat', () => {
    const rows = recordedReviewRows([day('2026-09-01', 300), day('2026-09-02', 460), day('2026-09-03', 460), day('2026-09-04', 90, 'PRJ'), day('2026-09-05', 635)]);
    const records = dayRecords(rows, ['STD', 'PRJ']);
    expect(records.get('STD')).toEqual({ code: 'STD', minutes: 635, date: '2026-09-05', previous: { minutes: 460, date: '2026-09-02' } });
    expect(records.get(TOTAL_RECORD)?.date).toBe('2026-09-05');
    expect(records.get('PRJ')).toMatchObject({ minutes: 90, previous: null });
    expect([...recordsSetOn(records, '2026-09-05', true)].sort()).toEqual(['STD', 'SUM']);
    expect([...recordsSetOn(records, '2026-09-04', true)]).toEqual([]);
    expect([...recordsSetOn(records, '2026-09-04')]).toEqual(['PRJ']);
  });
  it('gives each date the best of the days before it', () => {
    const bests = earlierBests(recordedReviewRows([day('2026-09-01', 300), day('2026-09-02', 0), day('2026-09-03', 400)]));
    expect([...bests]).toEqual([['2026-09-01', null], ['2026-09-02', 300], ['2026-09-03', 300]]);
  });
  it('adds and removes only the record mark', () => {
    const hardBreak = '2026-09-05 = 635  ';
    expect(markRecord(hardBreak, true)).toBe('2026-09-05 = 635 ==new record==  ');
    expect(markRecord(markRecord(hardBreak, true), false)).toBe(hardBreak);
    expect(markRecord('**2026-09-05 = 635 🔥**', true)).toBe('**2026-09-05 = 635 🔥** ==new record==');
    expect(markRecord('2026-09-05 = 635 🔥 ==new record== note', false)).toBe('2026-09-05 = 635 🔥 note');
    expect(markRecord('2026-09-05 = 635 🔥 ==new record==', true)).toBe('2026-09-05 = 635 🔥 ==new record==');
  });
});

describe('new records in summaries', () => {
  const text = (rows: string) => `### Days\n${rows}\n\n### Projects\nSTD = 0\n\nDays (2026-09-01 - 2026-09-30)\n`;
  const days = [day('2026-09-01', 300), day('2026-09-02', 460), day('2026-09-03', 390), day('2026-09-05', 635)];
  it('uses an older summary-only best and counts the freshly read target once', () => {
    const archive = parseSummary('### Days (2025-01-01 - 2025-12-31)\n2025-09-01 = 500 🔥\n', 'archive.md');
    const current = parseSummary(text('2026-09-04 = 610 🔥'), 'current.md');
    const stale = parseSummary(text('2026-09-04 = 900 🔥'), current.path);
    const bests = summaryBests(current, days, [archive, stale]);
    expect(bests.get('2026-09-02')).toBe(500);
    expect(bests.get('2026-09-05')).toBe(610);
    const update = summaryPatches(current, days, '2026-09-05', new Set(['2026-09-02', '2026-09-05']), false, undefined, () => bests);
    const rows = applyPatches(current.text, update.patches);
    expect(rows).toContain('2026-09-02 = 460 🔥\n');
    expect(rows).toContain('2026-09-05 = 635 🔥 ==new record==');
  });
  it('marks a day above every earlier day, on update and on insertion', () => {
    const source = text('2026-09-01 = 300 🔥\n2026-09-02 = 400 🔥\n2026-09-03 = 390 🔥');
    const update = summaryPatches(parseSummary(source, 's.md'), days, '2026-09-05', new Set(['2026-09-02', '2026-09-05']));
    const next = applyPatches(source, update.patches);
    expect(next).toContain('2026-09-02 = 460 🔥 ==new record==');
    expect(next).toContain('2026-09-03 = 390 🔥\n');
    expect(next).toContain('2026-09-05 = 635 🔥 ==new record==');
    expect(next).not.toContain('2026-09-01 = 300 🔥 ==');
  });
  it('removes a stale mark only when that day is updated, and a missing mark is not a disagreement', () => {
    const marked = text('2026-09-01 = 300 🔥\n2026-09-02 = 460 🔥 ==new record==\n2026-09-03 = 390 🔥 ==new record==\n2026-09-05 = 635 🔥');
    const reconcile = summaryPatches(parseSummary(marked, 's.md'), days, '2026-09-05', new Set(), true);
    const after = applyPatches(marked, reconcile.patches);
    expect(after).toContain('2026-09-03 = 390 🔥 ==new record=='); // kept: not its own update
    expect(after).toContain('2026-09-05 = 635 🔥 ==new record==');
    expect(materialPatches(reconcile.patches.filter(p => /2026-09-0[35]/.test(p.before)))).toEqual([]);
    const own = summaryPatches(parseSummary(marked, 's.md'), days, '2026-09-05', new Set(['2026-09-03']));
    expect(applyPatches(marked, own.patches)).toContain('2026-09-03 = 390 🔥\n');
  });
});

describe('new records with iterators and highlighted rows', () => {
  const text = (rows: string) => `### Days\n${rows}\n\n### Projects\nSTD = 0\n\nDays (2026-09-01 - 2026-09-30)\n`;
  it('reads a one-shot iterator of days once, for totals and records alike', () => {
    const days = [day('2026-09-01', 300), day('2026-09-02', 460)];
    const source = text('2026-09-01 = 300 🔥\n2026-09-02 = 0');
    const update = summaryPatches(parseSummary(source, 's.md'), days.values(), '2026-09-02', new Set(['2026-09-02']));
    expect(applyPatches(source, update.patches)).toContain('2026-09-02 = 460 🔥 ==new record==');
  });
  it('preserves a Markdown hard break through a summary update and a second pass', () => {
    const low = [day('2026-09-01', 5), day('2026-09-02', 10)];
    const source = text('2026-09-01 = 5\n2026-09-02 = 0  ');
    const update = (raw: string) => summaryPatches(parseSummary(raw, 's.md'), low, '2026-09-02', new Set(['2026-09-02']));
    const saved = applyPatches(source, update(source).patches);
    expect(saved).toContain('==2026-09-02 = 10 😣== ==new record==  \n');
    expect(update(saved).patches).toEqual([]);
  });
  it('keeps the low-day highlight and the mark apart, and is stable on a second pass', () => {
    const low = [day('2026-09-01', 5), day('2026-09-02', 10)];
    const source = text('2026-09-01 = 5\n2026-09-02 = 0');
    const once = applyPatches(source, summaryPatches(parseSummary(source, 's.md'), low, '2026-09-02', new Set(['2026-09-01', '2026-09-02'])).patches);
    const row = once.split('\n').find(line => line.includes('2026-09-02'))!;
    expect(row).toMatch(/^==2026-09-02 = 10 😣== ==new record==$/);
    expect(summaryPatches(parseSummary(once, 's.md'), low, '2026-09-02', new Set(['2026-09-02'])).patches).toEqual([]);
    const risen = [day('2026-09-01', 5), day('2026-09-02', 40)];
    const again = applyPatches(once, summaryPatches(parseSummary(once, 's.md'), risen, '2026-09-02', new Set(['2026-09-02'])).patches);
    expect(again.split('\n').find(line => line.includes('2026-09-02'))).toBe('2026-09-02 = 40 🦥 ==new record==');
  });
});
