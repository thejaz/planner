import { intervalBetween } from './model';
import { unknownEndTime } from './changes';
import type { Entry } from './model';

/**
 * Plain-language reading of one activity as it will be saved: end time and the
 * elapsed time since the previous end, how credit is assigned, and completion.
 */
export function interpretEntry(entry: Entry, previous: Entry | undefined): string[] {
  const lines: string[] = [];
  const elapsed = previous?.clock != null && entry.clock !== null ? intervalBetween(previous.clock, entry.clock) : null;
  if (entry.label === '...' && entry.time === null) return ['Intentional gap: no credit; this row breaks the time chain.'];
  if (unknownEndTime(entry)) lines.push('End time unknown; this row breaks the time chain.');
  else if (entry.time === null) lines.push('Unknown activity: enter its end time and minutes when known.');
  else {
    lines.push(previous?.clock == null ? `Ends ${entry.time}. No previous end time, so elapsed time is unknown.`
      : elapsed === null ? `Ends ${entry.time}, before the previous end time ${previous.time}.`
      : `Ends ${entry.time}: ${elapsed}m after ${previous.time} (${previous.label}).`);
  }
  if (entry.label === '...') { lines.push('Intentional gap: no credit.'); return lines; }
  const [credit = '', recorded] = entry.duration.split('/').map(part => part.trim());
  const unknown = entry.unknownCredit || entry.duration === '?';
  const projects = Object.entries(entry.credits), projectTotal = projects.reduce((sum, [, minutes]) => sum + minutes, 0);
  if (unknown) lines.push('Project credit unknown. Enter minutes, or one amount per project such as 20-10.');
  else if (entry.duration === 'n/a') lines.push('No project credit (n/a).');
  else {
    const amount = credit.split(/[-+|]/).reduce((sum, value) => sum + Number(value), 0);
    lines.push(projects.length
      ? `${entry.checked ? 'Project credit' : 'Potential project credit'}: ${projects.map(([code, minutes]) => `${code} ${minutes}m`).join(' + ')}${projects.length > 1 ? ` = ${projectTotal}m` : ''}.`
      : `Allocated time: ${amount}m; no project credit.`);
  }
  // A recorded elapsed time is only news when it differs from the clock.
  if (recorded && /^\d+$/.test(recorded) && Number(recorded) !== elapsed) lines.push(`Recorded elapsed time: ${recorded}m.`);
  lines.push(unknown ? `${entry.checked ? 'Completed' : 'Planned'}: project credit is unresolved.`
    : projectTotal > 0 ? entry.checked ? `Completed: ${projectTotal}m counts toward project totals.` : 'Planned: project credit is not counted until completed.'
      : `${entry.checked ? 'Completed' : 'Planned'}: no project credit.`);
  return lines;
}
