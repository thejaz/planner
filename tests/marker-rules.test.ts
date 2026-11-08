import { describe, it, expect } from 'vitest';
import { CANONICAL_LEGEND, parseMarkerCriteria, rowMarkers } from '../src/core/marker-rules';
import { marker, parseSummary } from '../src/core/history';
import { contextPatch, readContext } from '../src/core/context';
import { applyPatches } from '../src/core/changes';
import { migrateLegend } from '../src/core/legend-migration';
import { markerCounts } from '../src/core/review-extras';
const criteria = parseMarkerCriteria(CANONICAL_LEGEND, 'summary.md');
const limits = { low: 30, cool: 150, hot: 300 };
describe('canonical marker rules', () => {
  it('parses three columns, ASCII/Unicode ranges, any and formatting consistently', () => {
    expect(criteria.issues).toEqual([]); expect(criteria.definitions).toHaveLength(10);
    expect(criteria.definitions.find(d => d.key === '☁')).toMatchObject({ label: 'buffer', context: 'buffer' });
    expect(criteria.definitions.find(d => d.key === 'highlight')).toMatchObject({ label: 'no-pro', formatting: true });
    const alternate = parseMarkerCriteria(CANONICAL_LEGEND.replace('>=300m','≥300m').replace('❄️','❄').replace(' | any | ', ' | '), 'old.md');
    expect(alternate.definitions.map(d => [d.key,d.label,d.min,d.max,d.context,d.formatting])).toEqual(criteria.definitions.map(d => [d.key,d.label,d.min,d.max,d.context,d.formatting]));
  });
  it.each([0,29,30,149,150,299,300])('classifies all contexts at %im', minutes => {
    const earned = minutes < 30 ? '' : minutes < 150 ? '🦥' : minutes < 300 ? '❄️' : '🔥';
    for (const context of ['☁️','🕶️']) {
      expect(marker(minutes,'2026-10-23', context,limits,[5],criteria)).toBe(context + earned);
      expect(marker(minutes,'2026-10-20', context,limits,[5],criteria)).toBe(context + earned);
    }
    expect(marker(minutes,'2026-10-23','',limits,[5],criteria)).toBe(earned || '😎');
    expect(marker(minutes,'2026-10-20','',limits,[5],criteria)).toBe(earned || '😣');
    expect(marker(minutes,'2026-10-20','✌',limits,[5],criteria)).toBe(earned || '✌');
  });
  it('preserves exact minutes/bold/inline notes, highlighting only no-pro', () => {
    const raw='==**2026-10-23 = 0h 00m ☁️😎**== ==keep ☁️ note==';
    const text=CANONICAL_LEGEND+'### Days\n'+raw+'\nDays (2026-10-23 - 2026-10-23)';
    const summary=parseSummary(text,'summary.md');
    const planned=applyPatches(text,[contextPatch(summary,'2026-10-23','buffer')]);
    expect(planned).toContain('**2026-10-23 = 0h 00m ☁️** ==keep ☁️ note==');
    const excused=applyPatches(text,[contextPatch(summary,'2026-10-23','excused')]);
    expect(excused).toContain('**2026-10-23 = 0h 00m ✌** ==keep ☁️ note==');
    expect(rowMarkers('2026-10-20 = 300 🔥 ==keep ☁️ note==')).toBe('🔥 ');
    expect(readContext('2026-10-20 = 300 🔥 ==keep ☁️ note==',criteria)).toBe('ordinary');
  });
  it('reports conflicting contexts and invalid definitions', () => {
    expect(()=>marker(0,'2026-10-23','☁️🕶️',limits,[5],criteria)).toThrow('Combination rule');
    const summary=parseSummary(CANONICAL_LEGEND+'### Days\n2026-10-23 = 0 ☁️✌\nDays (2026-10-23 - 2026-10-23)','s.md');
    expect(markerCounts([summary],'2026-10-23','2026-10-23',criteria,[5]).issues.some(i=>i.message.includes('Combination rule'))).toBe(true);
    expect(parseMarkerCriteria(CANONICAL_LEGEND.replace('30-149m','149-30m'),'s.md').issues.length).toBeGreaterThan(0);
  });
  it('migrates only legend and unambiguous planned rows; is idempotent', () => {
    const text=CANONICAL_LEGEND.replace('>=300m','≥300m')+'### Days\n==**2026-10-23 = 0 ☁️😎**==\n2026-10-24 = 200 🕶️😣\n2026-10-25 = ? ☁️\n2026-10-26 = 0 ☁️✌\n2026-10-27 = 0 😣\n### Bookmarks\n2026-10-23 = 999 ☁️😎\nDays (2026-10-23 - 2026-10-27)\n';
    const plan=migrateLegend(text,'s.md'),after=applyPatches(text,plan.change.patches);
    expect(after).toContain('**2026-10-23 = 0 ☁️**');expect(after).toContain('2026-10-24 = 200 🕶️❄️');
    expect(after).toContain('2026-10-26 = 0 ☁️✌'); expect(after).toContain('2026-10-27 = 0 😣');
    expect(plan.issues).toHaveLength(2);
    expect(after.split('### Bookmarks')[1]).toBe(text.split('### Bookmarks')[1]);
    expect(migrateLegend(after,'s.md').change.patches).toEqual([]);
  });
});
