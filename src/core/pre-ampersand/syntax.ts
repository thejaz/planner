// Frozen 0.2.103 copy (`-` joiner, `(+N code)` extra credit) for the one-time
// 0.2.61 and `&` migrations only. The plugin never imports it; do not change it.
/**
 * The Planner Markdown grammar (0.2.61): one canonical form per idea, written by
 * every writer and expected by every reader. Retired forms are still recognised so
 * readers can report them precisely and the migration can convert them.
 *
 * Daily notes:   heading `## plan for 5 oct 26` (or `## recorded totals`)
 *                `- [x] 09:30 (20-10) : prj-std`   footer `PRJ = 20` … `SUM = 30`
 *                gap `- [ ] ...`, timed gap `19:00 (n/a) : ...`, anchor `12:55 (n/a) : >`
 * Summaries:     row `2026-05-24 = 300 ☁️🔥`, project `🦉 PRJ = 300`,
 *                period `Days (2026-05-24 - 2027-05-23)`
 */

import { activityPrefix } from './model';

/** `LABEL = number`, the one form for every total. */
export function totalLine(code: string, value: number): string { return `${code} = ${value}`; }
/** A summary Days row; markers follow the minutes. */
export function summaryRow(date: string, value: number | string, markers = ''): string {
  return `${date} = ${value}${markers ? ' ' + markers : ''}`;
}
/** The restart anchor stored as typed in quick entry. */
export const ANCHOR = '>';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The day named in a plan heading: `5 oct 26` for 2026-10-05. */
export function planDate(date: string): string { return `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]} ${date.slice(2, 4)}`; }
/** `## plan for 5 oct 26`, the heading of every daily plan. */
export function planHeading(date: string): string { return `## plan for ${planDate(date)}`; }
/** Current heading: groups 1-3 = day, month, two-digit year; `?? ??? 26` in templates. */
export const PLAN_HEADING = /^##\s+plan for\s+(\d{1,2}|\?\?)\s+([a-z]{3}|\?\?\?)\s+(\d{2})\s*$/i;
/** Retired heading `## plan for 05.10.26` (or `??.??.26` in templates): groups 1-3 = day, month, year. */
export const RETIRED_PLAN_HEADING = /^(##\s+plan for\s+)(\d{2}|\?\?)\.(\d{2}|\?\?)\.(\d{2})(\s*)$/i;
/** The date a heading names, as YYYY-MM-DD, assuming the 2000s; null for templates or unreadable text. */
export function headingDate(raw: string): string | null {
  const current = PLAN_HEADING.exec(raw.trim()), retired = current ? null : RETIRED_PLAN_HEADING.exec(raw.trim());
  const day = current?.[1] ?? retired?.[2], month = current ? MONTHS.indexOf(current[2]!.toLowerCase()) + 1 : Number(retired?.[3]), year = current?.[3] ?? retired?.[4];
  if (!day || !year || !month || !/^\d+$/.test(day)) return null;
  return `20${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}
const DAY_HEADING = /^##[ \t]+(?:plan for\b.*|recorded totals(?:[ \t]+##)?[ \t]*)$/i;
/**
 * A YYYY-MM-DD note is a planner day when it says so: a `## plan for …` or
 * `## recorded totals` heading and a `SUM = n` total, outside code fences. Any
 * other note with a date name (a journal, meeting notes) is not the planner's.
 */
export function isPlannerDay(text: string): boolean {
  let fence = false, heading = false, sum = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    heading ||= DAY_HEADING.test(raw.replace(/^\uFEFF/, '').trim());
    sum ||= /^SUM\s*=\s*\d+$/.test(raw.replace(/\*\*/g, '').replace(/\[\^[^\]]+\]/g, '').trim());
  }
  return heading && sum;
}

/** Daily footer total (on a line cleaned of ** and footnote markers). Codes are uppercase. */
export const TOTAL = /^([A-Z][A-Z0-9]*)\s*=\s*(\d+)$/;
/** A daily line that looks like a total but whose value is not a whole number. */
export const MALFORMED_TOTAL = /^([A-Z][A-Z0-9]*)\s*=\s*(.*)$/;
/** Retired daily total `030 : CHP` (optionally with the old template marker `add`). */
export const RETIRED_TOTAL = /^(\d+)\s*:\s*([A-Z][A-Z0-9]*)(?:\s+add)?$/i;

const WRAP = String.raw`\s*(?:(?:==|\*\*|\*|~~)\s*)*`;
const ROW_AMOUNT = String.raw`\d+\s*h(?:\s*\d+\s*m)?|\d+(?:\s*m)?`;
/** Summary row: groups 1 = leading formatting, 2 = date, 3 = amount or ?, 4 = rest. */
export const SUMMARY_ROW = new RegExp(String.raw`^(${WRAP})(\d{4}-\d{2}-\d{2})\s*=\s*(${ROW_AMOUNT}|\?)(.*)$`, 'i');
/** Retired summary row `05-24 : 300 🔥`: groups 1 = formatting, 2 = MM-DD, 3 = amount or ?, 4 = rest. */
export const RETIRED_SUMMARY_ROW = new RegExp(String.raw`^(${WRAP})(\d{2}-\d{2})\s*:\s*(${ROW_AMOUNT}|\?)(.*)$`, 'i');
/** Either row form, for marker reading and formatting helpers. */
export const ANY_SUMMARY_ROW_PREFIX = new RegExp(String.raw`^(${WRAP})(?:\d{4}-\d{2}-\d{2}\s*=|\d{2}-\d{2}\s*:)`);
/** Summary reporting period. */
export const PERIOD = /Days\s*\((\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\)/i;
/** Retired period `Days (24.05.26 - 23.05.27)`. */
export const RETIRED_PERIOD = /Days\s*\((\d{2}\.\d{2}\.\d{2,4})\s*[-–]+\s*(\d{2}\.\d{2}\.\d{2,4})\)/i;

/** `+`, `|` or `/` joining activity names; `-` is the only joiner. `(+15 std)` extra credit is not a name. */
export function nameSeparatorIssue(label: string): string | null {
  // `n/a` is a placeholder, not two names.
  const joiner = /[+|/]/.exec(activityPrefix(label.trim()).replace(/^n\/a$/i, ''))?.[0];
  if (!joiner) return null;
  return joiner === '/' ? 'Activity names cannot contain /. Join activities with -, such as prj-lunch, with one amount each (30-0).'
    : 'Use - between activities, such as prj-std.';
}
/** Retired daily-row forms, with the message naming the current form. */
export function retiredRowIssue(duration: string, label: string, timed: boolean): string | null {
  if (label.trim() === '→') return 'Write the restart anchor as > (12:55 (n/a) : >).';
  if (timed && label.trim() === '...' && duration.trim() === '?') return 'Write a timed gap with n/a: 19:00 (n/a) : ...';
  if (/\d\s*[+|]\s*\d/.test(duration)) return 'Use - between amounts, such as 20-10.';
  return nameSeparatorIssue(label);
}
