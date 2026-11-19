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
  private readonly byPath = new Map<string, { date: string; names: string[] }>();
  private readonly counts = new Map<string, number>();
  /**
   * For each name, the dates that use it and how many notes of that date do. Two notes for
   * one date (a moved copy, a duplicate) are still one day, so they do not hide a new name.
   */
  private readonly dates = new Map<string, Map<string, number>>();
  set(path: string, day: Pick<Day, 'entries'> & { date?: string | null }): void {
    this.delete(path);
    const names = day.entries.flatMap(occurrenceNames), date = day.date ?? path;
    this.byPath.set(path, { date, names });
    for (const name of names) this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    for (const name of new Set(names)) {
      const used = this.dates.get(name) ?? new Map<string, number>();
      used.set(date, (used.get(date) ?? 0) + 1); this.dates.set(name, used);
      this.first.delete(name);
    }
  }
  delete(path: string): void {
    const { date, names } = this.byPath.get(path) ?? { date: path, names: [] };
    for (const name of names) {
      const left = (this.counts.get(name) ?? 1) - 1;
      if (left > 0) this.counts.set(name, left); else this.counts.delete(name);
    }
    for (const name of new Set(names)) {
      const used = this.dates.get(name), left = (used?.get(date) ?? 1) - 1;
      if (!used) continue;
      if (left > 0) used.set(date, left); else used.delete(date);
      if (!used.size) this.dates.delete(name);
      this.first.delete(name);
    }
    this.byPath.delete(path);
  }
  clear(): void { this.byPath.clear(); this.counts.clear(); this.dates.clear(); this.first.clear(); }
  count(name: string): number { return this.counts.get(name.toLowerCase()) ?? 0; }
  /** How many dates name this activity. */
  days(name: string): number { return this.dates.get(name.toLowerCase())?.size ?? 0; }
  /**
   * A saved activity used on one day only: new, however often that day repeats it
   * (`nve`, `org`, `nve` again). It stops being new once another day uses it.
   */
  isFirst(name: string): boolean { return this.days(name) === 1; }
  /**
   * New on `date` (0.2.138): used that day and on no earlier date. Later plans that already
   * list the name, such as days made from the same template, do not count as earlier use.
   */
  isNewOn(name: string, date: string): boolean { return this.earliest(name.toLowerCase()) === date; }
  /** Each name's earliest date, worked out once until a day using that name changes. */
  private readonly first = new Map<string, string>();
  private earliest(name: string): string | undefined {
    if (!this.first.has(name)) {
      const used = this.dates.get(name);
      if (!used?.size) return undefined;
      let min: string | undefined;
      for (const date of used.keys()) if (min === undefined || date < min) min = date;
      this.first.set(name, min!);
    }
    return this.first.get(name);
  }
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
