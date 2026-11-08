import type { Day } from './model';
import { disputed } from './reader';
import { summaryForDate } from './project-registry';
import { materialPatches, summaryPatches } from './history';
import type { Summary } from './history';

/** Verification only: never derive repairs from the obsolete snapshot. */
export function checkpointIssues(days: Day[], summaries: Summary[], dates: Set<string>, through: string): string[] {
  const issues: string[] = [], targets = new Map<Summary, Set<string>>();
  for (const date of dates) {
    const matches = days.filter(day => day.date === date);
    if (matches.length !== 1 || disputed(matches[0]!)) {
      issues.push(`${date}: this day's note is missing, duplicated or has conflicting totals. Open it, fix it, then choose Check again.`); continue;
    }
    if (date > through) { issues.push(`${date}: this date is in the future, so its summary check cannot run yet.`); continue; }
    try {
      const summary = summaryForDate(date, summaries);
      targets.set(summary, new Set([...(targets.get(summary) ?? []), date]));
    } catch (error) { issues.push((error as Error).message); }
  }
  for (const [summary, owned] of targets) {
    const result = summaryPatches(summary, days, through, owned);
    issues.push(...result.issues.map(issue => `${summary.path}: ${issue}`));
    if (materialPatches(result.patches).length) issues.push(`${summary.path}: some figures or markers in this summary do not match the daily notes. Open it to compare, then choose Check again.`);
  }
  return issues;
}
