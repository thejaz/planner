import type { Day, Diagnostic } from './model';

/**
 * Ignored note checks (0.2.142). An ignore names one row exactly as written: its note, the
 * kind of check and a fingerprint of the row text. Editing the row brings the check back.
 * Kept in plugin settings only; notes never change. Only advisory checks whose advice is
 * "nothing to do if intended" qualify; disputed totals and unreadable rows never do.
 */
export function checkKey(path: string, code: string, raw: string): string {
  let hash = 2166136261;
  const text = raw.trim();
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${path}|${code}|${(hash >>> 0).toString(36)}`;
}
const ADVISORY = new Set(['credit-exceeds-elapsed', 'interval-difference']);
export function ignorable(check: Diagnostic): boolean { return !check.blocks && ADVISORY.has(check.code); }
/** Ignores that still match a check in these days; the rest lapsed when their rows changed. */
export function activeIgnores(days: Iterable<Pick<Day, 'path' | 'lines' | 'diagnostics'>>, ignored: ReadonlySet<string>): Set<string> {
  const active = new Set<string>();
  for (const day of days) for (const check of day.diagnostics) {
    const key = keyFor(day, check);
    if (ignorable(check) && ignored.has(key)) active.add(key);
  }
  return active;
}
export function keyFor(day: Pick<Day, 'path' | 'lines'>, check: Diagnostic): string {
  return checkKey(day.path, check.code, day.lines[check.line]?.raw ?? '');
}
/** The day's checks that are still shown. */
export function visibleChecks(day: Pick<Day, 'path' | 'lines' | 'diagnostics'>, ignored: ReadonlySet<string>): Diagnostic[] {
  return day.diagnostics.filter(check => !ignorable(check) || !ignored.has(keyFor(day, check)));
}
/** One entry per distinct check, with every line it applies to, in note order. */
interface CheckGroup { code: string; message: string; action: string; blocks: boolean; checks: Diagnostic[] }
export function groupChecks(checks: Diagnostic[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();
  for (const check of [...checks].sort((a, b) => a.line - b.line)) {
    const key = `${check.code}\n${check.message}\n${check.action}`;
    const group = groups.get(key) ?? { code: check.code, message: check.message, action: check.action, blocks: check.blocks, checks: [] };
    group.checks.push(check); group.blocks ||= check.blocks; groups.set(key, group);
  }
  return [...groups.values()];
}
