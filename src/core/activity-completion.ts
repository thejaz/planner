import { activityTarget, replaceActivityComponent } from './activity-target';
import type { ActivityReplacement } from './activity-target';

/** Tab completes a finished prefix; exact names and protected fields keep native navigation. */
export function activityCompletion(text: string, start: number, end: number, helpers: string[]): (ActivityReplacement & { name: string; suffix: string }) | null {
  if (start !== end) return null;
  try {
    const target = activityTarget(text, start, end);
    if (start < target.from || start > target.to || text.slice(start, target.to).trim()) return null;
    const prefix = text.slice(target.from, start);
    if (!prefix || /\s$/.test(prefix)) return null;
    const query = prefix.toLowerCase();
    if (helpers.some(name => name.toLowerCase() === query)) return null;
    const name = helpers.find(name => name.toLowerCase().startsWith(query));
    return name ? { ...replaceActivityComponent(text, start, end, name), name, suffix: name.slice(prefix.length) } : null;
  } catch { return null; }
}
