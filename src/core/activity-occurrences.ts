import { activityNames } from './model';
import type { Day, Entry } from './model';

/** `n/a` as a word; it would otherwise read as the names n and a, joined by the retired `/`. */
const NOT_ACCOUNTED = /\bn\/a\b/gi;
/**
 * Lowercase activity names one entry contributes, once per part as written. Placeholders
 * (`?`, `...`, `>`, `n/a`) name no activity.
 */
export function occurrenceNames(entry: Pick<Entry, 'label'>): string[] {
  return activityNames(entry.label.replace(NOT_ACCOUNTED, '   ')).filter(Boolean).map(name => name.toLowerCase());
}

/**
 * How often each activity name occurs across the indexed days. Each day's names are kept,
 * so replacing or removing a day adjusts only its own counts: no rescans.
 */
export class ActivityOccurrences {
  private readonly byPath = new Map<string, string[]>();
  private readonly counts = new Map<string, number>();
  set(path: string, day: Pick<Day, 'entries'>): void {
    this.delete(path);
    const names = day.entries.flatMap(occurrenceNames);
    this.byPath.set(path, names);
    for (const name of names) this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
  delete(path: string): void {
    for (const name of this.byPath.get(path) ?? []) {
      const left = (this.counts.get(name) ?? 1) - 1;
      if (left > 0) this.counts.set(name, left); else this.counts.delete(name);
    }
    this.byPath.delete(path);
  }
  clear(): void { this.byPath.clear(); this.counts.clear(); }
  count(name: string): number { return this.counts.get(name.toLowerCase()) ?? 0; }
  /** A saved activity whose only indexed occurrence is itself. */
  isFirst(name: string): boolean { return this.count(name) === 1; }
}

/** Indexed days by path, keeping their activity occurrences current on every change. */
export class IndexedDays extends Map<string, Day> {
  readonly occurrences = new ActivityOccurrences();
  /** Starts empty: Map's constructor would add entries before the counts exist. */
  constructor() { super(); }
  override set(path: string, day: Day): this {
    this.occurrences.set(path, day);
    return super.set(path, day);
  }
  override delete(path: string): boolean { this.occurrences.delete(path); return super.delete(path); }
  override clear(): void { this.occurrences.clear(); super.clear(); }
}
