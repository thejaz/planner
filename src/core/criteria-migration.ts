import { linesOf } from './model';
import { parseMarkerCriteria } from './marker-rules';
import { parseSummary } from './history';

/**
 * One-time move of a summary's Criteria & Markers section into thejaz-criteria.md.
 * The section runs from its heading to the next `---` or same-level heading; the
 * `---` and the blank lines after it go with it, so the summary starts at its next
 * section. `issues` is non-empty when the summary would read differently afterwards.
 */
export interface CriteriaExtraction { summary: string; section: string; issues: string[] }

export function extractCriteria(text: string, path: string): CriteriaExtraction | null {
  const lines = linesOf(text);
  let fence = false, start = -1, level = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; continue; }
    const heading = !fence && /^(#{1,6})\s+criteria\s*&\s*markers\s*$/i.exec(line.raw.replace(/^\uFEFF/, ''));
    if (heading) { start = line.index; level = heading[1]!.length; break; }
  }
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const raw = lines[end]!.raw, heading = /^(#{1,6})\s/.exec(raw);
    if (/^\s*---\s*$/.test(raw) || (heading && heading[1]!.length <= level)) break;
    end++;
  }
  let sectionEnd = end;
  while (sectionEnd > start && !lines[sectionEnd - 1]!.raw.trim()) sectionEnd--;
  let cut = end;
  if (cut < lines.length && /^\s*---\s*$/.test(lines[cut]!.raw)) cut++;
  while (cut < lines.length && !lines[cut]!.raw.trim()) cut++;
  const eol = lines.find(line => line.eol)?.eol ?? '\n';
  const section = lines.slice(start, sectionEnd).map(line => line.raw).join(eol) + eol;
  const from = lines[start]!.start, to = cut < lines.length ? lines[cut]!.start : text.length;
  const summary = text.slice(0, from) + text.slice(to);
  const issues: string[] = [];
  // Line numbers move with the section; everything else must match.
  const definitions = (t: string) => { const c = parseMarkerCriteria(t, path); return JSON.stringify([c.definitions, c.combinations, c.issues.map(i => i.message)], (key, value: unknown) => key === 'line' ? undefined : value); };
  if (definitions(text) !== definitions(section)) issues.push(`${path}: the moved criteria would read differently.`);
  const before = parseSummary(text, path), after = parseSummary(summary, path, [5], parseMarkerCriteria(section, path));
  const shape = (s: typeof before) => JSON.stringify([s.start, s.end, s.thresholds, s.rows.map(r => [r.date, r.value, s.lines[r.line]!.raw]),
    s.projects.map(p => [p.code, p.value, s.lines[p.line]!.raw])]);
  if (shape(before) !== shape(after)) issues.push(`${path}: summary rows, projects or thresholds would change.`);
  return { summary, section, issues };
}
