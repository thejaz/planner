/** Errors reported by actions are transient; a later check clears them unless another notice has replaced them. */
export class TransientNotices {
  private reported = new Map<string, string>();
  constructor(private issues: Map<string, string>) {}
  report(key: string, text: string): void { this.issues.set(key, text); this.reported.set(key, text); }
  clear(keys?: string[]): void {
    for (const [key, text] of this.reported) {
      if (keys && !keys.includes(key)) continue;
      if (this.issues.get(key) === text) this.issues.delete(key);
      this.reported.delete(key);
    }
  }
}
/**
 * Shorten repeated per-day messages (`YYYY-MM-DD: text`) to the first few dates and a
 * count, so one problem across many days reads as one line. `fullList` names where the
 * complete list is shown. Other messages pass through in order.
 */
export function groupDays(issues: string[], fullList = '', shown = 3): string[] {
  const groups = new Map<string, string[]>(), order: string[] = [];
  for (const issue of issues) {
    const day = /^(\d{4}-\d{2}-\d{2}): ([\s\S]*)$/.exec(issue);
    const key = day ? day[2]! : issue;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    if (day) groups.get(key)!.push(day[1]!);
  }
  return order.flatMap(text => {
    const dates = [...new Set(groups.get(text))].sort();
    if (!dates.length) return [text];
    if (dates.length <= shown) return dates.map(date => `${date}: ${text}`);
    return [`${dates.slice(0, shown).join(', ')} and ${dates.length - shown} more days: ${text}${fullList ? ` ${fullList}` : ''}`];
  });
}
