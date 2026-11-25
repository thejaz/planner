import { activityGroup, activityNames, canonicalJoiners, DEFAULT_CODES, clockMinutes, clockText, intervalBetween, linesOf, orderedCodes, validDate } from './model';
import type { Change, Day, Entry, Patch } from './model';
import { calculate, disputed, parseDay } from './reader';
import { DEFAULT_ACTIVITY, ENTRY_DEFAULTS, validateEntryDefaults } from './entry-defaults';
import type { EntryDefaults } from './entry-defaults';
import { CREDIT_AMOUNT, UNIT_AMOUNT, equalSplit, hasPercent, resolvePercent, unitMinutes } from './entry-math';
import { ANCHOR, RETIRED_TOTAL, TOTAL, headingDate, nameSeparatorIssue, planHeading, totalLine } from './syntax';

export class Conflict extends Error {}
/** A note already holds the day's file name but is not a plan; the planner may only add its plan with consent. */
export class NameTaken extends Error {
  constructor(readonly path: string) { super(`${path} already exists and is not a plan.`); }
}
export function patch(text: string, start: number, end: number, after: string): Patch {
  return { start, end, before: text.slice(start, end), after };
}
export function linePatch(day: Day, line: number, after: string, includeEol = false): Patch {
  const source = day.lines[line];
  if (!source) throw new Conflict('That source line no longer exists.');
  return patch(day.text, source.start, includeEol ? source.fullEnd : source.end, after);
}
export function applyPatches(text: string, patches: Patch[]): string {
  let result = text, boundary = text.length + 1;
  for (const p of [...patches].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (p.start < 0 || p.end < p.start || p.end > text.length || p.end > boundary ||
      text.slice(p.start, p.end) !== p.before) throw new Conflict('The source changed. Refresh before trying again.');
    result = result.slice(0, p.start) + p.after + result.slice(p.end);
    boundary = p.start;
  }
  return result;
}
export function rebase(change: Change, current: string): Patch[] {
  if (change.base === current) return change.patches;
  if (change.strictSource) throw new Conflict('The note changed after this preview. Reopen the action to review the current source.');
  // Every patch requires unique unchanged surrounding evidence, including insertions.
  return change.patches.map(p => {
    const left = change.base.slice(Math.max(0, p.start - 64), p.start);
    const right = change.base.slice(p.end, Math.min(change.base.length, p.end + 64));
    const anchor = left + p.before + right;
    const at = current.indexOf(anchor);
    if (!anchor || at < 0 || current.indexOf(anchor, at + 1) >= 0)
      throw new Conflict('This part of the note changed elsewhere. Your edit has not been applied.');
    return patch(current, at + left.length, at + left.length + p.before.length, p.after);
  });
}
export function changeOf(day: Day, patches: Patch[], label: string): Change {
  return { path: day.path, base: day.text, patches: patches.filter(p => p.before !== p.after), label };
}
/** Reidentify the clicked activity after an async refresh; never reuse its old index. */
export function refreshedEntryIndex(original: Day, entry: Entry, current: Day | null): number {
  if (!current || current.path !== original.path) throw new Conflict('The open day changed. Select the activity again.');
  if (current.text === original.text) return original.entries.indexOf(entry);
  const matches = current.entries.map((e, i) => e.raw === entry.raw ? i : -1).filter(i => i >= 0);
  if (matches.length !== 1) throw new Conflict('That activity changed or is ambiguous. Select it again before editing.');
  return matches[0]!;
}
export function minimalDiff(before: string, after: string): Patch[] {
  if (before === after) return [];
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return [patch(before, start, endBefore, after.slice(start, endAfter))];
}
export function footerPatches(day: Day, compact = false, order: string[] = DEFAULT_CODES): Patch[] {
  if (day.recordedOnly) {
    if (disputed(day)) throw new Conflict('Correct this recorded totals note in its Markdown source before updating its summary.');
    return [];
  }
  if (day.legacy) throw new Conflict('Historical formatting is read-only in the planner. Edit the source to reconcile it.');
  if (day.diagnostics.some(d => d.blocks)) throw new Conflict('Resolve incomplete credits or conflicting times before updating totals.');
  const totals = calculate(day);
  if (!totals.complete) throw new Conflict('Some completed work has unknown credits.');
  const changes: Patch[] = [], existing = new Set(day.footers.map(f => f.code));
  for (const f of day.footers) {
    const value = f.code === 'SUM' ? totals.sum : totals.projects[f.code] ?? 0;
    if (compact && value === 0 && f.code !== 'SUM') {
      changes.push(linePatch(day, f.line, '', true));
    } else if (f.numberStart >= 0) {
      changes.push(patch(day.text, f.numberStart, f.numberEnd, value.toString()));
    }
  }
  const missing = orderedCodes(Object.keys(totals.projects).filter(c => !existing.has(c) && totals.projects[c] !== 0), order);
  if (!existing.has('SUM')) missing.push('SUM');
  if (missing.length) {
    const eol = day.eol;
    const sum = day.footers.find(f => f.code === 'SUM');
    // New codes use canonical order relative to existing rows.
    const insertions = new Map<number, string[]>();
    const allOrder = orderedCodes([...existing].filter(c => c !== 'SUM').concat(missing.filter(c => c !== 'SUM')), order);
    for (const code of missing) {
      const following = day.footers.find(f => f.code !== 'SUM' && allOrder.indexOf(f.code) > allOrder.indexOf(code));
      const target = code === 'SUM' ? undefined : following ?? sum;
      const at = target ? day.lines[target.line]!.start : day.text.length;
      const value = code === 'SUM' ? totals.sum : totals.projects[code]!;
      const rows = insertions.get(at) ?? [];
      rows.push(totalLine(code, value));
      insertions.set(at, rows);
    }
    for (const [at, rows] of insertions) {
      let prefix = '';
      if (at === day.text.length) {
        prefix = day.text.endsWith(eol) || !day.text ? '' : eol;
        if (!day.footers.length) prefix += `${eol}---${eol}${eol}`;
      }
      changes.push(patch(day.text, at, at, prefix + rows.join(eol) + eol));
    }
  }
  return changes.filter(p => p.before !== p.after);
}
function entryText(checked: boolean, time: string, duration: string, label: string): string {
  if (!time.trim() && duration === '?' && label.trim() === '?') return `- [${checked ? 'x' : ' '}] ?`;
  const unknown = time.trim() === '?';
  if (!unknown && clockMinutes(time) === null) throw new Error('Use a valid end time, or ? when it is unknown, such as 09:35.');
  if (/[\r\n]/.test(label) || !label.trim()) throw new Error('Give this activity a label.');
  const names = nameSeparatorIssue(label) ?? activityGroup(label).issues[0];
  if (names) throw new Error(names);
  if (/\d\s*[+|]\s*\d/.test(duration)) throw new Error('Use - between amounts, such as 20-10.');
  if (!/^(?:\?|n\/a|\d+(?:\s*-\s*\d+)*(?:\s*\/\s*\d+)?)$/.test(duration.trim())) throw new Error('Use minutes, ?, n/a, or credits/elapsed, such as 20-10/30.');
  return `- [${checked ? 'x' : ' '}] ${unknown ? '?' : clockText(clockMinutes(time)!)} (${duration}) : ${label}`;
}
/** A row whose end time is written as ?, such as `- [ ] ? (30) : prj`. */
const UNKNOWN_TIME_ROW = /^\s*-\s+\[[ xX]\]\s*\?\s*\(/;
/** An activity with minutes and a name but an unknown end time, unlike a gap or a bare `?`. */
export function unknownEndTime(entry: Entry): boolean { return entry.time === null && UNKNOWN_TIME_ROW.test(entry.raw); }
/** A `...` row: a placeholder for activities to come, with no end time or minutes of its own. */
export function isPlaceholder(entry: Entry | undefined): boolean {
  return !!entry && entry.time === null && entry.label.trim() === '...' && !unknownEndTime(entry);
}
/**
 * The row a new or edited activity after `entries[index]` measures from (0.3.11): that row,
 * or, when it is a `...` placeholder, the last row before it. `bridged` says a placeholder
 * was passed. A restart (`14:00 >`) or an unknown end time (`? (30)`) still stops it.
 */
export function measureFrom(entries: readonly Entry[], index: number): { previous: Entry | undefined; bridged: boolean } {
  let at = index;
  while (at >= 0 && isPlaceholder(entries[at])) at--;
  return { previous: at >= 0 ? entries[at] : undefined, bridged: at !== index };
}
/** The row `fill` runs up to from before `entries[index]`: that row, or the first after any placeholders. */
export function fillTarget(entries: readonly Entry[], index: number): Entry | undefined {
  let at = Math.max(0, index);
  while (at < entries.length && isPlaceholder(entries[at])) at++;
  return entries[at];
}
/** Every field unknown: `?`, `? ? ?` or `?; ?; ?` is a gap, the same as `...`. */
const ALL_UNKNOWN = /^\?(?:\s*;?\s*\?)*$/;
export function requestsElapsed(duration: string): boolean {
  const compact = duration.replace(/\s/g, '');
  return /^\/?0?$/.test(compact) || new RegExp(`^${CREDIT_AMOUNT}(?:-${CREDIT_AMOUNT})*\\/(?:0)?$`).test(compact);
}
/** Zero is an input shortcut, never an instruction attached to stored Markdown. */
export function resolveDuration(duration: string, previousClock: number | null, time: string): string {
  if (!requestsElapsed(duration)) return duration;
  if (previousClock === null) throw new Error('A previous activity with a known end time is needed to calculate elapsed minutes.');
  const clock = clockMinutes(time);
  if (clock === null) throw new Error('Enter a valid end time before calculating elapsed minutes.');
  const elapsed = intervalBetween(previousClock, clock);
  if (elapsed === null) throw new Error('The end time moves backward ambiguously. Correct the time or enter the duration explicitly.');
  // Blank, 0, / and /0 all credit the elapsed minutes.
  if (/^\/?0?$/.test(duration.replace(/\s/g, ''))) return String(elapsed);
  if (hasPercent(duration)) return resolvePercent(duration, elapsed);
  const credit = duration.split('/')[0]!.trim();
  if (/^\d+$/.test(credit) && Number(credit) === elapsed) return credit;
  return duration.replace(/(\/\s*)(?:0)?\s*$/, `$1${elapsed}`);
}
export function guardElapsedAnchor(day: Day, change: Change, previous: Entry | undefined): Change {
  if (!previous) return day.entries.length === 0 ? { ...change, strictSource: true } : change;
  const line = day.lines[previous.line]!;
  // An unchanged patch guards the entire preceding row, including a timestamp
  // that may lie outside the ordinary rebase context of a long activity label.
  return { ...change, patches: [patch(day.text, line.start, line.end, line.raw), ...change.patches] };
}
export function editEntry(day: Day, entry: Entry, time: string, duration: string, label: string, codes = DEFAULT_CODES, calculateElapsed = true): Change {
  const previous = day.entries[day.entries.indexOf(entry) - 1];
  duration = unitMinutes(duration);
  const automatic = calculateElapsed && requestsElapsed(duration);
  const resolved = automatic ? resolveDuration(duration, previous?.clock ?? null, time) : duration;
  const text = entryText(entry.checked, time, resolved, label);
  if (automatic && (parseDay(text, '', codes).entries[0]?.unknownCredit || singleAmountGroup(label, resolved, codes)))
    throw new Error('Keep a credit for each project, such as 95-95/0. Elapsed time cannot determine the project split.');
  const change = changeOf(day, [linePatch(day, entry.line, text)], 'Edit activity');
  return automatic ? guardElapsedAnchor(day, change, previous) : change;
}
/** An `&` group naming a project with one amount: it would credit only the first component. */
function singleAmountGroup(label: string, duration: string, codes: string[] = DEFAULT_CODES): boolean {
  const names = activityNames(label).map(n => n.toUpperCase());
  // n/a and ? carry no amounts to divide.
  return names.length > 1 && names.some(n => codes.includes(n)) && !/^(?:n\/a|\?)$/i.test(duration.trim()) && !duration.split('/')[0]!.includes('-');
}
interface QuickResult {
  rows: string[]; diagnostics: string[]; warnings: string[]; calculated: boolean;
  splits: { line: number; label: string; input: string }[];
}
interface QuickOptions extends Partial<EntryDefaults> {
  allowBaseline?: boolean; preserveDuration?: string;
  /** The activity after the insertion point, which `fill` runs up to. */
  following?: Entry;
  /** `previous` was found by looking past a `...` placeholder (see `measureFrom`). */
  bridged?: boolean;
}
/**
 * A leading `fill` keyword, an end time like `now` (0.3.9): `fill task`, `fill 30/ task` or
 * `fill` alone; `fill : task` and `fill; task` still work. Only the whole word counts
 * (`filler`, `fill-up`). A name that starts with fill begins with a semicolon:
 * `; fill water bottles`.
 */
const FILL_START = /^fill(?=[\s:;]|$)/i;
/** `fill` followed by a word, which may have been meant as an activity name. */
const FILL_WORD = /^fill\s+[^\s\d./:;]/i;
const FILL_NAME_HINT = 'To name an activity that starts with fill, begin with a semicolon: ; fill water bottles.';
const FILL = /^fill\s*/i;
/**
 * The end time `fill` stands for (0.2.135): the start of the following activity, its end
 * time less its minutes, so the new row closes the gap after the previous end time.
 */
function fillTime(previousClock: number | null, following: Entry | undefined): string {
  if (previousClock === null) throw new Error('fill needs a known end time before it. Select the activity it follows.');
  if (!following) throw new Error('fill needs an activity after it to fill up to. Add below an activity that has one after it.');
  if (following.clock === null || following.elapsed === null)
    throw new Error(`fill needs the next activity (${following.label}) to have an end time and minutes, so its start is known.`);
  const start = following.clock - following.elapsed;
  const end = ((start % 1440) + 1440) % 1440, gap = intervalBetween(previousClock, end);
  if (gap === null || gap < 1)
    throw new Error(`There is no gap to fill: ${following.label} starts at ${clockText(end)}, not after ${clockText(previousClock)}.`);
  return clockText(end);
}
const AMOUNT = `(?:${UNIT_AMOUNT}|${CREDIT_AMOUNT})`;
const DURATION = String.raw`${AMOUNT}(?:\s*-\s*${AMOUNT})*(?:\s*\/\s*(?:${UNIT_AMOUNT}|\d+)?)?|\/\s*0?|\?|n\/a`;
// The order of a source row, `14:30 (30) : prj`, without its punctuation: end time, minutes, activity.
const QUICK_FIELDS = new RegExp(String.raw`^(?:(now|\d{1,2}:\d{1,2})\s+)?(?:(${DURATION})\s+)?(.+)$`, 'i');
const TIME_FIELD = /^(?:now|\d{1,2}:\d{1,2})$/i, DURATION_FIELD = new RegExp(`^(?:${DURATION})$`, 'i');
/**
 * A colon marks where the name starts, as in a note row `14:30 (30) : prj` (0.3.10):
 * `14:30 30 : prj`, `now : prj`, `30 : read 2 chapters`, `: fill water bottles`. It counts
 * only when everything before it is an end time, minutes or nothing, and a space or the
 * end follows it, so `14:30` and names such as `notes: ch 3` are read as before. A
 * leading `?` is the end time only when minutes follow it, as by position.
 */
const COLON_NAME = new RegExp(String.raw`^(?:(now|\d{1,2}:\d{1,2}|\?(?=\s+[^\s:]))\s*)?(?:(${DURATION})\s*)?:(?:\s+(.*))?$`, 'i');
/** End time, activity and duration of one entry line. */
interface EntryFields { time?: string; label: string; duration?: string; separated: boolean }
/**
 * Read `14:30 30 prj` by position (the order of a source row), or with explicit
 * semicolons: `14:30; 30; prj`, `30; prj`, `14:30; read two chapters`. Semicolons let
 * an activity name start or end with digits.
 */
export function entryFields(text: string): EntryFields | null {
  const line = text.trim();
  if (line.includes(';')) {
    const parts = line.split(';').map(part => part.trim());
    if (parts.length > 3) return null;
    // Two parts: `time; activity`, `minutes; activity`, or `time minutes; activity`.
    const leading = new RegExp(String.raw`^(now|\d{1,2}:\d{1,2})\s+(${DURATION})$`, 'i').exec(parts[0]!);
    const [time, duration, label] = parts.length === 3 ? parts
      : TIME_FIELD.test(parts[0]!) ? [parts[0], '', parts[1]]
      : leading ? [leading[1], leading[2], parts[1]] : ['', parts[0], parts[1]];
    // An unknown end time is explicit only with all three fields: `?; 30; prj`.
    if ((!label && !time && !duration) || (time && !TIME_FIELD.test(time) && !(time === '?' && parts.length === 3)) || (duration && !DURATION_FIELD.test(duration))) return null;
    return { time: time || undefined, label: label || DEFAULT_ACTIVITY, duration: duration ? unitMinutes(duration) : undefined, separated: true };
  }
  const colon = COLON_NAME.exec(line);
  if (colon) {
    const [, time, duration, label] = colon;
    if (!time && !duration && !label?.trim()) return null;
    return { time, duration: duration ? unitMinutes(duration) : undefined, label: label?.trim() || DEFAULT_ACTIVITY, separated: true };
  }
  // By position, a leading ? is the end time only before minutes: `? 30 prj`; `? prj` keeps ? as the minutes.
  const unknownEnd = new RegExp(`^\\?\\s+(${DURATION})\\s+(.+)$`, 'i').exec(line);
  if (unknownEnd) return { time: '?', duration: unitMinutes(unknownEnd[1]!), label: unknownEnd[2]!, separated: false };
  const unnamed = new RegExp(`^(?:(now|\\d{1,2}:\\d{1,2})(?:\\s+(${DURATION}))?|(${DURATION}))$`, 'i').exec(line);
  // A last ? stays the activity, an unknown one; n/a is a duration not accounted for.
  if (unnamed && (unnamed[2] ?? unnamed[3] ?? '').trim() !== '?') return { time: unnamed[1], duration: (unnamed[2] ?? unnamed[3]) && unitMinutes((unnamed[2] ?? unnamed[3])!), label: DEFAULT_ACTIVITY, separated: false };
  const match = QUICK_FIELDS.exec(line);
  return match ? { time: match[1], duration: match[2] && unitMinutes(match[2]), label: match[3]!, separated: false } : null;
}
/** The specific reason an entry line cannot be read, before the generic advice. */
export function entryIssue(raw: string): string | null {
  const line = raw.trim();
  if (/^[1-9]\d?\.\d{2}\s/.test(line)) return 'write the time with a colon, such as 09:30.';
  const time = /^(\d{1,2}:\d{1,2})\s/.exec(line)?.[1];
  if (time && clockMinutes(time) === null) return `${time} is not a time; use 00:00 to 24:00, such as 09:35.`;
  // After a colon the name is taken as written, numbers included.
  if (COLON_NAME.test(line)) return null;
  const rest = line.replace(/^(?:now|\d{1,2}:\d{1,2})\s+/i, ''), words = rest.split(/\s+/), first = words[0] ?? '', last = words.at(-1) ?? '';
  if (/\d\s*[+|]\s*\.?\d/.test(first)) return 'use - between amounts, such as 20-10.';
  if (/^[.\d][\d.-]*\/\d*[a-z]/i.test(first)) return 'put a space after the minutes, such as 30/ prj.';
  // The earlier order, `prj 30`, would otherwise become an activity named "prj 30".
  if (words.length > 1 && DURATION_FIELD.test(last) && !DURATION_FIELD.test(first))
    return 'put the minutes before the activity, such as 30 prj or 14:30 30/ prj. If the number belongs to the name, use semicolons: 30; read chapter 2.';
  return null;
}
export function compactDuration(input: string): string | undefined { return entryFields(input)?.duration; }
export function compactActivity(entry: Entry): string {
  if (entry.time === null && !unknownEndTime(entry) && (entry.label === '?' || entry.label === '...')) return entry.label;
  return `${entry.time ?? (unknownEndTime(entry) ? '?' : '')} ${entry.duration} ${entry.label}`.trim();
}
/** A part of the editor text: one field, or `schedule` for the end time and minutes together. */
export type EditPart = 'time' | 'minutes' | 'activity' | 'schedule';
/** Where each part sits in `compactActivity(entry)`, as [start, end) ranges. */
export function editParts(text: string, entry: Entry): Record<EditPart, [number, number]> {
  if (text === entry.label) return { time: [0, 0], minutes: [0, 0], activity: [0, text.length], schedule: [0, text.length] };
  const time = entry.time ?? (unknownEndTime(entry) ? '?' : '');
  const at = time ? time.length + 1 : 0, minutes: [number, number] = [at, at + entry.duration.length];
  return { time: [0, time.length], minutes, activity: [Math.min(text.length, minutes[1] + 1), text.length], schedule: [0, minutes[1]] };
}
/** Edit one original row; never insert a new activity. */
/** Rename a plan heading that names another date to the file's date; nothing else on the line changes. */
export function fixHeading(day: Day, line: number): Change {
  const raw = day.lines[line]?.raw ?? '', named = headingDate(raw);
  if (!day.date || !named || named === day.date || !day.diagnostics.some(d => d.code === 'heading-date' && d.line === line))
    throw new Error('This heading already names the note\'s date.');
  const lead = /^\s*/.exec(raw)![0], trail = /\s*$/.exec(raw)![0];
  return changeOf(day, [linePatch(day, line, lead + planHeading(day.date) + trail)], 'Fix heading');
}
/** Unusable entry input, with any explicit allocations the owner may choose to review. */
export class EntryInputError extends Error {
  constructor(message: string, readonly splits: QuickResult['splits'] = []) { super(message); }
}
export function compactEdit(day: Day, entry: Entry, input: string, nowTime: string, codes = DEFAULT_CODES,
  options: QuickOptions & { durationTouched?: boolean } = {}): { change: Change; entry: Entry } {
  if (/[\r\n]/.test(input)) throw new Error('Edit one activity at a time. Use Add below for multiple activities.');
  if (input === compactActivity(entry) && !options.durationTouched) return { change: changeOf(day, [], 'Edit activity'), entry };
  const { previous, bridged } = measureFrom(day.entries, day.entries.indexOf(entry) - 1), fields = entryFields(input);
  const preserved = !options.durationTouched && fields?.duration !== undefined && fields.duration === entry.duration;
  // With no known end time before it, a known end time without minutes saves n/a, as in
  // quick entry; only an explicit elapsed request (/ or 0) needs that earlier end time.
  if (fields?.time && fields.time !== '?' && !preserved && fields.duration !== undefined && requestsElapsed(fields.duration) && previous?.clock == null)
    throw new Error('A previous activity with a known end time is needed to calculate elapsed minutes.');
  const parsed = quickEntry(input, entry.checked ? 'log' : 'plan', previous, nowTime, codes,
    { ...options, bridged, allowBaseline: false, preserveDuration: !options.durationTouched ? entry.duration : undefined });
  if (parsed.diagnostics.length) throw new EntryInputError(parsed.diagnostics.join(' '), parsed.splits);
  if (parsed.rows.length !== 1) throw new Error('Enter exactly one activity. Use Add below to add activities.');
  const raw = parsed.rows[0]!.replace(/^(-\s+\[)[ xX](\])/, `$1${entry.checked ? 'x' : ' '}$2`);
  const updated = parseDay(raw, '', codes).entries[0];
  if (!updated) throw new Error('Enter a valid activity.');
  let change = changeOf(day, [linePatch(day, entry.line, raw)], 'Edit activity');
  if (parsed.calculated) change = guardElapsedAnchor(day, change, previous);
  return { change, entry: updated };
}
export function quickEntry(input: string, mode: 'log' | 'plan', previous: Entry | undefined, nowTime: string, codes = DEFAULT_CODES, options: QuickOptions = {}): QuickResult {
  const rows: string[] = [], diagnostics: string[] = [];
  const splits: QuickResult['splits'] = [];
  const warnings: string[] = [];
  const defaults = { ...ENTRY_DEFAULTS, ...options };
  try { validateEntryDefaults(defaults); } catch (error) { return { rows, diagnostics: [(error as Error).message], warnings, calculated: false, splits }; }
  let calculated = false;
  let previousClock = previous?.clock ?? null;
  // A `...` placeholder holds no time: rows after it measure from the last known end time.
  let bridged = !!options.bridged;
  const lines = input.split(/\r?\n/), lastLine = lines.reduce((last, line, at) => line.trim() ? at : last, -1);
  for (let [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    // `fill` ends where the following activity starts; it needs that activity right after it.
    if (FILL_START.test(raw.trim())) {
      if (index !== lastLine) { diagnostics.push(`Line ${index + 1}: fill fills up to the next activity, so use it on the last line only.`); continue; }
      try {
        const rest = raw.trim().replace(FILL, '');
        raw = `${fillTime(previousClock, options.following)}${rest.startsWith(';') ? '' : rest ? ' ' : ''}${rest}`;
      } catch (error) {
        // Without a gap to fill, `fill tank` may have been meant as a name: say how to write one.
        diagnostics.push(`Line ${index + 1}: ${(error as Error).message}${FILL_WORD.test(raw.trim()) ? ` ${FILL_NAME_HINT}` : ''}`); continue;
      }
    }
    // Nothing known is a `...` placeholder (0.3.11): the next row still measures from the last end time.
    if (ALL_UNKNOWN.test(raw.trim()) || raw.trim() === '...') {
      rows.push('- [ ] ...'); bridged = true; continue;
    }
    const anchor = /^(\d{1,2}:\d{1,2})\s*>$/.exec(raw.trim());
    if (anchor) {
      const anchorTime = anchor[1]!;
      const clock = clockMinutes(anchorTime);
      if (clock === null) { diagnostics.push(`Line ${index + 1}: invalid time.`); continue; }
      if (previousClock !== null && intervalBetween(previousClock, clock) === null)
        diagnostics.push(`Line ${index + 1}: the end time moves backward ambiguously.`);
      rows.push(entryText(false, anchorTime, 'n/a', ANCHOR));
      previousClock = clock; bridged = false; continue;
    }
    const issue = raw.includes(';') ? null : entryIssue(raw);
    if (issue) { diagnostics.push(`Line ${index + 1}: ${issue}`); continue; }
    const fields = entryFields(raw);
    // Without semicolons, positions decide the fields, so reject lines whose reading would be a guess.
    if (!fields || (!fields.separated && (/^[-&+|/]|[-&+|/]\s*$/.test(fields.label) ||
      (!fields.duration && (/^[.\d]/.test(fields.label) || /\s+[-+]?\d\S*\s*$/.test(fields.label)))))) {
      diagnostics.push(`Line ${index + 1}: write the end time, the minutes, then the activity: 14:30 30 prj, 30 prj, or prj. Semicolons keep numbers in a name: 14:30; 30; read 2 chapters.`); continue;
    }
    const joinIssue = nameSeparatorIssue(fields.label) ?? activityGroup(fields.label).issues[0];
    if (joinIssue) { diagnostics.push(`Line ${index + 1}: ${joinIssue}`); continue; }
    if (fields.time === '?') {
      // An unknown end time needs its minutes written: they cannot come from the clock.
      let duration = fields.duration ?? '';
      const preserved = duration === options.preserveDuration;
      const stated = /\/\s*(\d+)\s*$/.exec(duration);
      if (!duration || (!preserved && requestsElapsed(duration)) || (hasPercent(duration) && !stated)) {
        diagnostics.push(`Line ${index + 1}: with an unknown end time, write the minutes, such as ? 30 prj, or ? ? prj when they are unknown too.`); continue;
      }
      if (hasPercent(duration)) duration = resolvePercent(duration, Number(stated![1]));
      const label = canonicalJoiners(fields.label);
      if (singleAmountGroup(label, duration, codes)) {
        diagnostics.push(`Line ${index + 1}: give one amount per activity, such as ${activityNames(label).map((_, i) => i ? '0' : duration.split('/')[0]!.trim()).join('-')} ${label}.`); continue;
      }
      let row: string;
      try { row = entryText(mode === 'log', '?', duration, label); }
      catch (error) { diagnostics.push(`Line ${index + 1}: ${(error as Error).message}`); continue; }
      const blocking = parseDay(row, '', codes).diagnostics.filter(d => d.blocks);
      if (blocking.length) diagnostics.push(`Line ${index + 1}: ${blocking.map(d => d.message).join(' ')}`);
      rows.push(row); previousClock = null; bridged = false; continue;
    }
    const match = [raw, fields.time, fields.label, fields.duration] as const;
    const explicit = !!match[1];
    if (bridged && explicit && previousClock !== null) {
      // Across a placeholder, an end time before the last known one starts afresh (n/a)
      // instead of reading as a backward step.
      const at = clockMinutes(match[1].toLowerCase() === 'now' ? nowTime : match[1]);
      if (at !== null && intervalBetween(previousClock, at) === null) previousClock = null;
    }
    let duration = match[3];
    // Percent credit gives one amount per activity: .25/ prj or .5-.5/ pr1 & pr2.
    if (duration && hasPercent(duration)) {
      const amounts = duration.split('/')[0]!.split('-').length;
      const activities = Math.max(1, activityNames(match[2]).length);
      if (amounts !== activities) {
        diagnostics.push(`Line ${index + 1}: percent credit needs one amount per activity: ${activities === 1 ? 'one fraction, such as .25/ or .1/20' : `${activities} amounts, such as ${Array.from({ length: activities }, () => `.${Math.floor(10 / activities)}`).join('-')}/`}.`); continue;
      }
    }
    const preserved = explicit && duration !== undefined && duration === options.preserveDuration;
    // A known end time with no minutes and nothing before it is not accounted for: n/a.
    const unaccounted = explicit && duration === undefined && previousClock === null;
    const automatic = explicit && !preserved && !unaccounted && (!duration || requestsElapsed(duration));
    const needsAnchor = !explicit || automatic;
    if (needsAnchor && previousClock === null && !previous && rows.length === 0 && index === input.split(/\r?\n/).findIndex(line => line.trim()) && options.allowBaseline) {
      rows.push(entryText(false, defaults.defaultStartTime, 'n/a', defaults.defaultStartActivity));
      previousClock = clockMinutes(defaults.defaultStartTime);
      warnings.push(`Uses the configured start: ${defaults.defaultStartTime} ${defaults.defaultStartActivity}.`);
    }
    let time: string;
    if (!explicit) {
      if (previousClock === null) { diagnostics.push(`Line ${index + 1}: enter a known time first, such as 14:00 >. A gap cannot supply an endpoint.`); continue; }
      duration ??= String(defaults.defaultBlockMinutes);
      if (requestsElapsed(duration) || duration === '?' || duration === 'n/a') {
        diagnostics.push(`Line ${index + 1}: supply a positive duration or an explicit end time; / and /0 need an end time.`); continue;
      }
      if (hasPercent(duration) && !duration.includes('/')) {
        diagnostics.push(`Line ${index + 1}: percent credit needs elapsed minutes, such as .5/60, or an end time with .5/.`); continue;
      }
      const parts = duration.replace(/\s/g, '').split('/');
      const advance = parts.length === 2 ? Number(parts[1]) : parts[0]!.split('-').reduce((sum, value) => sum + Number(value), 0);
      if (!Number.isSafeInteger(advance) || advance <= 0 || advance >= 1440) {
        diagnostics.push(`Line ${index + 1}: elapsed duration must be a whole number from 1 to 1439 minutes.`); continue;
      }
      time = clockText(previousClock + advance); calculated = true;
    } else {
      time = match[1].toLowerCase() === 'now' ? nowTime : match[1];
    }
    const clock = clockMinutes(time);
    if (clock === null) { diagnostics.push(`Line ${index + 1}: invalid time.`); continue; }
    const elapsed = intervalBetween(previousClock, clock);
    if (automatic) calculated = true;
    duration ??= previousClock === null ? 'n/a' : elapsed === null ? '?' : String(elapsed);
    try {
      if (!preserved) {
        duration = resolveDuration(duration, previousClock, time);
        if (hasPercent(duration)) {
          const stated = /\/\s*(\d+)\s*$/.exec(duration);
          if (!stated) throw new Error('Percent credit needs elapsed minutes: add / to use the end time, or /60 for explicit minutes.');
          duration = resolvePercent(duration, Number(stated[1]));
        }
      }
    } catch (error) { diagnostics.push(`Line ${index + 1}: ${(error as Error).message}`); continue; }
    const label = canonicalJoiners(match[2]);
    let row: string;
    try { row = entryText(mode === 'log', time, duration, label); }
    catch (error) { diagnostics.push(`Line ${index + 1}: ${(error as Error).message}`); continue; }
    const parsed = parseDay(row, '', codes);
    const total = /^\d+(?:\/\d+)?$/.test(duration) ? Number(duration.split('/')[0]) : NaN;
    // A single amount would credit only the first component; new entries name each share.
    const names = activityNames(label).map(n => n.toUpperCase()), single = !preserved && singleAmountGroup(label, duration, codes);
    const needsSplit = single && names.every(n => codes.includes(n)) && !/\d\s*-\s*\d/.test(duration.split('/')[0]!);
    if (needsSplit && Number.isSafeInteger(total) && total >= 0) {
      const credits = equalSplit(total, names.length);
      const denominator = explicit && (!match[3] || requestsElapsed(match[3])) ? '0' : duration.split('/').at(-1)!;
      const lines = input.split(/\r?\n/);
      lines[index] = `${explicit ? match[1] + ' ' : ''}${credits.join('-')}/${denominator} ${label}`;
      splits.push({ line: index + 1, label: names.map((n, i) => `${n} ${credits[i]}m`).join(' · '), input: lines.join('\n') });
    }
    if (single && !needsSplit) {
      const [credit = '', ...rest] = duration.split('/'), example = [names.map((_, i) => i ? '0' : credit.trim()).join('-'), ...rest].join('/');
      diagnostics.push(`Line ${index + 1}: "${duration} ${label}" has one amount for ${names.length} activities, so only ${names[0]!.toLowerCase()} would earn it. Give one amount per activity, such as ${example} ${label}. Only registered projects count as work.`);
    }
    else if (needsSplit) diagnostics.push(`Line ${index + 1}: Choose how to divide credit between ${names.join(', ')}. Enter one amount per project, such as ${names.map(() => '35').join('-')}/0, or choose Split equally when available.`);
    else if (parsed.diagnostics.some(d => d.blocks)) diagnostics.push(`Line ${index + 1}: ${parsed.diagnostics.filter(d => d.blocks).map(d => d.message).join(' ')}` +
      (unaccounted && parsed.diagnostics.some(d => d.blocks && d.code === 'unknown-credit') ? ` With nothing timed before it, ${time} has no minutes (n/a). Add them, such as ${time} 30 ${label}${options.allowBaseline ? `, or ${time} / ${label} to count from the configured start` : ''}.` : ''));
    if (explicit && previousClock !== null && elapsed === null) diagnostics.push(`Line ${index + 1}: the end time moves backward ambiguously; add an explicit gap and time anchor.`);
    rows.push(row);
    previousClock = clock; bridged = false;
  }
  return { rows, diagnostics, warnings, calculated, splits };
}
export function insertRows(day: Day, rows: string[], selected: Entry | undefined, section = 'morning'): Change {
  if (!rows.length) throw new Error('Enter an activity first.');
  if (selected) {
    const line = day.lines[selected.line]!;
    const at = line.fullEnd;
    return changeOf(day, [patch(day.text, at, at, (line.eol ? '' : day.eol) + rows.join(day.eol) + day.eol)], 'Insert activities');
  }
  const heading = day.lines.find(l => l.raw.toLowerCase() === `### ${section.toLowerCase()}`);
  const at = heading?.fullEnd ?? day.lines.find(l => /^---\s*$/.test(l.raw))?.start ?? day.text.length;
  const glued = !heading && at === day.text.length && day.text.length > 0 && !/\n$/.test(day.text);
  return changeOf(day, [patch(day.text, at, at, (heading || glued ? day.eol : '') + rows.join(day.eol) + day.eol)], 'Insert activities');
}
export function toggleEntry(day: Day, entry: Entry): Change {
  if (entry.label === '...') return changeOf(day, [], 'Toggle completion');
  return changeOf(day, [linePatch(day, entry.line, entry.raw.replace(/^(-\s+\[)[ xX](\])/, `$1${entry.checked ? ' ' : 'x'}$2`))], 'Toggle completion');
}
export function deleteEntries(day: Day, entries: Entry[]): Change {
  if (day.legacy) throw new Conflict('Historical formatting is read-only in the planner. Open the source to edit it.');
  const selected = [...new Set(entries)];
  if (!selected.length) throw new Error('Select at least one activity to delete.');
  if (selected.some(entry => !day.entries.includes(entry))) throw new Conflict('The selected activities no longer match this note. Select them again.');
  return changeOf(day, selected.map(entry => linePatch(day, entry.line, '', true)),
    selected.length === 1 ? 'Delete activity' : `Delete ${selected.length} activities`);
}
function moveInsertion(day: Day, entry: Entry, direction: -1 | 1): number | null {
  const at = day.entries.indexOf(entry);
  if (at < 0) throw new Conflict('That activity is no longer in this note.');
  const other = day.entries[at + direction];
  const headings = day.lines.filter(line => /^###\s+/.test(line.raw));
  const heading = headings.filter(line => line.index < entry.line).at(-1);
  const next = headings.find(line => line.index > entry.line);
  if (direction === -1) {
    if (other && other.line > (heading?.index ?? -1)) return day.lines[other.line]!.start;
    // Crossing a heading is one step on its own: append to the previous
    // section without also passing its last activity.
    return heading && (headings.indexOf(heading) > 0 || other) ? heading.start : null;
  }
  if (other && (!next || other.line < next.index)) return day.lines[other.line]!.fullEnd;
  if (!next) return null;
  const following = headings[headings.indexOf(next) + 1];
  const first = day.entries.find(row => row.line > next.index && (!following || row.line < following.index));
  return first ? day.lines[first.line]!.start : next.fullEnd;
}
export function canMoveEntry(day: Day, entry: Entry, direction: -1 | 1): boolean {
  return day.entries.includes(entry) && moveInsertion(day, entry, direction) !== null;
}
export function moveEntry(day: Day, entry: Entry, direction: -1 | 1): Change {
  const insertion = moveInsertion(day, entry, direction);
  if (insertion === null) return changeOf(day, [], 'Move activity');
  const source = day.lines[entry.line]!;
  let start = source.start;
  // Moving the last unterminated line must retain the document's EOF style.
  if (!source.eol && direction === -1) start -= day.lines[entry.line - 1]?.eol.length ?? 0;
  const atUnterminatedEnd = insertion === day.text.length && !/[\r\n]$/.test(day.text);
  const text = atUnterminatedEnd ? day.eol + entry.raw : entry.raw + (source.eol || day.eol);
  return changeOf(day, [patch(day.text, start, source.fullEnd, ''), patch(day.text, insertion, insertion, text)], 'Move activity');
}
/**
 * How Shift treats durations: keep them as written, match them to the new elapsed
 * time, or keep the credit and record the new elapsed time (credit/elapsed).
 */
export type ShiftDurations = 'keep' | 'match' | 'elapsed';
function shiftedDuration(duration: string, elapsed: number, mode: ShiftDurations): string {
  const credit = duration.split('/')[0]!.trim();
  if (mode === 'match' && /^\d+$/.test(credit)) return String(elapsed);
  return credit === String(elapsed) ? credit : `${credit}/${elapsed}`;
}
export function shiftEntries(day: Day, entries: Entry[], delta: number, durations: ShiftDurations = 'keep'): Change {
  if (!entries.length || !Number.isInteger(delta)) throw new Error('Select plans and enter a whole number of minutes.');
  if (entries.some(e => e.checked || e.clock === null || e.legacy)) throw new Error('Only plans with known times can be shifted.');
  const moved = new Map(entries.map(e => [e, e.clock! + delta]));
  const clockOf = (entry: Entry) => moved.get(entry) ?? entry.clock;
  const changes: Patch[] = [];
  day.entries.forEach((entry, index) => {
    const previous = day.entries[index - 1];
    // The plan after a shifted one keeps its end time but gains or loses elapsed time.
    const follows = durations !== 'keep' && !!previous && moved.has(previous) && !entry.checked && !entry.legacy;
    if (!moved.has(entry) && !follows) return;
    let raw = moved.has(entry) ? entry.raw.replace(entry.time!, clockText(moved.get(entry)!)) : entry.raw;
    const start = previous ? clockOf(previous) : null, end = clockOf(entry);
    if (durations !== 'keep' && start !== null && end !== null && /^\d/.test(entry.duration)) {
      const elapsed = intervalBetween(start, end);
      if (elapsed !== null) raw = raw.replace(`(${entry.duration})`, `(${shiftedDuration(entry.duration, elapsed, durations)})`);
    }
    if (raw !== entry.raw) changes.push(linePatch(day, entry.line, raw));
  });
  const proposed = parseDay(applyPatches(day.text, changes), day.path);
  if (proposed.diagnostics.some(d => d.code === 'backward-time')) throw new Error('This shift would put endpoints out of order.');
  return changeOf(day, changes, 'Shift selected plans');
}
/**
 * Turn an existing note that holds the day's name into its plan: the made day
 * goes on top and every byte of the note stays below it, unchanged.
 */
export function adoptDay(existing: string, date: string, routine = ''): string {
  const eol = /\r\n/.test(existing) ? '\r\n' : '\n', bom = existing.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + makeDay(date, routine).replace(/\r?\n/g, eol) + eol + existing.slice(bom.length);
}
export function makeDay(date: string, routine = ''): string {
  if (!validDate(date)) throw new Error('Choose a valid date.');
  const title = planHeading(date);
  if (!routine.trim()) {
    // Only SUM (0.2.135): automatic totals add each project's row once it earns credit,
    // so a blank day carries no zero rows to clean up.
    return `${title}\n\n### morning\n\n### afternoon\n\n### evening\n\n---\n\n${totalLine('SUM', 0)}\n`;
  }
  let text = routine;
  const fenced = /^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text);
  if (fenced) text = fenced[1]!;
  if ((text.match(/^##\s+plan for\b/gim) ?? []).length > 1) throw new Error('Choose a routine containing one daily plan.');
  const lines = linesOf(text), eol = lines.find(l => l.eol)?.eol ?? '\n';
  text = lines.map(l => {
    if (/^##\s+plan for\b/i.test(l.raw)) return title + l.eol;
    // Template totals start at zero in the current form, whichever form the template used.
    const clean = l.raw.replace(/\*\*/g, '').trim();
    const total = TOTAL.exec(clean) ?? RETIRED_TOTAL.exec(clean);
    if (total) return totalLine(TOTAL.test(clean) ? total[1]! : total[2]!.toUpperCase(), 0) + l.eol;
    return l.raw.replace(/^(-\s+\[)[xX](\])/, '$1 $2') + l.eol;
  }).join('');
  if (!/^##\s+plan for\b/im.test(text)) text = title + eol + eol + text;
  return text.endsWith(eol) ? text : text + eol;
}
