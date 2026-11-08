import { describe, expect, it } from 'vitest';
import { materialPatches, parseSummary, summaryPatches, summaryTotals } from '../src/core/history';
import type { Summary } from '../src/core/history';
import { parseDay } from '../src/core/reader';
import type { Day } from '../src/core/model';
import { summaryForDate } from '../src/core/project-registry';
import { differenceLine, projectDifferences, settlePending, TotalsMemo, waitingMessage } from '../src/core/summary-totals';

const day = (date: string, minutes: number) => parseDay(`## recorded totals\nCHP = ${minutes}\nSUM = ${minutes}\n`, `${date}.md`, ['CHP']);
const period = (rows: string, chp: number, days = 'Days (2026-10-01 - 2026-10-03)') =>
  parseSummary(`### ${days}\n${rows}### Projects\nCHP = ${chp}\n**Actual Sum:** 3h (1.00h/d over 3d)\n`, 'thejaz-summary-now.md');
const days = [day('2026-10-01', 60), day('2026-10-02', 30), day('2026-10-03', 90)];
const rows = '2026-10-01 = 60 🦥\n2026-10-02 = 30 🦥\n2026-10-03 = 90 🦥\n';
const matching = () => period(rows, 180);
/** Project totals that differ from the notes, as when automatic updates are paused. */
const mismatched = () => period(rows, 999);
/** A period running past the recorded days, so some days still need fixing. */
const unfinished = () => period(rows, 180, 'Days (2026-10-01 - 2026-10-05)');

/** The per-edit loop as it was: totals worked out again for every edit. */
async function reference(edits: Set<string>[], sources: () => Summary[], dayList: () => Day[], through: string, finish: (i: number) => Promise<void>) {
  for (const [i, dates] of edits.entries()) {
    if (!dates.size) continue;
    const owners = new Map<Summary, Set<string>>(); let blocked = false;
    for (const date of dates) {
      try { const owner = summaryForDate(date, sources()); owners.set(owner, new Set([...(owners.get(owner) ?? []), date])); }
      catch { blocked = true; }
    }
    if (!blocked && [...owners].every(([owner, owned]) => {
      const scoped = summaryPatches(owner, dayList(), through, owned);
      return !materialPatches(scoped.patches).length && !scoped.issues.length;
    })) await finish(i);
  }
}

describe('shared summary totals', () => {
  const cases: [string, Summary, string, Set<string>, boolean][] = [
    ['changed dates', mismatched(), '2026-10-03', new Set(['2026-10-02']), false],
    ['reconcile', mismatched(), '2026-10-03', new Set(), true],
    ['a stale row', period('2026-10-01 = 60\n2026-10-02 = 45\n', 180), '2026-10-03', new Set(['2026-10-02', '2026-10-03']), false],
    ['no Days line', parseSummary('### Projects\nCHP = 1\n', 'thejaz-summary-now.md'), '2026-10-03', new Set(['2026-10-02']), true],
    ['through before the start', matching(), '2026-09-30', new Set(['2026-10-01']), true],
    ['retired syntax', period('', 180, 'Days (01.10.26 - 03.10.26)'), '2026-10-03', new Set(), true],
    ['days still needing fixes', unfinished(), '2026-10-05', new Set(), true]
  ];
  it.each(cases)('gives identical patches and messages with precomputed totals: %s', (_, summary, through, dates, reconcile) => {
    const without = summaryPatches(summary, days, through, dates, reconcile);
    expect(summaryPatches(summary, days, through, dates, reconcile, summaryTotals(summary, days, through) ?? undefined)).toEqual(without);
    expect(new TotalsMemo(() => days, through).patches(summary, dates, reconcile)).toEqual(without);
  });
  it('covers an incomplete period with its "still need fixing" message', () => {
    expect(summaryPatches(unfinished(), days, '2026-10-05', new Set(), true).issues.join(' ')).toMatch(/still need fixing/);
  });
  it('keeps the repair message for a retired period too long to total', () => {
    const retired = parseSummary('### Days (01.01.1900 - 01.01.2026)\n### Projects\nCHP = 1\n', 'thejaz-summary-now.md');
    const expected = summaryPatches(retired, days, '2026-10-27', new Set(), true);
    expect(expected.issues[0]).toMatch(/Write the Days line with full dates/);
    expect(summaryTotals(retired, days, '2026-10-27')).toBeNull();
    expect(new TotalsMemo(() => days, '2026-10-27').patches(retired, new Set(), true)).toEqual(expected);
  });
  it('remembers a summary without a period instead of computing it again', () => {
    let calls = 0;
    const memo = new TotalsMemo(() => days, '2026-10-03', (...args) => { calls++; return summaryTotals(...args); });
    const undated = parseSummary('### Projects\nCHP = 1\n', 'thejaz-summary-now.md');
    expect(memo.get(undated)).toBeUndefined(); expect(memo.get(undated)).toBeUndefined();
    expect(calls).toBe(1);
  });
  it.each([0, 40, 100])('works out unchanged totals once for %i pending edits, with the same outcome', async count => {
    const summary = mismatched(), edits = Array.from({ length: count }, (_, i) => new Set([`2026-10-0${1 + (i % 3)}`]));
    let calls = 0;
    const memo = new TotalsMemo(() => days, '2026-10-03', (...args) => { calls++; return summaryTotals(...args); });
    memo.patches(summary, new Set(), true);
    const finished: number[] = [], expected: number[] = [];
    await settlePending(edits.map((dates, i) => ({ dates, i })), e => e.dates, () => [summary], memo, e => { finished.push(e.i); return Promise.resolve(); });
    await reference(edits, () => [summary], () => days, '2026-10-03', i => { expected.push(i); return Promise.resolve(); });
    expect(finished).toEqual(expected); expect(finished).toEqual([]);
    expect(calls).toBe(1);
  });
  it('finishes matching edits exactly as before', async () => {
    const summary = matching(), edits = [new Set(['2026-10-01']), new Set<string>(), new Set(['2026-11-01']), new Set(['2026-10-03'])];
    const finished: number[] = [], expected: number[] = [];
    const memo = new TotalsMemo(() => days, '2026-10-03');
    await settlePending(edits.map((dates, i) => ({ dates, i })), e => e.dates, () => [summary], memo, e => { finished.push(e.i); return Promise.resolve(); });
    await reference(edits, () => [summary], () => days, '2026-10-03', i => { expected.push(i); return Promise.resolve(); });
    expect(finished).toEqual(expected); expect(finished).toEqual([0, 3]);
  });
  it('lists differing project totals with both figures, including unlisted projects', () => {
    const memo = new TotalsMemo(() => days, '2026-10-03');
    expect(projectDifferences(mismatched(), memo.get(mismatched()))).toEqual([{ code: 'CHP', summary: 999, notes: 180 }]);
    expect(projectDifferences(matching(), memo.get(matching()))).toEqual([]);
    // Unknown days leave project totals unsettled, so nothing is reported as differing.
    expect(projectDifferences(unfinished(), new TotalsMemo(() => days, '2026-10-05').get(unfinished()))).toEqual([]);
    const both = new TotalsMemo(() => [day('2026-10-01', 60), day('2026-10-03', 90), parseDay('## recorded totals\nCHP = 5\nORG = 25\nSUM = 30\n', '2026-10-02.md', ['CHP', 'ORG'])], '2026-10-03');
    expect(projectDifferences(matching(), both.get(matching()))).toEqual([{ code: 'CHP', summary: 180, notes: 155 }, { code: 'ORG', summary: null, notes: 25 }]);
  });
  it('explains a paused summary with both numbers, the waiting count and why Retry cannot help', () => {
    const paused = [{ code: 'ORG', summary: 6325, notes: 6410 }, { code: 'PLN', summary: 1083, notes: 1000 }, { code: 'NEW', summary: null, notes: 30 }];
    expect(differenceLine(paused[0]!)).toBe('ORG: 6,325m in the summary, 6,410m in your daily notes (85m more in the notes)');
    expect(differenceLine(paused[1]!)).toBe('PLN: 1,083m in the summary, 1,000m in your daily notes (83m less in the notes)');
    expect(differenceLine(paused[2]!)).toBe('NEW: not in the summary, 30m in your daily notes');
    const message = waitingMessage('2025-summary.md', 40, paused, false);
    expect(message).toMatch(/^40 saved edits are waiting for 2025-summary\.md\. Automatic updates to 2025-summary\.md are paused/);
    expect(message).toContain('ORG: 6,325m in the summary, 6,410m in your daily notes');
    expect(message).toContain('Retry summary update cannot finish these until the totals agree.');
    expect(waitingMessage('s.md', 0, paused, false)).not.toMatch(/waiting|Retry/);
    expect(waitingMessage('s.md', 1, [], true)).toBe('1 saved edit is waiting for s.md. Some days in its period need fixing first. Choose Review summary; each day has its own button.');
    expect(waitingMessage('s.md', 2, [], false)).toBe('2 saved edits are waiting for s.md. Choose Retry summary update to add them; if they still wait, choose Review summary.');
    expect(waitingMessage('s.md', 1, [], false)).toBe('1 saved edit is waiting for s.md. Choose Retry summary update to add it; if it still waits, choose Review summary.');
  });
  it('uses fresh totals after a finish lets the notes change', async () => {
    // While the first edit's finish is saved, another note is read in and no longer matches.
    const run = async (settle: (list: () => Day[], finish: (i: number) => Promise<void>) => Promise<void>) => {
      let list = [...days];
      const finished: number[] = [];
      await settle(() => list, i => { finished.push(i); list = [day('2026-10-01', 60), day('2026-10-02', 45), day('2026-10-03', 90)]; return Promise.resolve(); });
      return finished;
    };
    const summary = matching(), edits = [new Set(['2026-10-01']), new Set(['2026-10-03'])];
    const finished = await run((list, finish) => settlePending(edits.map((dates, i) => ({ dates, i })), e => e.dates, () => [summary], new TotalsMemo(list, '2026-10-03'), e => finish(e.i)));
    const expected = await run((list, finish) => reference(edits, () => [summary], list, '2026-10-03', finish));
    expect(finished).toEqual(expected); expect(finished).toEqual([0]);
  });
});
