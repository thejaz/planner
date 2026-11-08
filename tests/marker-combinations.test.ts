import { describe, expect, it } from 'vitest';
import { CANONICAL_LEGEND, parseMarkerCriteria, rowMarkers } from '../src/core/marker-rules';
import { COMBINATION_RULES, combinationProblems } from '../src/core/marker-combinations';
import { addCombinationRules, simplifyCombinationRules } from '../src/core/combination-migration';
import { marker, parseSummary } from '../src/core/history';
import { applyPatches } from '../src/core/changes';
import { markerCounts } from '../src/core/review-extras';
const bare = CANONICAL_LEGEND.split('#### combination rules')[0]!;
const limits = { low: 30, cool: 150, hot: 300 };
const parse = (rules = COMBINATION_RULES) => parseMarkerCriteria(bare + rules, 'summary.md');
describe('Markdown-defined combination rules', () => {
  it.each(['',' |',' | custom name'])('accepts omitted, empty or descriptive group labels: %s', suffix => {
    const rules = parse('#### combination rules\n- exclusive | ☁️, 🕶️'+suffix+'\n');
    expect(rules.issues).toEqual([]);
    expect(combinationProblems(['☁','🕶'], rules.combinations)).toHaveLength(1);
    expect(combinationProblems(['☁'], rules.combinations)).toEqual([]);
  });
  it('uses the same documented block in the canonical legend', () => {
    expect(CANONICAL_LEGEND).toContain(COMBINATION_RULES);
    expect(parse().combinations).toHaveLength(4); expect(parse().issues).toEqual([]);
  });
  it.each(['', '#### Combination rules\n\n'])('has no restrictions when the block is missing or empty', rules => {
    const criteria = parse(rules);
    expect(criteria.combinations).toEqual([]); expect(criteria.issues).toEqual([]);
    expect(combinationProblems(['✌', '☁', '🕶', '😣'], criteria.combinations)).toEqual([]);
    expect(marker(20, '2026-10-20', '☁️🕶️✌😣', limits, [5], criteria)).toBe('☁️🕶️✌😣');
    expect(marker(130, '2026-10-20', '☁️', limits, [5], criteria)).toBe('☁️');
  });
  it('keeps unrestricted existing combinations while updating only expired numeric markers', () => {
    const criteria = parse('');
    expect(marker(200, '2026-10-20', '☁️🕶️🦥', limits, [5], criteria)).toBe('☁️🕶️❄️');
    expect(marker(200, '2026-10-20', '✌', limits, [5], criteria)).toBe('❄️');
    expect(marker(20, '2026-10-20', '☁️🕶️✌😣', limits)).toBe('☁️🕶️✌😣');
    expect(marker(130, '2026-10-20', '', limits, [5], criteria)).toBe('🦥');
  });
  it('gets exclusions and priorities from the supplied rules, not fixed emoji pairs', () => {
    const custom = parse('#### Combination rules\n- replaces | ☁️ | 🦥\n');
    expect(marker(130, '2026-10-20', '☁️', limits, [5], custom)).toBe('☁️');
    expect(marker(20, '2026-10-20', '☁️', limits, [5], custom)).toBe('☁️😣');
    const exclusive = parse('#### Combination rules\n- exclusive | ☁️, 🕶️ | my rule\n');
    expect(() => marker(20, '2026-10-20', '☁️🕶️', limits, [5], exclusive)).toThrow('my rule');
    expect(marker(20, '2026-10-20', '☁️✌', limits, [5], exclusive)).toBe('☁️✌😣');
  });
  it('applies standard rules at every boundary and resolves weekday/weekend no-pro replacements', () => {
    for (const value of [0,29,30,149,150,299,300]) {
      const earned = value < 30 ? '' : value < 150 ? '🦥' : value < 300 ? '❄️' : '🔥';
      for (const date of ['2026-10-20','2026-10-23']) {
        for (const context of ['☁️','🕶️']) expect(marker(value,date,context,limits,[5],parse())).toBe(context+earned);
        expect(marker(value,date,'✌',limits,[5],parse())).toBe(earned || '✌');
      }
    }
  });
  it.each([
    '- unsupported | ☁️ | 🦥', '- exclusive | ☁️ | too small', '- exclusive | ☁️, missing | bad',
    '- replaces | ☁️ | ☁️', '- replaces | ☁️ | 🔮', '- replaces | ☁️ |',
    '- replaces | ☁️ | 🦥\n- replaces | 🦥 | ☁️',
    '- exclusive | ☁️, 🕶️ | context\n- exclusive | 🕶️, ☁️ | duplicate',
  ])('rejects malformed supplied rules rather than treating them as permissive: %s', line => {
    const rules = parse('#### Combination rules\n'+line+'\n');
    expect(rules.issues.length).toBeGreaterThan(0);
    expect(() => marker(20,'2026-10-20','☁️',limits,[5],rules)).toThrow();
  });
  it('supports variation selectors, case-insensitive operations and scoped Markdown', () => {
    const rules = parse('#### Combination rules\n- RePlAcEs | ☁\uFE0E | 😣\n');
    expect(rules.issues).toEqual([]); expect(marker(20,'2026-10-20','☁️',limits,[5],rules)).toBe('☁️');
    const external = parseMarkerCriteria('#### Combination rules\n- invalid | x | y\n'+bare+'```\n#### Combination rules\n- invalid | x | y\n```\n### Bookmarks\n#### Combination rules\n- invalid | x | y\n','s.md');
    expect(external.combinations).toEqual([]);expect(external.issues).toEqual([]);
  });
  it('uses each summary policy in reports, or the explicit source override', () => {
    const rows = (date: string) => `\n### Days\n${date} : 020 ☁️✌😣\nDays (2026-01-01 - 2026-12-31)\n`;
    const restricted = parseSummary(CANONICAL_LEGEND+rows('10-20'),'restricted.md');
    const permissive = parseSummary(bare+rows('10-21'),'permissive.md');
    const result = markerCounts([restricted,permissive],'2026-10-20','2026-10-21',parse(),[5]);
    expect(result.counts.get('☁')).toBe(2);expect(result.counts.get('✌')).toBe(2);
    expect(result.issues.some(i=>i.path==='restricted.md' && i.message.includes('Combination rule'))).toBe(true);
    expect(result.issues.some(i=>i.path==='permissive.md' && i.message.includes('Combination rule'))).toBe(false);
    expect(markerCounts([permissive],'2026-10-21','2026-10-21',parse(),[5],true).issues.some(i=>i.message.includes('Combination rule'))).toBe(true);
    const invalid = parseSummary(bare+'#### Combination rules\n- invalid | x | y\n'+rows('10-22'),'bad.md');
    expect(markerCounts([invalid],'2026-10-22','2026-10-22',parse(),[5]).issues.some(i=>i.path==='bad.md' && i.message.includes('Write a combination rule'))).toBe(true);
  });
});
describe('insertion-only combination-rule migration', () => {
  it('simplifies headings and known labels while preserving rule behavior and all rows', () => {
    const old = CANONICAL_LEGEND.replace('#### combination rules', '#### Combination rules').replace('❄️, 🔥\n','❄️, 🔥 | productivity\n').replace('🕶️, ☁️\n','🕶️, ☁️ | context\n')+'\n### Days\n2026-10-20 = 20 ☁️✌\n';
    const after = applyPatches(old,simplifyCombinationRules(old,'s.md').patches);
    expect(after).toContain('#### combination rules');expect(after).not.toContain('| productivity');expect(after).not.toContain('| context');expect(after).toContain('2026-10-20 = 20 ☁️✌');
    const signature = (text:string) => parseMarkerCriteria(text,'s.md').combinations.map(({label,line,...rule})=>rule);
    expect(signature(after)).toEqual(signature(old));
    expect(simplifyCombinationRules(after,'s.md').patches).toEqual([]);
  });
  it.each(['\n','\r\n'])('preserves all original bytes and day markers with %j endings', eol => {
    const original = ('\uFEFF'+bare+'\n---\n### Days\n==**2026-10-23 = 0 ☁️😎**== annotation\n### Bookmarks\nKeep this prose.\n').replace(/\n/g,eol);
    const change = addCombinationRules(original,'summary.md');expect(change.patches).toHaveLength(1);
    const p = change.patches[0]!, after = applyPatches(original,change.patches);
    expect(p.before).toBe('');expect(after.slice(0,p.start)+after.slice(p.start+p.after.length)).toBe(original);
    expect(after).toContain('==**2026-10-23 = 0 ☁️😎**== annotation');
    expect(parseMarkerCriteria(after,'summary.md').combinations).toHaveLength(4);
    expect(addCombinationRules(after,'summary.md').patches).toEqual([]);
    expect(rowMarkers('2026-10-23 = 0 ☁️😎')).toContain('☁');
  });
  it('does not overwrite custom rules', () => {
    expect(()=>addCombinationRules(bare+'#### Combination rules\n- exclusive | ☁️, 🕶️ | custom\n','s.md')).toThrow('manual review');
  });
});
