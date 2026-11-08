import { describe, it, expect } from 'vitest';
import { CANONICAL_LEGEND, parseMarkerCriteria, rowMarkers } from '../src/core/marker-rules';
import { marker, parseSummary } from '../src/core/history';
import { contextResult, contextPatch } from '../src/core/context';
import { applyPatches } from '../src/core/changes';
import { markerCounts } from '../src/core/review-extras';
import { shortcutFor } from '../src/ui/shortcuts';

const limits = { low: 30, cool: 150, hot: 300 };
const parse = (text = CANONICAL_LEGEND) => parseMarkerCriteria(text, 'summary.md');
describe('dependable supplied legend rules', () => {
  it.each([
    ['unknown context', '(context: excused)', '(context: vacation)'],
    ['mismatched context', '(context: excused)', '(context: buffer)'],
    ['planned range', 'any | buffer', '0-29m | buffer'],
    ['invalid no-pro range', '0-29m | no-pro weekends', '29-0m | no-pro weekends'],
    ['duplicate context declaration', '(context: excused)', '(context: excused) (context: buffer)'],
    ['earned overlap', '150-299m', '149-299m'],
    ['invalid range', '30-149m', '149-30m'],
    ['no earned range', '30-149m', 'any'],
    ['missing context', ' (context: buffer)', ''],
  ])('blocks %s before generation', (_name, from, to) => {
    const rules = parse(CANONICAL_LEGEND.replace(from, to));
    expect(rules.issues.length).toBeGreaterThan(0);
    expect(() => marker(20, '2026-10-20', '', limits, [5], rules)).toThrow();
  });
  it('rejects duplicate markers and conflicting context definitions', () => {
    expect(parse(CANONICAL_LEGEND.replace('#### combination rules', '- ✌ | 0-29m | duplicate (context: excused)\n#### combination rules')).issues.length).toBeGreaterThan(0);
    expect(parse(CANONICAL_LEGEND.replace('(context: buffer)', '(context: at-ease)')).issues.length).toBeGreaterThan(0);
  });
  it('uses identities rather than descriptive names', () => {
    const renamed = parse(CANONICAL_LEGEND.replaceAll('no-pro', 'my name').replace('low-pro', 'gentle').replace('cool', 'steady').replace('hot', 'busy').replace('at-ease (', 'holiday ('));
    expect(renamed.issues).toEqual([]);
    for (const value of [0, 29, 30, 149, 150, 299, 300]) for (const context of ['', '✌', '☁️', '🕶️'])
      expect(marker(value, '2026-10-23', context, limits, [5], renamed)).toBe(marker(value, '2026-10-23', context, limits, [5], parse()));
  });
  it('honors valid custom ranges and rejects missing coverage without fallback', () => {
    const custom = parse(CANONICAL_LEGEND.replaceAll('0-29m', '0-59m').replace('30-149m', '60-149m'));
    expect(custom.issues).toEqual([]);
    expect(marker(59, '2026-10-20', '✌', limits, [5], custom)).toBe('✌');
    expect(marker(60, '2026-10-20', '✌', limits, [5], custom)).toBe('🦥');
    const gap = parse(CANONICAL_LEGEND.replace('30-149m', '31-149m'));
    expect(() => marker(30, '2026-10-20', '', limits, [5], gap)).toThrow('covers 30m');
    expect(() => marker(30, '2026-10-20', '☁️', limits, [5], gap)).toThrow('covers 30m');
    expect(() => marker(400, '2026-10-20', '', limits, [5], parse(CANONICAL_LEGEND.replace('- 🔥 | >=300m | hot\n', '')))).toThrow();
  });
  it.each([0, 29, 30, 149, 150, 299, 300])('preview agrees with saved markers at %im', minutes => {
    const text = CANONICAL_LEGEND + `\n### Days\n**2026-10-23 = ${minutes} 😣** ==annotation ☁️==\nDays (2026-10-23 - 2026-10-23)\n`;
    const summary = parseSummary(text, 'summary.md');
    for (const context of ['ordinary', 'excused', 'at-ease', 'buffer']) {
      const result = contextResult(summary, '2026-10-23', context, parse());
      const saved = applyPatches(text, [contextPatch(summary, '2026-10-23', context)]);
      expect(saved).toContain(`${minutes} ${result.symbols}**`);
      expect(saved).toContain('==annotation ☁️==');
      expect(result.expires).toBe(context === 'excused' && minutes >= 30);
      if (context === 'buffer' || context === 'at-ease') expect(result.symbols).not.toMatch(/[😣😎✌]/u);
    }
  });
  it('reports missing coverage and forbidden combinations without changing saved records', () => {
    const text = CANONICAL_LEGEND + '\n### Days\n2026-10-20 = 0 ☁️✌😣\nDays (2026-10-20 - 2026-10-20)\n';
    const summary = parseSummary(text, 'summary.md'), result = markerCounts([summary], '2026-10-20', '2026-10-20', parse(), [5]);
    expect(result.counts.get('☁')).toBe(1); expect(result.counts.get('✌')).toBe(1);
    expect(result.issues.some(i => i.message.includes('Combination rule'))).toBe(true);
    expect(summary.text).toBe(text);
    const gap = parse(CANONICAL_LEGEND.replace('30-149m', '31-149m'));
    const unknownBand = parseSummary(text.replace('= 0 ☁️✌😣', '= 30 🦥'), 'summary.md');
    expect(markerCounts([unknownBand], '2026-10-20', '2026-10-20', gap, [5]).issues.some(i => i.message.includes('covers 30m'))).toBe(true);
  });
  it('preserves the separator before standalone highlighted annotations', () => {
    const text = CANONICAL_LEGEND + '\n### Days\n2026-10-20 = 20 😣  ==keep note==\nDays (2026-10-20 - 2026-10-20)\n';
    const summary = parseSummary(text, 'summary.md');
    expect(applyPatches(text, [contextPatch(summary, '2026-10-20', 'excused')])).toContain('2026-10-20 = 20 ✌  ==keep note==');
  });
  it('registers bare C without stealing modified keys', () => {
    const event = (key: string, ctrlKey = false) => ({ key, ctrlKey, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
    expect(shortcutFor(event('c'), { onRow: false, activity: false })?.action).toBe('day-context');
    expect(shortcutFor(event('c', true), { onRow: true, activity: true })).toBeUndefined();
  });
  it('retains an invalid supplied legend instead of treating it as absent', () => {
    const summary = parseSummary('### Criteria & Markers\n- invalid | any | invalid\n### Days\n2026-10-20 = 20 😣\nDays (2026-10-20 - 2026-10-20)\n', 'summary.md');
    expect(summary.criteria?.issues.length).toBeGreaterThan(0);
    expect(() => contextPatch(summary, '2026-10-20', 'ordinary')).toThrow();
  });
  it('accepts either emoji variation selector in legends and recorded rows', () => {
    expect(parse(CANONICAL_LEGEND.replaceAll('\uFE0F', '\uFE0E')).issues).toEqual([]);
    expect(rowMarkers('2026-10-20 = 20 ☁\uFE0E')).toContain('☁');
    const summary = parseSummary(CANONICAL_LEGEND + '\n### Days\n2026-10-20 = 20 ☁\uFE0E\nDays (2026-10-20 - 2026-10-20)\n', 'summary.md');
    expect(applyPatches(summary.text, [contextPatch(summary, '2026-10-20', 'excused')])).toContain('2026-10-20 = 20 ✌');
  });
  it('preserves authored label capitalization, including legacy names', () => {
    const rules = parse(CANONICAL_LEGEND.replace('no-pro (context: excused)', "LiGhT Can't Study (context: excused)").replace('any | buffer', 'any | BuFfEr'));
    expect(rules.definitions.find(d => d.context === 'excused')?.label).toBe("LiGhT Can't Study");
    expect(rules.definitions.find(d => d.context === 'buffer')?.label).toBe('BuFfEr');
    expect(marker(20, '2026-10-20', '✌', limits, [5], rules)).toBe('✌');
  });
  it('distinguishes missing legends from empty supplied legends explicitly', () => {
    const absent = parseSummary('### Days\n2026-10-20 = 130 🦥\nDays (2026-10-20 - 2026-10-20)\n', 'summary.md');
    expect(absent.criteria).toBeUndefined();
    expect(marker(130, '2026-10-20', '', absent.thresholds, [5], absent.criteria)).toBe('🦥');
    const empty = parseSummary('### Criteria & Markers\n' + absent.text, 'summary.md');
    expect(empty.criteria?.issues.length).toBeGreaterThan(0);
    expect(() => marker(130, '2026-10-20', '', empty.thresholds, [5], empty.criteria)).toThrow('No marker definitions were found');
  });
});
