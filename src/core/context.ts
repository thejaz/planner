import { rowMarkers, replaceRowSymbols, formatRowHighlight, inRange } from './marker-rules';
import type { Summary } from './history';
import { marker } from './history';
import type { Patch } from './model';
import { patch } from './changes';
import { parseMarkerCriteria } from './review-extras';
import type { MarkerCriteria } from './review-extras';

export type DayContext = string;
export function contextOptions(criteria: MarkerCriteria) {
  return criteria.definitions.filter(def => def.context && !def.formatting);
}
export interface ContextSnapshot {
  date: string; summary: Summary; criteria: MarkerCriteria; source: string; sourceText: string;
  current: DayContext; minutes: number; token: string;
}
export function contextResult(summary: Summary, date: string, context: DayContext, criteria: MarkerCriteria) {
  const rows = summary.rows.filter(row => row.date === date);
  if (rows.length !== 1 || rows[0]!.value === null) throw new Error('This day needs one summary row with recorded minutes. Open its summary source to correct the row.');
  const value = rows[0]!.value;
  const definition = contextOptions(criteria).find(def => def.context === context);
  if (context !== 'ordinary' && !definition) throw new Error('choose one context defined in the legend, or ordinary day. existing markers are unchanged.');
  const eligible = definition && inRange(definition, value);
  const symbols = marker(value, date, eligible ? definition.symbol : '', summary.thresholds, summary.weekends ?? [5], criteria);
  const labels = criteria.definitions.filter(def => !def.formatting && rowMarkers(symbols).includes(def.key))
    .sort((a, b) => symbols.indexOf(a.key) - symbols.indexOf(b.key)).map(def => def.label);
  return { symbols, labels, expires: !!definition && !eligible, definition };
}
export function readContext(raw: string, criteria: MarkerCriteria): DayContext {
  const clean = rowMarkers(raw);
  const found = contextOptions(criteria).filter(def => clean.includes(def.key));
  return found.length > 1 ? 'multiple' : found[0]?.context ?? 'ordinary';
}
export function contextPatch(summary: Summary, date: string, context: DayContext, criteria = parseMarkerCriteria(summary.text, summary.path)): Patch {
  const rows = summary.rows.filter(row => row.date === date);
  if (rows.length !== 1 || rows[0]!.value === null) throw new Error('this day needs one summary row with a recorded total before setting context.');
  const row = rows[0]!, line = summary.lines[row.line]!;
  const { symbols } = contextResult(summary, date, context, criteria);
  const next = formatRowHighlight(replaceRowSymbols(line.raw, symbols), symbols);
  return patch(summary.text, line.start, line.end, next);
}
