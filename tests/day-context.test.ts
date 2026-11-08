import { COMBINATION_RULES } from '../src/core/marker-combinations';
import { describe, expect, it } from 'vitest';
import { contextOptions, contextPatch, readContext } from '../src/core/context';
import { marker, parseSummary, replaceSummaryMarkers } from '../src/core/history';
import { applyPatches, rebase } from '../src/core/changes';
import { parseMarkerCriteria } from '../src/core/review-extras';
import { uiText } from '../src/ui/text';

const legend = `### Criteria & Markers
- 😣 | 0-29m | can't study
- ✌ | 0-29m | light can't study (context: excused)
- 😎 | 0-29m | no study weekends
- 🦥 | 30-149m | low pro
- ❄️ | 150-299m | cool
- 🔥 | ≥300m | hot
- 🕶️ | at-ease days (context: at-ease)
- ☁️ | buffer days (context: buffer)
- highlights | can't study (formatting)
- **bolds** | weekends (formatting)
${COMBINATION_RULES}
`;
const criteria = parseMarkerCriteria(legend, 'criteria.md');
const source = (value = 20) => parseSummary(legend + `### Days\n**2026-10-16 = ${value} 😎**\n2026-10-20 = 350 🔥 ==keep ☁️ note==\nDays (2026-10-16 - 2026-10-20): 5d\n`, 'summary.md');
describe('single day context from the legend', () => {
  it('distinguishes contextual and formatting rules and strips their metadata from legends', () => {
    expect(contextOptions(criteria).map(def => def.context)).toEqual(['excused', 'at-ease', 'buffer']);
    expect(criteria.definitions.filter(def => def.formatting).map(def => def.key)).toEqual(['highlight', 'bold']);
    expect(criteria.definitions.find(def => def.key === '✌')!.label).toBe("light can't study");
  });
  it.each(['no-pro', 'excused no-pro', "light can't study"])('keeps the excused context for the label %s', label => {
    const parsed = parseMarkerCriteria(`### Criteria & Markers\n- ✌ | 0-29m | ${label} (context: excused)\n`, 'criteria.md');
    expect(parsed.issues).toEqual([]);
    expect(contextOptions(parsed)).toMatchObject([{ label, context: 'excused', min: 0, max: 29 }]);
  });
  it.each([0, 20, 29])('uses light cannot study for excused %sm and preserves bold weekends', value => {
    const summary = source(value), patch = contextPatch(summary, '2026-10-16', 'excused', criteria);
    const next = applyPatches(summary.text, [patch]);
    expect(next).toContain(`**2026-10-16 = ${value} ✌**`);
    expect(readContext(next.split('\n').find(line => line.includes('2026-10-16 ='))!, criteria)).toBe('excused');
    expect(next).toContain('==keep ☁️ note==');
  });
  it.each([[30, '🦥'], [200, '❄️'], [300, '🔥']] as const)('uses normal productivity for excused %sm, without an out-of-range marker', (value, symbol) => {
    const summary = source(value), next = applyPatches(summary.text, [contextPatch(summary, '2026-10-16', 'excused', criteria)]);
    const line = next.split('\n').find(line => line.includes('2026-10-16 ='))!;
    expect(line).toContain(symbol); expect(line).not.toContain('✌'); expect(readContext(line, criteria)).toBe('ordinary');
  });
  it('selects exactly one context and ordinary removes an existing ranged context', () => {
    const summary = source(), buffer = applyPatches(summary.text, [contextPatch(summary, '2026-10-16', 'buffer', criteria)]);
    expect(buffer).toContain('☁️**');
    const parsed = parseSummary(buffer, summary.path), ease = applyPatches(buffer, [contextPatch(parsed, '2026-10-16', 'at-ease', criteria)]);
    expect(ease).toContain('🕶️**'); expect(ease).not.toContain('☁️**');
    const excused = applyPatches(ease, [contextPatch(parseSummary(ease, summary.path), '2026-10-16', 'excused', criteria)]);
    const ordinary = applyPatches(excused, [contextPatch(parseSummary(excused, summary.path), '2026-10-16', 'ordinary', criteria)]);
    expect(ordinary).toContain('**2026-10-16 = 20 😎**'); expect(readContext('2026-10-16 = 20 😎', criteria)).toBe('ordinary');
  });
  it('defaults to ordinary with no definitions or markers, and rejects undefined/multiple selections without a write', () => {
    const summary = source();
    expect(readContext('2026-10-16 = 20', parseMarkerCriteria('', 'missing.md'))).toBe('ordinary');
    expect(readContext('☁️🕶️', criteria)).toBe('multiple');
    expect(() => contextPatch(summary, '2026-10-16', 'multiple', criteria)).toThrow('choose one');
    expect(() => contextPatch(summary, '2026-10-16', 'holiday', criteria)).toThrow('choose one');
  });
  it('keeps explicit context changes local and rejects a stale target', () => {
    const summary = source(), patch = contextPatch(summary, '2026-10-16', 'excused', criteria);
    expect(() => rebase({ path: summary.path, base: summary.text, patches: [patch], label: 'context' }, summary.text.replace('= 20 😎', '= 10 😎'))).toThrow();
    expect(summary.text).toContain('= 20 😎');
  });
  it('preserves inline annotations and their emojis while replacing only row markers', () => {
    expect(replaceSummaryMarkers('**2026-10-16 =20 ☁️😎** ==keep ☁️ note==', 20, '✌')).toBe('**2026-10-16 = 20 ✌** ==keep ☁️ note==');
  });
  it('keeps ordinary below-range days, weekends and excused below-range days distinct', () => {
    const limits = { low: 30, cool: 150, hot: 300 };
    expect(marker(20, '2026-10-20', '', limits)).toBe('😣');
    expect(marker(20, '2026-10-16', '', limits)).toBe('😎');
    expect(marker(20, '2026-10-16', '✌', limits)).toBe('✌');
    expect(marker(200, '2026-10-16', '✌', limits)).toBe('❄️');
  });
});
describe('ASCII presentation with original capitalization', () => {
  it('normalizes punctuation without lowercasing interface text, emojis or real file names', () => {
    expect(uiText("Can't study · ‘Excused’ → ≥30m… ✌️")).toBe("Can't study | 'Excused' -> >=30m... ✌️");
    expect(uiText('My Note.md')).toBe('My Note.md');
  });
});
