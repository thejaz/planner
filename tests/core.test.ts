import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculate, effectiveTotals, parseDay } from '../src/core/reader';
import { applyPatches, canMoveEntry, changeOf, footerPatches, makeDay, moveEntry, patch, quickEntry, rebase, shiftEntries, toggleEntry } from '../src/core/changes';
import { marker, materialPatches, parseSummary, review, summaryPatches, wordingOnly } from '../src/core/history';
import { localNow, systemTimeZone } from '../src/core/model';
import { contextPatch, readContext } from '../src/core/context';
import { parseMarkerCriteria } from '../src/core/review-extras';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
describe('moving a whole row', () => {
  it('cuts and reinserts across a heading without swapping another row into the source section', () => {
    const raw = '### morning\n- [ ] 09:00 (20) : chp\nKeep this annotation.\n\n### afternoon\n- [ ] 10:00 (30) : mdr\n- [ ] 11:00 (40) : hay\n\n---\nSUM = 0\n';
    const day = parseDay(raw);
    const after = applyPatches(raw, moveEntry(day, day.entries[0]!, 1).patches);
    expect(after).toBe('### morning\nKeep this annotation.\n\n### afternoon\n- [ ] 09:00 (20) : chp\n- [ ] 10:00 (30) : mdr\n- [ ] 11:00 (40) : hay\n\n---\nSUM = 0\n');
    const up = applyPatches(raw, moveEntry(day, day.entries[1]!, -1).patches);
    expect(up).toBe('### morning\n- [ ] 09:00 (20) : chp\nKeep this annotation.\n\n- [ ] 10:00 (30) : mdr\n### afternoon\n- [ ] 11:00 (40) : hay\n\n---\nSUM = 0\n');
  });
  it('uses a separate step for the heading boundary in both directions', () => {
    let raw = '### morning\n- [ ] 09:00 (20) : chp\n### afternoon\n- [ ] 10:00 (30) : mdr\n- [ ] 11:00 (40) : hay\n### evening\n- [ ] 19:00 (60) : jib\n';
    const step = (label: string, direction: -1 | 1) => {
      const day = parseDay(raw);
      raw = applyPatches(raw, moveEntry(day, day.entries.find(e => e.label === label)!, direction).patches);
      return parseDay(raw);
    };
    let result = step('chp', 1);
    expect(result.entries.map(e => e.label)).toEqual(['chp', 'mdr', 'hay', 'jib']);
    expect(result.entries[0]!.section).toBe('afternoon');
    result = step('chp', 1);
    expect(result.entries.map(e => e.label)).toEqual(['mdr', 'chp', 'hay', 'jib']);
    result = step('jib', -1);
    expect(result.entries.map(e => e.label)).toEqual(['mdr', 'chp', 'hay', 'jib']);
    expect(result.entries[3]!.section).toBe('afternoon');
    result = step('jib', -1);
    expect(result.entries.map(e => e.label)).toEqual(['mdr', 'chp', 'jib', 'hay']);
  });
  it('enters empty adjacent sections without skipping them or disabling a valid boundary move', () => {
    let raw = '### morning\n- [ ] 09:00 (20) : chp\n\n### afternoon\n\n### evening\n';
    for (const section of ['afternoon', 'evening']) {
      const day = parseDay(raw);
      expect(canMoveEntry(day, day.entries[0]!, 1)).toBe(true);
      raw = applyPatches(raw, moveEntry(day, day.entries[0]!, 1).patches);
      expect(parseDay(raw).entries[0]!.section).toBe(section);
    }
    const evening = parseDay(raw);
    expect(canMoveEntry(evening, evening.entries[0]!, 1)).toBe(false);
    for (const section of ['afternoon', 'morning']) {
      const day = parseDay(raw);
      expect(canMoveEntry(day, day.entries[0]!, -1)).toBe(true);
      raw = applyPatches(raw, moveEntry(day, day.entries[0]!, -1).patches);
      expect(parseDay(raw).entries[0]!.section).toBe(section);
    }
  });
  it('repeated moves keep the same activity intact while intervening rows retain their order', () => {
    let raw = '- [x] 09:00 (10-20/30) : chp & mdr\nA personal annotation.\n- [ ] 10:00 (60) : hay\n- [ ] 11:00 (60) : jib\n';
    for (let n = 0; n < 2; n++) {
      const day = parseDay(raw), entry = day.entries.find(e => e.label === 'chp & mdr')!;
      raw = applyPatches(raw, moveEntry(day, entry, 1).patches);
    }
    expect(raw).toBe('A personal annotation.\n- [ ] 10:00 (60) : hay\n- [ ] 11:00 (60) : jib\n- [x] 09:00 (10-20/30) : chp & mdr\n');
  });
  it.each(['\n', '\r\n'])('preserves %j line endings and unterminated EOF in both directions', eol => {
    const a = '- [ ] 09:00 (20) : chp', b = '- [ ] 10:00 (30) : mdr';
    const raw = `Personal text.${eol}${a}${eol}${b}`, day = parseDay(raw);
    expect(applyPatches(raw, moveEntry(day, day.entries[0]!, 1).patches)).toBe(`Personal text.${eol}${b}${eol}${a}`);
    expect(applyPatches(raw, moveEntry(day, day.entries[1]!, -1).patches)).toBe(`Personal text.${eol}${b}${eol}${a}`);
  });
  it('leaves boundary moves unchanged and rejects a conflicting row edit', () => {
    const raw = '- [ ] 09:00 (20) : chp\n- [ ] 10:00 (30) : mdr\n', day = parseDay(raw);
    expect(moveEntry(day, day.entries[0]!, -1).patches).toEqual([]);
    expect(moveEntry(day, day.entries[1]!, 1).patches).toEqual([]);
    expect(() => rebase(moveEntry(day, day.entries[0]!, 1), raw.replace('(20)', '(25)'))).toThrow();
  });
});
describe('synthetic current-format notes', () => {
  it.each([
    ['2026-10-16', { NVE: 30 }, 30],
    ['2026-10-17', { MDR: 10, FRM: 20, CHP: 30, JIB: 40 }, 100],
    ['2026-10-18', { CHP: 15, JIB: 45 }, 60],
    ['2026-10-19', { MDR: 20, CHP: 40 }, 60],
    ['2026-10-15', { NVE: 5, FRM: 10, CHP: 15, JIB: 20, ORG: 25, ZOT: 30 }, 105]
  ] as const)('%s retains exact credits', (date, projects, sum) => {
    const raw = fixture(`${date}.md`), day = parseDay(raw, `${date}.md`), totals = calculate(day);
    expect(totals.projects).toEqual(projects);
    expect(totals.sum).toBe(sum);
    expect(day.text).toBe(raw);
    expect(day.diagnostics.filter(d => d.blocks)).toEqual([]);
    expect(applyPatches(raw, footerPatches(day))).toBe(raw);
  });
  it('excludes plans and handles bold add totals without double counting', () => {
    const day = parseDay(fixture('2026-10-20.md'), '2026-10-20.md');
    expect(calculate(day).sum).toBe(20);
    expect(calculate(day).planned).toEqual({ CHP: 95, MDR: 95 });
    expect(day.recorded.CHP).toBe(20);
    const once = applyPatches(day.text, footerPatches(day));
    expect(parseDay(once).recordedSum).toBe(20);
    expect(applyPatches(once, footerPatches(parseDay(once)))).toBe(once);
  });
});
describe('unknowns, time, and fallback', () => {
  it.each([
    ['chp & mdr', '35-35/70', { CHP: 35, MDR: 35 }, 70],
    ['chp & mdr & hay', '10-20-30/60', { CHP: 10, MDR: 20, HAY: 30 }, 60],
    ['chp & mdr & hay & jib', '10-20-30-40/100', { CHP: 10, MDR: 20, HAY: 30, JIB: 40 }, 100]
  ])('allocates every explicit credit in %s', (label, duration, projects, sum) => {
    const day = parseDay(`- [x] 12:00 (${duration}) : ${label}`);
    expect(calculate(day).projects).toEqual(projects);
    expect(calculate(day).sum).toBe(sum);
    expect(calculate(day).complete).toBe(true);
  });
  it('retains explicit credit on repeated timestamps while reporting the zero clock interval', () => {
    const day = parseDay('- [x] 10:00 (n/a) : awake\n- [x] 10:00 (15) : chp');
    expect(day.entries[1]!.interval).toBe(0);
    expect(calculate(day).sum).toBe(15);
    expect(day.diagnostics.some(d => d.code === 'interval-difference')).toBe(true);
  });
  it('keeps unknown distinct from zero and blocks unsafe aggregation', () => {
    const day = parseDay('- [x] 13:00 (?) : chp');
    expect(calculate(day).complete).toBe(false);
    expect(effectiveTotals(day).sum).toBeNull();
    expect(() => footerPatches(day)).toThrow();
    const malformedFooter = parseDay('- [x] 13:00 (20) : chp\n??? : SUM');
    expect(effectiveTotals(malformedFooter).sum).toBeNull();
    expect(() => footerPatches(malformedFooter)).toThrow();
    expect(malformedFooter.text).toContain('??? : SUM');
    expect(parseDay('SUM = 999999999999999999999999').diagnostics.some(d => d.code === 'invalid-total')).toBe(true);
  });
  it('requires matched splits; does not count incidental code mentions', () => {
    const day = parseDay('- [x] 10:00 (10-20/30) : chp & jib & mdr\n- [x] 11:00 (60) : meeting about chp');
    expect(calculate(day).sum).toBe(0);
    expect(calculate(day).complete).toBe(false);
  });
  it('preserves explicit credits and detects ambiguous backwards times', () => {
    const day = parseDay('- [x] 23:30 (50) : break\n- [x] 00:10 (40) : chp\n- [x] 01:35 (40) : mdr');
    expect(day.entries[1]!.interval).toBe(40);
    expect(day.entries[2]!.interval).toBe(85);
    expect(calculate(day).sum).toBe(80);
    expect(day.diagnostics.some(d => d.code === 'interval-difference')).toBe(true);
    expect(parseDay('- [ ] 12:00 (n/a) : awake\n- [ ] 11:00 (60) : chp').diagnostics.some(d => d.code === 'backward-time')).toBe(true);
  });
  it('does not bridge unknown anchors', () => {
    const day = parseDay('- [ ] 10:00 (n/a) : awake\n- [ ] ?\n- [ ] 12:00 (?) : ?');
    expect(day.entries[2]!.interval).toBeNull();
  });
  it('reads historical ranges and preserves recorded totals', () => {
    const day = parseDay(fixture('2025-01-05.md'), '2025-01-05.md');
    expect(calculate(day).projects.CHP).toBe(20);
    expect(effectiveTotals(day).sum).toBe(225);
    expect(effectiveTotals(day).unallocated).toBe(0);
    expect(day.legacy).toBe(true);
    expect(parseDay(fixture('2024-06-21.md')).recordedSum).toBe(175);
    expect(effectiveTotals(parseDay(fixture('2024-06-21.md'))).unallocated).toBe(175);
    expect(parseDay(fixture('2025-02-26.md')).recorded.CHP).toBe(70);
  });
  it('uses the configured time zone independently of the host, and the system zone by default', () => {
    // A half-hour offset (UTC+05:30) crossing midnight.
    expect(localNow(new Date('2026-10-19T21:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-10-20', time: '02:30' });
    expect(localNow(new Date('2026-10-19T21:00:00Z'), 'UTC')).toEqual({ date: '2026-10-19', time: '21:00' });
    expect(systemTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
  it('reads annotated legacy totals and mixed activity labels', () => {
    const day = parseDay('- [x] 06:19 (10/36) : chp / breakfast\n- [x] 19:00 (40/55m) : Chores / CHP 3\nTotal CHP Time: **1h** (not-in-plan)');
    expect(calculate(day).projects.CHP).toBe(50);
    expect(effectiveTotals(day).projects.CHP).toBe(60);
    expect(day.diagnostics.some(d => d.code === 'unknown-credit')).toBe(false);
    expect(effectiveTotals(parseDay('Total Study Time: **1h 00m**[^1]')).sum).toBe(60);
    expect(parseDay('MED: 200m[^1]').recorded.MED).toBe(200);
  });
  it('accepts historical 24:00 and retains intentional excess credit', () => {
    const day = parseDay('- [x] 23:00 (n/a) : awake\n- [x] 24:00 (80/60) : trn');
    expect(day.entries[1]!.interval).toBe(60);
    expect(calculate(day).projects.TRN).toBe(80);
    expect(day.diagnostics.some(d => d.blocks)).toBe(false);
  });
});
describe('minimal changes and input', () => {
  it('preserves CRLF and annotations outside modified spans', () => {
    const text = '## title\r\n\r\n- [ ] 10:00 (20) : chp (keep this)\r\n\r\n---\r\n\r\nCHP = 0\r\nSUM = 0\r\n\r\nmy text';
    const day = parseDay(text);
    const next = applyPatches(text, toggleEntry(day, day.entries[0]!).patches);
    expect(next).toBe(text.replace('[ ]', '[x]'));
    const refreshed = applyPatches(next, footerPatches(parseDay(next)));
    expect(refreshed).toBe(next.replace('CHP = 0', 'CHP = 20').replace('SUM = 0', 'SUM = 20'));
    expect(parseDay('- [ ] 10:00 (20) : chp **book** [^1]').entries[0]?.label).toBe('chp **book** [^1]');
  });
  it('rebases unrelated edits and rejects a changed target', () => {
    const base = 'a'.repeat(100) + '\n- [ ] 10:00 (20) : chp\n' + 'z'.repeat(100);
    const day = parseDay(base), change = toggleEntry(day, day.entries[0]!);
    const current = 'new introduction\n' + base;
    expect(applyPatches(current, rebase(change, current))).toContain('[x]');
    expect(() => rebase(change, base.replace('chp', 'mdr'))).toThrow();
  });
  it('previews multiple entries, explicit credits, and selected plans', () => {
    const previous = parseDay('- [x] 09:15 (n/a) : awake').entries[0]!;
    const result = quickEntry('09:35 chp\n10:50 70/75 chp\nnow 35-35/70 chp & mdr', 'log', previous, '12:00');
    expect(result.diagnostics).toEqual([]);
    expect(result.rows[0]).toBe('- [x] 09:35 (20) : chp');
    expect(result.rows[2]).toBe('- [x] 12:00 (35-35/70) : chp & mdr');
    expect(quickEntry('09:35 chp', 'plan', previous, '12:00').rows[0]).toContain('[ ]');
  });
  it('unwraps routines, clears completion and totals, and preserves wording', () => {
    const routine = '```\r\n## plan for ??.??.26\r\n- [x] 10:00 (40) : iwbs & breakfast\r\n**040 : CHP add**\r\n040 : SUM\r\n```';
    expect(makeDay('2026-10-21', routine)).toBe('## plan for 21 oct 26\r\n- [ ] 10:00 (40) : iwbs & breakfast\r\nCHP = 0\r\nSUM = 0\r\n');
    expect(makeDay('2026-10-21')).toContain('HAY = 0');
  });
  it('shifts selected unchecked plans without changing credit', () => {
    const day = parseDay('- [ ] 10:00 (20/30) : chp\n- [ ] 11:00 (60) : mdr');
    expect(applyPatches(day.text, shiftEntries(day, day.entries, 15).patches)).toContain('10:15 (20/30)');
  });
});
describe('review and summaries', () => {
  it('does not count aggregates twice; missing dates remain unknown and a second plan is only named', () => {
    const day = parseDay('- [x] 10:00 (20) : chp\nCHP = 20\nSUM = 20', '2026-10-19.md');
    const summary = parseSummary('### Days\n2026-10-19 = 20\n2026-10-20 = 0\nDays (2026-10-19 - 2027-05-23): 217d', '⌚.md');
    const result = review([day], '2026-10-19', '2026-10-21', '', [summary]);
    expect(result.sum).toBe(20);
    expect(result.knownDays).toBe(2);
    expect(result.missingDays).toBe(1);
    // Equal folders: the shorter path counts, never both.
    const duplicate = review([day, { ...day, path: 'copy/2026-10-19.md', recordedSum: 25 }], '2026-10-19', '2026-10-19').rows[0]!;
    expect(duplicate).toMatchObject({ source: 'daily', sum: 20, paths: ['2026-10-19.md'], disputed: false });
    expect(duplicate.issues).toContain('Also a plan for this date, not counted: copy/2026-10-19.md.');
    const summaryConflict = review([], '2026-10-19', '2026-10-19', '', [summary, { ...summary, path: 'archive.md' }]).rows[0]!;
    expect(summaryConflict.sum).toBeNull();
    expect(summaryConflict.paths).toEqual(['⌚.md', 'archive.md']);
  });
  it('does not turn unallocated historical work into zero project work', () => {
    const day = parseDay('Total Study Time: **2h**', '2024-06-21.md');
    const result = review([day], '2024-06-21', '2024-06-21', 'CHP');
    expect(result.rows[0]!.sum).toBeNull();
    expect(result.knownDays).toBe(0);
  });
  it('preserves context and leaves low weekdays unclassified', () => {
    const thresholds = { low: 30, cool: 150, hot: 300 };
    expect(marker(350, '2026-10-20', '☁️🔥', thresholds)).toBe('☁️🔥');
    expect(marker(20, '2026-10-20', '', thresholds)).toBe('😣');
    expect(marker(20, '2026-10-16', '', thresholds)).toBe('😎');
    expect(marker(20, '2026-10-16', '😣', thresholds)).toBe('😣');
  });
  it('updates summary fields without touching bookmarks or targets', () => {
    const text = '### Days\n2026-10-19 = 0 ☁️🦥 ==note==\n\n### Projects\n🦉 CHP = 0\n\n### Bookmarks\n- CHP = 99m\n\n### Results\nDays (2026-10-19 - 2026-10-19): 1d\n**Projected Sum:** 1,252h (3.43h/d)\n**Actual Sum:** ?h (?h/d)\n';
    const day = parseDay('- [x] 10:00 (350) : chp\nCHP = 350\nSUM = 350', '2026-10-19.md');
    const summary = parseSummary(text, '⌚.md'), update = summaryPatches(summary, [day], '2026-10-19', new Set(['2026-10-19']));
    const next = applyPatches(text, update.patches);
    expect(next).toContain('2026-10-19 = 350 ☁️🔥 ==note==');
    expect(next).toContain('- CHP = 99m');
    expect(next).toContain('**Projected Sum:** 1,252h (3.43h/d)');
    expect(next).toContain('🦉 CHP = 350');
    expect(summaryPatches(parseSummary(next, '⌚.md'), [day], '2026-10-19', new Set(['2026-10-19'])).patches).toEqual([]);
  });
  it('states the days so far beside the average, and a wording-only change is not a disagreement', () => {
    const results = (actual: string, end = '2027-09-30') => `### Days\n\n### Projects\nCHP = 0\n\n### Results\nDays (2026-10-01 - ${end}): 365d\n**Actual Sum:** ${actual}\n`;
    // One recorded day of 12 minutes for every day so far, so the period is complete.
    const days = (count: number) => Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
      return parseDay('## recorded totals\nCHP = 12\nSUM = 12\n', `${date}.md`);
    });
    const tenth = days(10);
    // Ten days into a year-long period: the average covers the ten days, and says so.
    const update = summaryPatches(parseSummary(results('?h (?h/d)'), '⌚.md'), tenth, '2026-10-10', new Set(), true);
    expect(applyPatches(results('?h (?h/d)'), update.patches)).toContain('**Actual Sum:** 2h (0.20h/d over 10d)');
    // Harmless spacing still updates, keeping its indentation, spacing and CRLF.
    for (const label of ['  **Actual Sum:**', '**Actual Sum :**  ', '** Actual Sum: **']) {
      const spaced = results('?h (?h/d)').replace('**Actual Sum:** ', label + ' ').replace(/\n/g, '\r\n');
      const patched = applyPatches(spaced, summaryPatches(parseSummary(spaced, '⌚.md'), tenth, '2026-10-10', new Set(), true).patches);
      expect(patched).toContain(`${label} 2h (0.20h/d over 10d)\r\n`);
    }
    // Four spaces make an indented code block, which stays as written.
    const code = results('?h (?h/d)').replace('**Actual', '    **Actual');
    expect(summaryPatches(parseSummary(code, '⌚.md'), tenth, '2026-10-10', new Set(), true).patches.some(p => /Actual Sum/.test(p.before))).toBe(false);
    // The earlier wording with the same figures only gains the day count.
    const filled = applyPatches(results('2h (0.20h/d)'), update.patches.filter(p => !/Actual Sum/.test(p.before)));
    const earlier = summaryPatches(parseSummary(filled, '⌚.md'), tenth, '2026-10-10', new Set(), true).patches;
    expect(earlier).toHaveLength(1); expect(wordingOnly(earlier[0]!)).toBe(true); expect(materialPatches(earlier)).toEqual([]);
    // A different average still is a real difference.
    const stale = applyPatches(results('2h (0.40h/d over 5d)'), update.patches.filter(p => !/Actual Sum/.test(p.before)));
    expect(materialPatches(summaryPatches(parseSummary(stale, '⌚.md'), tenth, '2026-10-10', new Set(), true).patches)).toHaveLength(1);
    // Thousands use the same separator as the hours.
    const many = days(1188), text = results('?h (?h/d)', '2030-09-30');
    const long = summaryPatches(parseSummary(text, '⌚.md'), many, '2029-12-31', new Set(), true);
    expect(applyPatches(text, long.patches)).toContain('(0.20h/d over 1,188d)');
  });
  it('inserts missing summary days in chronological order and adds new project totals', () => {
    const summary = parseSummary('### Days\n2026-10-19 = 10\n2026-10-21 = 10\n### Projects\nCHP = 20\nDays (2026-10-19 - 2026-10-21): 3d', 'summary.md');
    const days = [19, 20, 21].map(n => parseDay(`- [x] 10:00 (10) : ${n === 20 ? 'mdr' : 'chp'}\nSUM = 10`, `2026-10-${n}.md`));
    const after = applyPatches(summary.text, summaryPatches(summary, days, '2026-10-21', new Set(['2026-10-20'])).patches);
    expect(after).toContain('2026-10-19 = 10\n==2026-10-20 = 10 😣==\n2026-10-21 = 10');
    expect(after).toContain('MDR = 10');
  });
  it('normalizes the colon spacing only on updated day rows and preserves emphasis, context, notes, and CRLF', () => {
    const text = '### Days\r\n**2026-10-20 =0 ☁️🦥** ==keep==\r\n2026-10-21 =0 untouched\r\n### Projects\r\nCHP = 0\r\nDays (2026-10-20 - 2026-10-21): 2d\r\n';
    const day = parseDay('- [x] 10:00 (250) : chp\nCHP = 250\nSUM = 250', '2026-10-20.md');
    const update = summaryPatches(parseSummary(text, 'summary.md'), [day], '2026-10-20', new Set(['2026-10-20']));
    const after = applyPatches(text, update.patches);
    expect(after).toContain('**2026-10-20 = 250 ☁️❄️** ==keep==\r\n2026-10-21 =0 untouched\r\n');
    expect(summaryPatches(parseSummary(after, 'summary.md'), [day], '2026-10-20', new Set(['2026-10-20'])).patches).toEqual([]);
  });
  it('stores day context in readable summary text and preserves notes and weekends', () => {
    const text = '### Criteria & Markers\n- 😣 | 0-29m | no-pro\n- 😎 | 0-29m | weekends\n- ✌ | 0-29m | light can\'t study (context: excused)\n- ☁️ | buffer days (context: buffer)\n- 🕶️ | at-ease days (context: at-ease)\n### Days\n**2026-10-16 = 20 😎**\n2026-10-20 = 350 🔥 ==new record==\nDays (2026-10-16 - 2026-10-20): 5d';
    let summary = parseSummary(text, 'summary.md');
    const next = applyPatches(text, [contextPatch(summary, '2026-10-16', 'excused')]);
    expect(next).toContain('**2026-10-16 = 20 ✌**');
    summary = parseSummary(next, 'summary.md');
    const cleared = applyPatches(next, [contextPatch(summary, '2026-10-16', 'ordinary')]);
    expect(cleared).toContain('**2026-10-16 = 20 😎**');
    expect(cleared).toContain('==new record==');
    expect(readContext('☁️🕶️✌', parseMarkerCriteria(text, 'summary.md'))).toBe('multiple');
  });
});
