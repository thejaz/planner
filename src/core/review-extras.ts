import { dataRecord, stringItems } from './settings-data';
import type { Review, Summary } from './history';

/** Compact shares; do not invent a percentage for zero or inconsistent totals. */
export function formatShare(value: number, total: number | null): string {
  if (total === null || !Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value < 0 || value > total) return '—';
  if (value === 0) return '0%';
  if (value === total) return '100%';
  const percent = value / total * 100;
  if (percent < 0.1) return '<0.1%';
  if (percent > 99.9) return '>99.9%';
  return `${Number(percent.toFixed(1))}%`;
}

/** Shares use the same selected work total as the report, not a normalized subset. */
export function workShareTotal(result: Review, project = ''): number | null {
  const credit = (projects: Record<string, number>) => project ? projects[project] ?? 0 : Object.values(projects).reduce((n, v) => n + v, 0);
  if (result.rows.some(row => row.sum === null && credit(row.projects) > 0)) return null;
  if (!Number.isFinite(result.sum) || credit(result.projects) > result.sum) return null;
  return result.sum;
}

export interface ProjectGroup { name: string; projects: string[] }
export function normalizeGroups(value: unknown): ProjectGroup[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>(), assigned = new Set<string>();
  const items: unknown[] = value;
  return items.flatMap(value => {
    const item = dataRecord(value);
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') return [];
    const name = item.name.trim().slice(0, 80);
    if (!name || names.has(name.toLowerCase())) return [];
    names.add(name.toLowerCase());
    const projects = stringItems(item.projects)
      .map((code: string) => code.trim().toUpperCase()).filter((code: string) => {
        if (!/^[A-Z][A-Z0-9]*$/.test(code) || assigned.has(code)) return false;
        assigned.add(code); return true;
      });
    return [{ name, projects }];
  });
}
export function normalizeWeekends(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [5];
}
export function groupTotals(groups: ProjectGroup[], projects: Record<string, number>, project = '', knownProjects = Object.keys(projects)): { name: string; minutes: number }[] {
  const normalized = normalizeGroups(groups);
  const result = normalized.filter(group => !project || group.projects.includes(project))
    .map(group => ({ name: group.name, minutes: group.projects.filter(code => !project || code === project).reduce((sum, code) => sum + (projects[code] ?? 0), 0) }));
  const assigned = new Set(normalized.flatMap(group => group.projects));
  const unassigned = [...new Set([...knownProjects, ...Object.keys(projects)])].filter(code => !assigned.has(code) && (!project || code === project));
  if (unassigned.length) {
    const minutes = unassigned.reduce((sum, code) => sum + (projects[code] ?? 0), 0);
    const existing = result.find(group => group.name.toLowerCase() === 'unassigned');
    if (existing) existing.minutes += minutes;
    else result.push({ name: 'Unassigned', minutes });
  }
  return result;
}

export { parseMarkerCriteria } from './marker-rules';
export type { MarkerCriterion, MarkerIssue, MarkerCriteria } from './marker-rules';
import { emojiKeys, canonical, rowMarkers, selectMarkers } from './marker-rules';
import type { MarkerCriteria } from './marker-rules';
import { combinationProblems } from './marker-combinations';
export function markerCounts(summaries: Iterable<Summary>, start: string, end: string, criteria: MarkerCriteria, weekends: number[], overrideCombinations = false) {
  const counts = new Map(criteria.definitions.map(def => [def.key, 0]));
  const checkedPolicies = new Set<string>();
  const issues = [...criteria.issues], byDate = new Map<string, { summary: Summary; line: number; value: number | null }[]>();
  for (const summary of summaries) for (const row of summary.rows) if (row.date >= start && row.date <= end)
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), { summary, line: row.line, value: row.value }]);
  let countedDays = 0;
  for (const [date, rows] of byDate) {
    const row = rows[0]!, path = row.summary.path, line = row.line;
    const issue = (message: string) => issues.push({ path, line, message: `${date}: ${message}` });
    if (rows.length !== 1) { issue(`this date has more than one summary row (${rows.map(item => item.summary.path).join(', ')}). Keep one so its markers can be counted.`); continue; }
    const raw = canonical(row.summary.lines[line]!.raw), markers = rowMarkers(raw), marks = new Set<string>();
    for (const key of emojiKeys) if (markers.includes(key)) marks.add(key);
    if (/==[^\r\n]*\d{2}-\d{2}[^\r\n]*==/.test(raw)) marks.add('highlight');
    if (/\*\*[^\r\n]*\d{2}-\d{2}[^\r\n]*\*\*/.test(raw)) marks.add('bold');
    countedDays++;
    for (const key of marks) {
      const def = criteria.definitions.find(item => item.key === key);
      if (!def) { issue(`the ${key} marker in this row has no definition. Add it to the legend.`); continue; }
      counts.set(key, counts.get(key)! + 1);
      if (def.min !== undefined && (row.value === null || row.value < def.min || row.value > def.max!))
        issue(`${def.symbol} does not fit ${row.value === null ? 'unknown minutes' : row.value + 'm'} under its rule. Fix the minutes or the marker, or change the rule in the legend.`);
    }
    const combinations = overrideCombinations ? criteria.combinations : row.summary.criteria?.combinations ?? [];
    if (!overrideCombinations && !checkedPolicies.has(path)) {
      checkedPolicies.add(path);
      for (const problem of row.summary.criteria?.issues ?? []) if (!issues.some(i => i.path === problem.path && i.line === problem.line && i.message === problem.message)) issues.push(problem);
    }
    for (const problem of combinationProblems(marks, combinations)) issue(problem);
    if (marks.has('😎') && !weekends.includes(new Date(`${date}T12:00:00Z`).getUTCDay()))
      issue('😎 marks a weekend, but this date is not one of your weekend days. Fix the marker, or change Weekend days in settings.');
    let expectedSymbols = '';
    if (row.value !== null && !criteria.issues.length && (overrideCombinations || !row.summary.criteria?.issues.length)) {
      try { expectedSymbols = selectMarkers(row.value, date, raw, row.summary.thresholds, weekends, { ...criteria, combinations }); }
      catch (error) { issue(error instanceof Error ? error.message : String(error)); }
    }
    const expected = criteria.definitions.find(def => def.role === 'earned' && expectedSymbols.includes(def.key));
    if (expected && !['🦥', '❄', '🔥'].some(key => marks.has(key))) issue(`${row.value}m earns ${expected.symbol}, but the row does not have it. Add it, or fix the minutes or the rule.`);
    if (criteria.definitions.some(def => def.key === 'bold')) {
      const weekend = weekends.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
      if (weekend !== marks.has('bold')) issue(weekend
        ? 'Selected weekend day is not bold. Format the summary row in bold or change Weekend days in settings.'
        : 'Bold row is outside the selected weekend days. Correct the formatting or Weekend days in settings.');
    }
  }
  return { counts, issues, countedDays };
}
