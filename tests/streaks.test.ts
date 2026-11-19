import { describe, expect, it } from 'vitest';
import { hotStreak } from '../src/core/streaks';
import { parseSummary, recordedReviewRows, review } from '../src/core/history';
import { CANONICAL_LEGEND, parseMarkerCriteria } from '../src/core/marker-rules';
import { parseDay } from '../src/core/reader';
import { dateAdd, localNow } from '../src/core/model';

const today = '2026-10-26';
const rows = (...values: (number | null)[]) => values.map((sum, i) => ({ date: dateAdd(today, i + 1 - values.length), sum }));
const rule = (range: string, label = 'hot', symbol = '🔥') => parseMarkerCriteria(`### Criteria & Markers\n- ${symbol} | ${range} | ${label}\n`, 'thejaz-criteria.md');
const summary = (text: string, path = 'archive/thejaz-summary-old.md') => parseSummary(`### Days\n${text}\n`, path, [5], null);
const day = (date: string, total: string, activities = '', folder = '') => parseDay(`## plan for 26 oct 26\n### morning\n${activities}\nCHP = ${total}\nSUM = ${total}\n`, `${folder}${date}.md`);

describe('hot-day streaks', () => {
  it.each([0, 29, 30, 149, 150, 299, 300, 301])('uses the default numeric boundary at %im', value => {
    expect(hotStreak(rows(value), today, null)).toEqual({ available: true, symbol: '🔥', current: value >= 300 ? 1 : 0, best: value >= 300 ? 1 : 0 });
  });
  it('retains yesterday until today qualifies; below target or unknown today does not end it', () => {
    for (const value of [0, 299, null]) expect(hotStreak(rows(300, 310, value), today, null)).toMatchObject({ current: 2, best: 2 });
    expect(hotStreak(rows(300, 310, 300), today, null)).toMatchObject({ current: 3, best: 3 });
    expect(hotStreak(rows(300, 300).slice(0, 1), today, null)).toMatchObject({ current: 1, best: 1 });
  });
  it('breaks at missing, unknown, duplicate and non-hot dates, retaining the longest historical run', () => {
    const history = rows(300, 300, 300, null, 300, 0, 300, 300);
    expect(hotStreak(history, today, null)).toMatchObject({ current: 2, best: 3 });
    expect(hotStreak(history.filter((_, i) => i !== 6), today, null)).toMatchObject({ current: 1, best: 3 });
    expect(hotStreak([...history, history[6]!], today, null)).toMatchObject({ current: 1, best: 3 });
    expect(hotStreak(history.slice(0, 3), today, null)).toMatchObject({ current: 0, best: 3 });
  });
  it('ignores future dates, handles empty history and never depends on input ordering', () => {
    expect(hotStreak([], today, null)).toMatchObject({ current: 0, best: 0 });
    expect(hotStreak([...rows(300, 300), { date: dateAdd(today, 1), sum: 900 }].reverse(), today, null)).toMatchObject({ current: 2, best: 2 });
  });
  it.each(['😣', '✌', '😎', '🕶️', '☁️', ''])('uses numeric credit regardless of saved %s context or weekend', symbol => {
    const criteria = parseMarkerCriteria(CANONICAL_LEGEND, 'thejaz-criteria.md');
    const records = recordedReviewRows([], [summary(`2026-10-24 = 299 ${symbol}🔥\n2026-10-25 = 300 ${symbol}\n2026-10-26 = 300 ${symbol}`)]);
    expect(hotStreak(records, today, criteria)).toMatchObject({ current: 2, best: 2 });
  });
  it('follows renamed, finite and legacy hot rules with variation selectors', () => {
    for (const range of ['>=240m', '≥240m', '240-299m']) {
      const criteria = rule(range, 'anything', '🔥\uFE0F');
      expect(criteria.issues).toEqual([]);
      for (const value of [239, 240, 299, 300]) expect(hotStreak(rows(value), today, criteria)).toMatchObject({
        symbol: '🔥\uFE0F', current: value >= 240 && (range !== '240-299m' || value <= 299) ? 1 : 0
      });
    }
    expect(hotStreak(rows(240), today, rule('>=300m', '>=200m'))).toMatchObject({ current: 0 });
  });
  it('reports supplied invalid/missing/duplicate definitions without substituting defaults', () => {
    for (const text of ['', '- 🔥 | 300-200m | hot', '- 🔥 | any | hot', '- 🔥 | >=300m | hot\n- 🔥 | >=400m | hotter', '- ❄️ | 150-299m | cool']) {
      const result = hotStreak(rows(500), today, parseMarkerCriteria(`### Criteria & Markers\n${text}`, 'thejaz-criteria.md'));
      expect(result).toMatchObject({ available: false });
      expect('reason' in result && result.reason).toMatch(/criteria|range/i);
    }
  });
  it('uses configured local today across midnight, month, year and leap-day boundaries', () => {
    const instant = new Date('2026-10-25T21:00:00Z');
    expect(localNow(instant, 'Asia/Kolkata').date).toBe('2026-10-26');
    expect(hotStreak(rows(300, 300), localNow(instant, 'Asia/Kolkata').date, null)).toMatchObject({ current: 2 });
    expect(hotStreak(rows(300, 300), '2026-10-28', null)).toMatchObject({ current: 0 });
    for (const [a, b] of [['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'], ['2025-12-31', '2026-01-01']])
      expect(hotStreak([{ date: a!, sum: 300 }, { date: b!, sum: 300 }], b!, null)).toMatchObject({ current: 2 });
  });
});

describe('shared Report authority for streak history', () => {
  it('preserves literal zero, recorded totals, planned credit and duplicate-day precedence', () => {
    const days = [day('2026-10-24', '0', '- [x] 12:00 (400) : chp'), day('2026-10-25', '300'),
      day('2026-10-25', '0', '', 'other/'), day(today, '0', '- [ ] 12:00 (500) : chp')];
    const summaries = [summary('2026-10-23 = 300 ☁️🔥\n2026-10-24 = 500 🔥\n2026-10-25 = 0 😣\n2026-10-26 = 400 🔥')];
    const raw = [...days, ...summaries].map(d => d.text);
    const records = recordedReviewRows(days, summaries);
    expect(records).toEqual(review(days, '2026-10-23', today, '', summaries).rows);
    expect(records.map(r => r.sum)).toEqual([300, 0, 300, 0]);
    expect(hotStreak(records, today, null)).toMatchObject({ current: 1, best: 1 });
    expect([...days, ...summaries].map(d => d.text)).toEqual(raw);
  });
  it('uses archives, refuses duplicate summary totals and does not infer from saved markers', () => {
    const a = summary('2026-10-22 = 300 🕶️\n2026-10-23 = 300 ☁️\n2026-10-24 = ? 🔥\n2026-10-25 = 300\n2026-10-26 = 300');
    const b = summary('2026-10-25 = 300', 'thejaz-summary-now.md');
    const records = recordedReviewRows([], [a, b]);
    expect(records).toEqual(review([], '2026-10-22', today, '', [a, b]).rows);
    expect(records[3]).toMatchObject({ sum: null, source: 'duplicate' });
    expect(hotStreak(records, today, parseMarkerCriteria(CANONICAL_LEGEND, 'thejaz-criteria.md'))).toMatchObject({ current: 1, best: 2 });
  });
  it('handles sparse history beyond the Report range limit without bridging gaps', () => {
    const records = recordedReviewRows([], [summary('1900-01-01 = 300\n2026-10-25 = 300\n2026-10-26 = 300')]);
    expect(hotStreak(records, today, null)).toMatchObject({ current: 2, best: 2 });
  });
});
