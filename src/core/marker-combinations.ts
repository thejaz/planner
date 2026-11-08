import { linesOf } from './model';

export interface CombinationRule { kind: 'exclusive' | 'replaces'; markers: string[]; targets: string[]; label: string; line: number }
export interface CombinationIssue { path: string; line: number; message: string }
export const COMBINATION_RULES = `#### combination rules

- exclusive | 😣, ✌, 😎, 🦥, ❄️, 🔥
- exclusive | ✌, 🕶️, ☁️
- replaces | ✌ | 😣, 😎
- replaces | 🕶️, ☁️ | 😣, ✌, 😎
`;

/** Ordinary Markdown rules; missing/empty sections intentionally have no restrictions. */
export function parseCombinations(text: string, path: string, defined: string[]) {
  const rules: CombinationRule[] = [], issues: CombinationIssue[] = [];
  let criteriaDepth = 0, activeDepth = 0, fence = '';
  const clean = (s: string) => s.replace(/[\uFE0E\uFE0F]/g, '').trim();
  const markerList = (s: string) => s.split(',').map(clean);
  for (const line of linesOf(text)) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line.raw)?.[1];
    if (delimiter) { if (!fence) fence = delimiter[0]!; else if (delimiter[0] === fence) fence = ''; continue; }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line.raw.replace(/^\uFEFF/, ''));
    if (heading) {
      const depth = heading[1]!.length, name = heading[2]!.toLowerCase();
      if (name === 'criteria & markers') { criteriaDepth = depth; activeDepth = 0; }
      else if (criteriaDepth && depth <= criteriaDepth) { criteriaDepth = 0; activeDepth = 0; }
      else if (criteriaDepth && name === 'combination rules') activeDepth = depth;
      else if (activeDepth && depth <= activeDepth) activeDepth = 0;
      continue;
    }
    if (!activeDepth || !/^\s*-\s/.test(line.raw)) continue;
    const parts = line.raw.replace(/^\s*-\s*/, '').split('|').map(s => s.trim());
    const issue = (message: string) => issues.push({ path, line: line.index, message });
    const kind = parts[0]!.toLowerCase();
    if (!['exclusive', 'replaces'].includes(kind) || (kind === 'exclusive' ? parts.length < 2 || parts.length > 3 : parts.length !== 3)) { issue('Write a combination rule as exclusive | markers separated by commas (an optional name may follow), or replaces | markers | markers.'); continue; }
    const markers = markerList(parts[1]!), targets = kind === 'replaces' ? markerList(parts[2]!) : [];
    const all = [...markers, ...targets];
    if (all.some(key => !defined.includes(key)) || new Set(all).size !== all.length) { issue('A combination rule can only name emoji markers defined in this legend, each once.'); continue; }
    if (kind === 'exclusive' && markers.length < 2) { issue('An exclusive rule needs at least two markers.'); continue; }
    if (rules.some(r => r.kind === kind && [...r.markers].sort().join() === [...markers].sort().join() && [...r.targets].sort().join() === [...targets].sort().join())) { issue('Duplicate combination rule. Keep one definition.'); continue; }
    rules.push({ kind: kind as CombinationRule['kind'], markers, targets, label: kind === 'exclusive' ? parts[2] ?? '' : '', line: line.index });
  }
  const edges = new Map<string, string[]>();
  for (const r of rules.filter(r => r.kind === 'replaces')) for (const source of r.markers) edges.set(source, [...edges.get(source) ?? [], ...r.targets]);
  function cyclic(key: string, active = new Set<string>()): boolean {
    if (active.has(key)) return true;
    return (edges.get(key) ?? []).some(next => cyclic(next, new Set([...active, key])));
  }
  if ([...edges.keys()].some(key => cyclic(key))) issues.push({ path, line: rules.find(r => r.kind === 'replaces')!.line, message: 'These replacement rules undo each other (one replaces a marker that replaces it back). Remove one of them.' });
  return { rules, issues };
}

export function combinationProblems(keys: Iterable<string>, rules: CombinationRule[]): string[] {
  const marks = new Set(keys), problems: string[] = [];
  for (const rule of rules) {
    const present = rule.markers.filter(key => marks.has(key));
    if (rule.kind === 'exclusive' && present.length > 1) problems.push(`Combination rule${rule.label ? ` "${rule.label}"` : ''}: keep at most one of ${rule.markers.join(', ')}.`);
    if (rule.kind === 'replaces' && present.length && rule.targets.some(key => marks.has(key))) problems.push(`Combination rule: ${present.join(', ')} replaces ${rule.targets.join(', ')}; these markers must not coexist.`);
  }
  return problems;
}

/** Replacement winners are evaluated simultaneously, never by declaration order. */
export function combineMarkers(keys: string[], rules: CombinationRule[]): string[] {
  const selected = new Set(keys), suppressed = new Set<string>();
  for (const r of rules) if (r.kind === 'replaces' && r.markers.some(key => selected.has(key))) for (const target of r.targets) suppressed.add(target);
  const result = [...selected].filter(key => !suppressed.has(key));
  const errors = combinationProblems(result, rules);
  if (errors.length) throw new Error(errors[0]);
  return result;
}
