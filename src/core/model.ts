/**
 * Defaults for calls that name no project codes or groups. Empty in the plugin, which
 * always passes the registered ones; the test suite fills them with example codes.
 */
export const DEFAULT_CODES: string[] = [];
export const DEFAULT_GROUPS: string[][] = [];
/** This computer's time zone, the default for "now" and Today. */
export function systemTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
/** One activity name; a hyphen is part of the name (check-in). */
export const ACTIVITY_NAME = String.raw`[a-z][a-z0-9]*(?:-[a-z0-9]+)*`;
/**
 * A component's leading name, ending at a space, `(`, `%`, `!` or the end: `car's` and
 * `chp_notes` name no project. Retired `+`, `|` and `/` joiners are still read so they can be reported.
 */
const LEADING = new RegExp(String.raw`^${ACTIVITY_NAME}(?:\s*[+|/]\s*${ACTIVITY_NAME})*(?=\s|$|[%!(])`, 'i');
/**
 * One part of an activity group. `name` is its leading activity name, or '' for an
 * ordinary part without one (`2 chapters`, non-Latin text) that still holds its place for
 * amounts. The part's text (`start`..`end`) runs to the next joiner and includes words and
 * parenthesized context. `joiner` separates it from the previous part ('' for the first).
 */
export interface ActivityUnit { name: string; nameStart: number; nameEnd: number; start: number; end: number; joiner: string }
export interface ActivityGroup { units: ActivityUnit[]; issues: string[] }
/**
 * The whole label read as activities joined by `&` outside parentheses. Each part's first
 * word names it; later words and parentheses are its description and never add credit.
 */
export function activityGroup(label: string): ActivityGroup {
  const issues: string[] = [], cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) break;
    else if (c === '&' && depth === 0) cuts.push(i);
  }
  if (depth !== 0) issues.push(`"${label.trim()}" has unbalanced parentheses. Close each ( with ), such as lunch (with friends).`);
  const units: ActivityUnit[] = [];
  let from = 0, previousEnd = 0;
  for (const [index, to] of [...cuts, label.length].entries()) {
    const part = label.slice(from, to), lead = part.length - part.trimStart().length, start = from + lead, end = from + part.trimEnd().length;
    if (start >= end) {
      if (cuts.length) issues.push(`"${label.trim()}" has an empty activity beside &. Remove the extra &, such as chp & mdr.`);
    } else {
      const names = LEADING.exec(label.slice(start, end))?.[0];
      if (!names) {
        // Alone, such a label has no parts, as before; in a group it is an ordinary part.
        if (cuts.length) {
          units.push({ name: '', nameStart: start, nameEnd: start, start, end, joiner: units.length ? label.slice(previousEnd, start) : '' });
          previousEnd = end;
        }
      } else {
        const found = [...names.matchAll(new RegExp(ACTIVITY_NAME, 'gi'))];
        for (const [at, match] of found.entries()) {
          const nameStart = start + match.index, nameEnd = nameStart + match[0].length;
          units.push({ name: match[0], nameStart, nameEnd, start: at ? nameStart : start, end: at < found.length - 1 ? nameEnd : end,
            joiner: units.length ? label.slice(previousEnd, at ? nameStart : start) : '' });
          previousEnd = at < found.length - 1 ? nameEnd : end;
        }
      }
    }
    from = (cuts[index] ?? label.length) + 1;
  }
  return { units, issues };
}
/** The leading names of every part, as written. */
export function activityNames(label: string): string[] { return activityGroup(label).units.map(unit => unit.name); }
/** Rebuild a label from some of its parts, keeping their text and the joiners between kept parts. */
export function keepUnits(label: string, units: ActivityUnit[], kept: number[], rename: (unit: ActivityUnit, text: string) => string = (_, text) => text): string {
  if (!units.length) return label;
  const first = units[0]!.start, last = units.at(-1)!.end;
  return label.slice(0, first) + kept.map((i, at) => (at ? units[i]!.joiner : '') + rename(units[i]!, label.slice(units[i]!.start, units[i]!.end))).join('') + label.slice(last);
}
/** Writers space the `&` joiner (` & `); everything else in the label is kept as written. */
export function canonicalJoiners(label: string): string {
  const { units } = activityGroup(label);
  return keepUnits(label, units.map(u => /&/.test(u.joiner) ? { ...u, joiner: ' & ' } : u), units.map((_, i) => i));
}
export interface Line { index: number; start: number; end: number; fullEnd: number; raw: string; eol: string }
export interface Diagnostic {
  line: number; code: string; message: string; action: string;
  severity: 'info' | 'warning' | 'error'; blocks: boolean;
}
export interface Entry {
  line: number; raw: string; checked: boolean; section: string;
  time: string | null; startTime: string | null; clock: number | null;
  interval: number | null; duration: string; label: string;
  credits: Record<string, number>; unknownCredit: boolean;
  elapsed: number | null; legacy: boolean;
}
export interface Footer {
  line: number; code: string; value: number; numberStart: number; numberEnd: number;
}
export interface Day {
  path: string; date: string | null; text: string; lines: Line[]; eol: string;
  entries: Entry[]; footers: Footer[]; recorded: Record<string, number>;
  recordedSum: number | null; diagnostics: Diagnostic[]; legacy: boolean; recordedOnly: boolean;
}
export interface Totals {
  projects: Record<string, number>; sum: number; planned: Record<string, number>;
  plannedSum: number; complete: boolean;
}
export interface Patch { start: number; end: number; before: string; after: string }
export interface Change { path: string; base: string; patches: Patch[]; label: string; strictSource?: boolean }

export function linesOf(text: string): Line[] {
  const result: Line[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)) {
    if (!match[0]) continue;
    const start = match.index;
    result.push({ index: result.length, start, end: start + match[1]!.length,
      fullEnd: start + match[0].length, raw: match[1]!, eol: match[2]! });
  }
  return result;
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function dateFromPath(path: string): string | null {
  const match = /(?:^|[/\\])(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  return match && validDate(match[1]!) ? match[1]! : null;
}
export function dateAdd(date: string, delta: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
export function localNow(now = new Date(), zone = systemTimeZone()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function clockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(time);
  if (match && +match[1]! === 24 && +match[2]! === 0) return 1440;
  if (!match || +match[1]! > 23 || +match[2]! > 59) return null;
  return +match[1]! * 60 + +match[2]!;
}
export function clockText(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;
}
export function intervalBetween(previous: number | null, next: number | null): number | null {
  if (previous === null || next === null) return null;
  if (next >= previous) return next - previous;
  return previous >= 18 * 60 && next < 6 * 60 ? next + 1440 - previous : null;
}
export function minutes(value: string): number | null {
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number.isSafeInteger(Number(v)) ? Number(v) : null;
  if (!/^(?:(?:\d+\s*h)\s*)?(?:\d+\s*m)?$/i.test(v) || !v) return null;
  return [...v.matchAll(/(\d+)\s*([hm])/gi)].reduce((n, m) => n + +m[1]! * (m[2]!.toLowerCase() === 'h' ? 60 : 1), 0);
}
export function displayMinutes(value: number): string {
  return `${Math.floor(value / 60)}h ${(value % 60).toString().padStart(2, '0')}m`;
}
/** Codes in registry order (`order`), then alphabetically. */
export function orderedCodes(codes: string[], order: string[] = DEFAULT_CODES): string[] {
  return [...new Set(codes)].sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
  });
}
