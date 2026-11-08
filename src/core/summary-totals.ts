import type { Day } from './model';
import { materialPatches, summaryPatches, summaryTotals } from './history';
import type { Review, Summary } from './history';
import { summaryForDate } from './project-registry';

/**
 * Each summary's period totals, worked out once for one unchanged set of days. Call
 * `invalidate` after anything that can let the days change, such as an awaited save.
 */
export class TotalsMemo {
  private totals = new Map<Summary, Review | null>();
  constructor(private days: () => Iterable<Day>, readonly through: string, private compute = summaryTotals) {}
  get(summary: Summary): Review | undefined {
    if (!this.totals.has(summary)) this.totals.set(summary, this.compute(summary, this.days(), this.through));
    return this.totals.get(summary) ?? undefined;
  }
  invalidate(): void { this.totals.clear(); }
  /** `summaryPatches` for `summary`, reusing its memoized totals. */
  patches(summary: Summary, dates: Set<string>, reconcile = false): ReturnType<typeof summaryPatches> {
    return summaryPatches(summary, this.days(), this.through, dates, reconcile, this.get(summary));
  }
}

/** Attention entries for saved edits waiting on a summary, keyed by its path. */
export const WAITING = 'summary-wait:';

/** A project whose summary figure differs from its daily notes; `summary` is null when it is not listed. */
export interface ProjectDifference { code: string; summary: number | null; notes: number }
/** Project totals that differ, once every day in the period is known; listed summary projects first. */
export function projectDifferences(summary: Summary, totals: Review | undefined): ProjectDifference[] {
  if (!totals?.complete) return [];
  const listed = summary.projects.filter(p => p.value !== (totals.projects[p.code] ?? 0))
    .map(p => ({ code: p.code, summary: p.value, notes: totals.projects[p.code] ?? 0 }));
  const missing = Object.entries(totals.projects).filter(([code, value]) => value > 0 && !summary.projects.some(p => p.code === code))
    .sort(([a], [b]) => a.localeCompare(b)).map(([code, notes]) => ({ code, summary: null, notes }));
  return [...listed, ...missing];
}
const amount = (value: number) => `${value.toLocaleString('en-US')}m`;
/** One plain line per project: both figures and how far apart they are. */
export function differenceLine(d: ProjectDifference): string {
  if (d.summary === null) return `${d.code}: not in the summary, ${amount(d.notes)} in your daily notes`;
  const gap = d.notes - d.summary;
  return `${d.code}: ${amount(d.summary)} in the summary, ${amount(d.notes)} in your daily notes (${amount(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} in the notes)`;
}
/**
 * Why saved edits have not reached a summary, and what to do. `waiting` counts the edits;
 * `paused` lists the differing project totals when the overwrite guard stopped an update.
 */
export function waitingMessage(name: string, waiting: number, paused: ProjectDifference[], daysNeedFixing: boolean): string {
  const edits = waiting ? `${waiting.toLocaleString('en-US')} saved edit${waiting === 1 ? ' is' : 's are'} waiting for ${name}. ` : '';
  if (paused.length) return `${edits}Automatic updates to ${name} are paused because its project totals differ from your daily notes, so a figure typed by hand is not overwritten: ` +
    `${paused.map(differenceLine).join('; ')}. Choose Review summary to compare, then Update summary if your daily notes are right.` +
    (waiting ? ' Retry summary update cannot finish these until the totals agree.' : '');
  if (daysNeedFixing) return `${edits}Some days in its period need fixing first. Choose Review summary; each day has its own button.`;
  return `${edits}Choose Retry summary update to add ${waiting === 1 ? 'it' : 'them'}; if ${waiting === 1 ? 'it still waits' : 'they still wait'}, choose Review summary.`;
}

/**
 * Finish each saved edit whose dates already match their summaries. `sources` is read
 * again for every edit, and the memo is cleared after each finish, because the days and
 * summaries can change while a finish is saved.
 */
export async function settlePending<T>(edits: T[], datesOf: (edit: T) => Set<string>, sources: () => Summary[],
  memo: TotalsMemo, finish: (edit: T) => Promise<void>): Promise<void> {
  for (const edit of edits) {
    const dates = datesOf(edit);
    if (!dates.size) continue;
    const owners = new Map<Summary, Set<string>>(); let blocked = false;
    for (const date of dates) {
      try { const owner = summaryForDate(date, sources()); owners.set(owner, new Set([...(owners.get(owner) ?? []), date])); }
      catch { blocked = true; }
    }
    if (!blocked && [...owners].every(([owner, owned]) => {
      const scoped = memo.patches(owner, owned);
      return !materialPatches(scoped.patches).length && !scoped.issues.length;
    })) { await finish(edit); memo.invalidate(); }
  }
}
