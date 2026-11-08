import { ANY_SUMMARY_ROW_PREFIX } from './syntax';
import { linesOf } from './model';
import { parseCombinations, combinationProblems, combineMarkers } from './marker-combinations';
import type { CombinationRule } from './marker-combinations';

export const emojiKeys = ['😣', '✌', '😎', '🦥', '❄', '🔥', '🕶', '☁'];
export const canonical = (text: string): string => text.replace(/[\uFE0E\uFE0F]/g, '');
export type MarkerRole = 'ordinary' | 'weekend' | 'earned' | 'context' | 'formatting';
export interface MarkerCriterion { key: string; label: string; symbol: string; role: MarkerRole; min?: number; max?: number; context?: string; formatting?: boolean }
export interface MarkerIssue { path: string; line: number; message: string }
export interface MarkerCriteria { definitions: MarkerCriterion[]; issues: MarkerIssue[]; combinations: CombinationRule[] }
export function parseMarkerCriteria(text: string, path: string): MarkerCriteria {
  const result: MarkerCriteria = { definitions: [], issues: [], combinations: [] };
  let active = false, fence = false;
  for (const line of linesOf(text)) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line.raw.replace(/^\uFEFF/, ''));
    if (heading) { active = /^criteria\s*&\s*markers$/i.test(heading[1]!); continue; }
    if (!active || !/^\s*-\s/.test(line.raw)) continue;
    const parts = line.raw.replace(/^\s*-\s*/, '').split('|').map(part => part.trim());
    const token = canonical(parts[0]!.replace(/\*\*|==/g, '')).toLowerCase();
    const key = token === 'highlights' ? 'highlight' : token === 'bolds' ? 'bold' : token;
    const issue = (message: string) => result.issues.push({ path, line: line.index, message });
    if (![...emojiKeys, 'highlight', 'bold'].includes(key)) { issue(`"${parts[0]}" is not a marker the planner knows. Use an emoji, or highlight or bold for a formatting rule.`); continue; }
    if (result.definitions.some(def => def.key === key)) { issue(`${parts[0]} is defined more than once. Keep one line for it.`); continue; }
    const range = /^(\d+)\s*[-–]\s*(\d+)\s*m$/i.exec(parts[1] ?? '');
    const minimum = /^(?:≥|>=)\s*(\d+)\s*m$/i.exec(parts[1] ?? '');
    const min = range ? Number(range[1]) : minimum ? Number(minimum[1]) : undefined;
    const max = range ? Number(range[2]) : minimum ? Infinity : undefined;
    if (min !== undefined && (!Number.isSafeInteger(min) || (max !== Infinity && !Number.isSafeInteger(max)) || max! < min)) {
      issue(`Invalid minute range for ${parts[0]}. Use 30-149m or ≥300m.`); continue;
    }
    if (min === undefined && /\d|[≥<>]/.test(parts[1] ?? '')) { issue(`Unrecognised minute range for ${parts[0]}. Use 30-149m or ≥300m.`); continue; }
    const rule = (parts[1] ?? '').toLowerCase();
    const description = parts.slice(min !== undefined || rule === 'any' || rule === 'formatting' ? 2 : 1).join(' | ');
    const contextual = /\(context(?:\s*:\s*([a-z][a-z0-9 -]*))?\)/i.exec(description);
    if ((description.match(/\(context\b/gi) ?? []).length > 1) { issue(`${parts[0]} has more than one (context: ...). Keep one.`); continue; }
    const legacyContext = key === '✌' ? 'excused' : key === '🕶' ? 'at-ease' : key === '☁' ? 'buffer' : undefined;
    const context = contextual ? contextual[1]?.trim().toLowerCase().replace(/\s+/g, '-') ?? legacyContext : undefined;
    const formatting = rule === 'formatting' || key === 'highlight' || key === 'bold' || /\(formatting\)/i.test(description);
    const expectedContext = legacyContext;
    if (context && context !== expectedContext) { issue(`${parts[0]} has a context that does not match it. Use excused with ✌, at-ease with 🕶️, or buffer with ☁️.`); continue; }
    if (expectedContext && context !== expectedContext) { issue(`Add (context: ${expectedContext}) to ${parts[0]}.`); continue; }
    if (context && result.definitions.some(def => def.context === context)) { issue(`The context ${context} is used more than once. Keep one line for it.`); continue; }
    if (formatting && !['highlight', 'bold'].includes(key)) { issue(`Only highlights and bolds use formatting rules.`); continue; }
    if (['🕶', '☁'].includes(key) && (min !== undefined || (rule !== 'any' && parts.length !== 2))) { issue(`${parts[0]} applies to any day: write any instead of a minute range.`); continue; }
    if (!formatting && !['🕶', '☁'].includes(key) && min === undefined) { issue(`Add a minute range for ${parts[0]}.`); continue; }
    const label = description.replace(/\s*\((?:context(?::[^)]*)?|formatting)\)/gi, '').trim();
    if (!label) { issue(`Add a description for ${parts[0]} after |.`); continue; }
    const role: MarkerRole = formatting ? 'formatting' : context ? 'context' : key === '😣' ? 'ordinary' : key === '😎' ? 'weekend' : 'earned';
    result.definitions.push({ key, label, symbol: parts[0]!.replace(/\*\*|==/g, ''), role, min, max, context, formatting });
  }
  if (!result.definitions.length) result.issues.push({ path, line: 0, message: 'No marker definitions were found. Add the legend under a Criteria & Markers heading in thejaz-criteria.md.' });
  const combinations = parseCombinations(text, path, result.definitions.filter(d => !d.formatting).map(d => d.key));
  result.combinations = combinations.rules; result.issues.push(...combinations.issues);
  const productive = result.definitions.filter(def => ['🦥', '❄', '🔥'].includes(def.key) && def.min !== undefined);
  for (const [i, first] of productive.entries()) for (const second of productive.slice(i + 1)) {
    if (result.combinations.some(r => r.kind === 'exclusive' && r.markers.includes(first.key) && r.markers.includes(second.key)) && first.min! <= second.max! && second.min! <= first.max!) result.issues.push({ path, line: 0,
      message: `The minute ranges of ${first.symbol} and ${second.symbol} overlap. Give each marker its own range.` });
  }
  return result;
}

export const inRange = (definition: MarkerCriterion, value: number): boolean => definition.min === undefined || value >= definition.min && value <= definition.max!;
export function markerRange(definition: MarkerCriterion): string {
  return definition.min === undefined ? 'Any minutes' : definition.max === Infinity ? `>=${definition.min}m` : `${definition.min}-${definition.max}m`;
}

export const CANONICAL_LEGEND = `### Criteria & Markers

- 😣 | 0-29m | no-pro
- ✌ | 0-29m | no-pro (context: excused)
- 😎 | 0-29m | no-pro weekends
- 🦥 | 30-149m | low-pro
- ❄️ | 150-299m | cool
- 🔥 | >=300m | hot
- 🕶️ | any | at-ease (context: at-ease)
- ☁️ | any | buffer (context: buffer)
- ==highlights== | formatting | no-pro
- **bolds** | formatting | weekends

Names are descriptive; marker identities and context IDs determine behavior.
Only 😣 receives whole-row highlighting.

#### combination rules

- exclusive | 😣, ✌, 😎, 🦥, ❄️, 🔥
- exclusive | ✌, 🕶️, ☁️
- replaces | ✌ | 😣, 😎
- replaces | 🕶️, ☁️ | 😣, ✌, 😎
`;
// Only the leading marker run belongs to the record, never an annotation's emoji.
const RECORD = /^(\s*(?:(?:==|\*\*|\*|~~)\s*)*(?:\d{4}-\d{2}-\d{2}\s*=|\d{2}-\d{2}\s*:)\s*(?:\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m?|\?))(\s*(?:(?:🦥|❄[\uFE0E\uFE0F]?|🔥|😎|☁[\uFE0E\uFE0F]?|🕶[\uFE0E\uFE0F]?|😣|✌[\uFE0E\uFE0F]?)\s*)*)(.*)$/u;
export function rowMarkers(raw: string): string {
  const record = RECORD.exec(raw);
  return record ? canonical(record[2]!) : ANY_SUMMARY_ROW_PREFIX.test(raw) ? '' : canonical(raw);
}
export function replaceRowSymbols(raw: string, symbols: string): string {
  const record = RECORD.exec(raw);
  if (!record) throw new Error('Use a readable summary row, such as 2026-05-24 = 300.');
  const suffix = record[3]!;
  const prefixFormatting = ANY_SUMMARY_ROW_PREFIX.exec(record[1]!)?.[1] ?? '';
  const suffixToken = /^(==|\*\*|\*|~~)/.exec(suffix)?.[1];
  const closing = suffixToken && prefixFormatting.includes(suffixToken);
  const separator = suffix && !closing ? /\s+$/.exec(record[2]!)?.[0] ?? ' ' : '';
  return record[1]!.trimEnd() + (symbols ? ' ' + symbols : '') + separator + suffix;
}
/** Remove only a highlight that opens around the date row, retaining bold and inline notes. */
export function stripRowHighlight(raw: string): string {
  const prefix = /^(\s*(?:(?:==|\*\*)\s*)*)(?=\d{4}-\d{2}-\d{2}\s*=|\d{2}-\d{2}\s*:)/.exec(raw);
  if (!prefix || !prefix[1]!.includes('==')) return raw;
  const close = raw.indexOf('==', prefix[0].length);
  if (close < 0) return raw;
  return prefix[1]!.replace('==', '') + raw.slice(prefix[0].length, close) + raw.slice(close + 2);
}
export function formatRowHighlight(raw: string, symbols: string): string {
  const clean = stripRowHighlight(raw);
  if (!symbols.includes('😣')) return clean;
  const record = RECORD.exec(clean);
  if (!record) return clean;
  const closing = /^(?:\*\*|\*|~~)*/.exec(record[3]!)![0];
  const end = clean.length - record[3]!.length + closing.length;
  return `==${clean.slice(0, end).trimEnd()}==` + clean.slice(end);

}
export function selectMarkers(value: number, date: string, existing: string,
  thresholds: {low: number; cool: number; hot: number}, weekends: number[], criteria?: MarkerCriteria): string {
  if (!criteria) {
    // Legacy numeric defaults do not imply any combination policy.
    const defaults = CANONICAL_LEGEND.split('#### combination rules')[0]!
      .replaceAll('0-29m', `0-${thresholds.low - 1}m`).replace('30-149m', `${thresholds.low}-${thresholds.cool - 1}m`)
      .replace('150-299m', `${thresholds.cool}-${thresholds.hot - 1}m`).replace('>=300m', `>=${thresholds.hot}m`);
    criteria = parseMarkerCriteria(defaults, 'built-in minute defaults');
  }
  if (criteria?.issues.length) throw new Error(criteria.issues[0]!.message);
  const marks = rowMarkers(existing);
  const keys = [...marks.matchAll(/🦥|❄|🔥|😎|☁|🕶|😣|✌/gu)].map(match => match[0]);
  if (criteria) {
    const definitions = keys.map(key => criteria.definitions.find(d => d.key === key));
    if (definitions.some(d => !d)) throw new Error('Recorded marker has no valid definition. Correct the legend before updating.');
    const eligible = definitions.filter((d): d is MarkerCriterion => !!d && inRange(d, value));
    const expiredNumeric = definitions.some(d => d && d.min !== undefined && !inRange(d, value));
    if (!criteria.combinations.length && eligible.length && !expiredNumeric) {
      // Permissive policy: preserve the saved combination, rather than inventing a new one.
      if (eligible.length === keys.length) return RECORD.exec(existing)?.[2]?.trim() ?? existing.trim();
      return eligible.map(d => d.symbol).join('');
    }
    const contexts = eligible.filter(d => d.context);
    const contextErrors = combinationProblems(contexts.map(d => d.key), criteria.combinations.filter(r => r.kind === 'exclusive'));
    if (contextErrors.length) throw new Error(contextErrors[0]);
    const earned = criteria.definitions.filter(d => d.role === 'earned' && inRange(d, value));
    const low = criteria.definitions.find(d => d.role === 'ordinary' && inRange(d, value));
    if (!earned.length && !low) throw new Error(`No productivity criterion covers ${value}m. Add or correct its minute range in Criteria & Markers.`);
    const weekend = weekends.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const choice = earned[0] ?? (marks.includes('😣') ? low : criteria.definitions.find(d => d.role === (weekend ? 'weekend' : 'ordinary') && inRange(d, value)));
    if (!choice) throw new Error(`No ${weekend ? 'weekend' : 'ordinary'} criterion covers ${value}m. Correct the legend.`);
    const selected = combineMarkers([...(criteria.combinations.length ? contexts : eligible).map(d => d.key), choice.key], criteria.combinations);
    return selected.map(key => criteria.definitions.find(d => d.key === key)!.symbol).join('');
  }
  throw new Error('Marker criteria could not be read.');
}
