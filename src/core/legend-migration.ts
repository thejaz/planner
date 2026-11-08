import { applyPatches, patch } from './changes';
import type { Change } from './model';
import { parseSummary, marker } from './history';
import { CANONICAL_LEGEND, canonical, rowMarkers, parseMarkerCriteria, replaceRowSymbols, formatRowHighlight } from './marker-rules';

/** Deliberate, previewable migration only. Never called by indexing/startup. */
export function migrateLegend(text: string, path: string, weekends = [5]): { change: Change; issues: string[] } {
  const summary = parseSummary(text, path, weekends), patches = [], issues: string[] = [];
  const headings = summary.lines.filter(l => /^#{1,6}\s+criteria\s*&\s*markers\s*$/i.test(l.raw));
  if (headings.length !== 1) throw new Error(`${path}: expected one Criteria & Markers section.`);
  const old = parseMarkerCriteria(text, path);
  if (old.issues.length || old.definitions.length !== 10) throw new Error(`${path}: resolve legend issues before migrating.`);
  const replacement = CANONICAL_LEGEND.split('\n').filter(l => l.startsWith('- '));
  const key = (raw: string) => canonical(raw.replace(/^\s*-\s*/, '').split('|')[0]!.replace(/\*\*|==/g, '').trim());
  let active = false;
  for (const line of summary.lines) {
    if (/^#{1,6}\s/.test(line.raw)) active = line === headings[0];
    if (!active || !/^\s*-\s/.test(line.raw)) continue;
    const next = replacement.find(r => key(r) === key(line.raw));
    if (!next) throw new Error(`${path}:${line.index + 1}: unknown legend entry.`);
    if (next !== line.raw) patches.push(patch(text, line.start, line.end, next));
  }
  const legendText = applyPatches(text, patches), updated = parseSummary(legendText, path, weekends);
  for (const row of updated.rows) {
    const line = summary.lines[row.line]!, marks = rowMarkers(line.raw);
    if (!/[🕶☁]/u.test(marks)) continue;
    const contexts = ['🕶', '☁', '✌'].filter(symbol => marks.includes(symbol));
    if (row.value === null || contexts.length !== 1 || updated.rows.filter(r => r.date === row.date).length !== 1) {
      issues.push(`${path}:${row.line + 1}: unknown minutes, duplicate date or conflicting contexts; row unchanged.`); continue;
    }
    const symbols = marker(row.value, row.date, marks, updated.thresholds, weekends, updated.criteria);
    const next = formatRowHighlight(replaceRowSymbols(line.raw, symbols), symbols);
    if (next !== line.raw) patches.push(patch(text, line.start, line.end, next));
  }
  return { change: { path, base: text, patches, label: 'Update marker legend and planned-day markers' }, issues };
}
