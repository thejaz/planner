import { parseMarkerCriteria, selectMarkers, formatRowHighlight } from './marker-rules';
import type { MarkerCriteria } from './marker-rules';
import { dateAdd, displayMinutes, linesOf, minutes, validDate } from './model';
import type { Day, Line, Patch } from './model';
import { effectiveTotals, disputed } from './reader';
import { patch } from './changes';
import { projectEmojiSource } from './project-emojis';
import { chooseDay, folderCounts } from './day-choice';
import { PERIOD, RETIRED_PERIOD, RETIRED_SUMMARY_ROW, SUMMARY_ROW, summaryRow } from './syntax';

/** Filename-only discovery; folder names and note contents do not opt a file in. */
export function isSummaryPath(path: string): boolean {
  return /\.md$/i.test(path) && path.split(/[/\\]/).at(-1)!.toLowerCase().includes('thejaz-summary');
}

export interface SummaryRow { date: string; line: number; value: number | null }
export interface Summary {
  path: string; text: string; lines: Line[]; start: string | null; end: string | null;
  rows: SummaryRow[]; projects: { code: string; value: number; line: number; emoji?: string; emojiStart?: number; emojiEnd?: number; emojiInsert?: number }[];
  thresholds: { low: number; cool: number; hot: number };
  weekends?: number[]; criteria?: MarkerCriteria;
  /** Retired syntax found in this summary; writes are refused until it is updated. */
  retired: { line: number; message: string }[];
}
function dottedDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const date = `${m[3]!.length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}`;
  return validDate(date) ? date : null;
}
/**
 * `criteria` is the vault's criteria note (see `criteria.ts`), or null for built-in
 * minute defaults. Left out, the summary's own legend is read: core tests and the
 * one-time migrations use that self-contained form; the plugin always passes it.
 */
export function parseSummary(text: string, path: string, weekends: number[] = [5], criteria?: MarkerCriteria | null): Summary {
  const result: Summary = { path, text, lines: linesOf(text), start: null, end: null, rows: [], projects: [],
    thresholds: { low: 30, cool: 150, hot: 300 }, weekends: [...weekends], retired: [] };
  const period = PERIOD.exec(text), retiredPeriod = period ? null : RETIRED_PERIOD.exec(text);
  if (period) {
    if (validDate(period[1]!) && validDate(period[2]!) && period[1]! <= period[2]!) { result.start = period[1]!; result.end = period[2]!; }
  } else if (retiredPeriod) {
    result.start = dottedDate(retiredPeriod[1]!); result.end = dottedDate(retiredPeriod[2]!);
    const line = result.lines.find(l => RETIRED_PERIOD.test(l.raw))?.index ?? 0;
    result.retired.push({ line, message: `Write the Days line with full dates: Days (${result.start ?? 'YYYY-MM-DD'} - ${result.end ?? 'YYYY-MM-DD'}).` });
  } else {
    const iso = /(\d{4}-\d{2}-\d{2})--(\d{4}-\d{2}-\d{2})/.exec(path.split(/[/\\]/).at(-1)!);
    if (iso && validDate(iso[1]!) && validDate(iso[2]!) && iso[1]! <= iso[2]!) {
      result.start = iso[1]!; result.end = iso[2]!;
    }
    const name = /(\d{2})-(\d{2})-(\d{2})\s*--\s*(\d{2})-(\d{2})-(\d{2})/.exec(path);
    if (!iso && name) {
      const start = `20${name[1]}-${name[2]}-${name[3]}`, end = `20${name[4]}-${name[5]}-${name[6]}`;
      if (validDate(start) && validDate(end) && start <= end) { result.start = start; result.end = end; }
    }
  }
  // Legacy notes may start with unheaded date rows. Once a heading starts a
  // different section, only an explicit Days heading can opt date rows back in.
  let daysDepth = 0;
  let section = '', lastMonthDay = '', year = result.start ? +result.start.slice(0, 4) : 0, fence = false;
  for (const line of result.lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line.raw);
    if (heading) {
      section = heading[1]!.toLowerCase();
      const depth = /^#+/.exec(line.raw)![0].length;
      if (/^days(?:\s*\(|$)/i.test(section)) daysDepth = depth;
      else if (/^(?:projects|bookmarks|results|criteria|legend)\b/i.test(section) || daysDepth === 0 || depth <= daysDepth) daysDepth = -1;
    }
    const iso = SUMMARY_ROW.exec(line.raw), old = iso ? null : RETIRED_SUMMARY_ROW.exec(line.raw);
    if (iso && daysDepth >= 0 && validDate(iso[2]!)) {
      result.rows.push({ date: iso[2]!, line: line.index, value: iso[3] === '?' ? null : minutes(iso[3]!) });
      lastMonthDay = iso[2]!.slice(5); year = +iso[2]!.slice(0, 4);
    } else if (old && result.start && daysDepth >= 0) {
      // Retired MM-DD rows: the year is inferred from the period, rolling over at New Year.
      const monthDay = old[2]!;
      if (lastMonthDay && monthDay < lastMonthDay && lastMonthDay.startsWith('12') && monthDay.startsWith('01')) year++;
      // First row may be in the following calendar year.
      if (!lastMonthDay && monthDay < result.start.slice(5)) year++;
      const date = `${year}-${monthDay}`;
      lastMonthDay = monthDay;
      if (validDate(date)) {
        const value = old[3] === '?' ? null : minutes(old[3]!);
        result.rows.push({ date, line: line.index, value });
        result.retired.push({ line: line.index, message: `Write this row in the current form: ${summaryRow(date, value ?? '?')}` });
      }
    }
    const clean = line.raw.replace(/\*\*|==|~~|\*/g, '').trim();
    const project = /(?:^|\s)([A-Z][A-Z0-9]*)\s*=\s*(\d+)\s*$/i.exec(clean);
    if (project && project[1]!.toUpperCase() !== 'SUM' && section === 'projects') {
      const code = project[1]!.toUpperCase();
      result.projects.push({ code, value: +project[2]!, line: line.index, ...projectEmojiSource(line.raw, code, line.start) });
    }
  }
  const legend = criteria === undefined ? parseMarkerCriteria(text, path) : criteria;
  if (legend && (criteria !== undefined || legend.definitions.length || /^#{1,6}\s+criteria\s*&\s*markers\s*$/im.test(text))) {
    result.criteria = legend;
    for (const [symbol, key] of [['🦥', 'low'], ['❄', 'cool'], ['🔥', 'hot']] as const) {
      const minimum = legend.definitions.find(d => d.key === symbol)?.min;
      if (minimum !== undefined) result.thresholds[key] = minimum;
    }
  }
  return result;
}
export interface ReviewRow {
  date: string; sum: number | null; projects: Record<string, number>; unallocated: number;
  paths: string[]; source: 'daily' | 'recorded totals' | 'summary' | 'missing' | 'duplicate';
  disputed: boolean; issues: string[];
}
export interface Review {
  start: string; end: string; rows: ReviewRow[]; sum: number; projects: Record<string, number>;
  calendarDays: number; knownDays: number; missingDays: number; average: number | null; complete: boolean;
}
type SummaryRecord = { summary: Summary; row: SummaryRow };
function summaryRecords(summaries: Summary[]): Map<string, SummaryRecord[]> {
  const records = new Map<string, SummaryRecord[]>();
  for (const summary of summaries) for (const row of summary.rows) if (row.value !== null)
    records.set(row.date, [...(records.get(row.date) ?? []), { summary, row }]);
  return records;
}
/** One authority policy for Report and sparse history consumers such as streaks. */
function resolveReviewRow(date: string, matches: Day[], counts: ReadonlyMap<string, number>, project: string, summaries: ReadonlyMap<string, SummaryRecord[]>): { row: ReviewRow; complete: boolean } {
  let complete = true;
  let row: ReviewRow = { date, sum: null, projects: {}, unallocated: 0, paths: [], source: 'missing', disputed: false, issues: [] };
  if (matches.length) {
    // Several plans for one date: the one among most planner days counts; the rest are only named.
    const { chosen: day, others } = chooseDay(matches, counts), totals = effectiveTotals(day);
    complete = totals.complete;
    const uncertainProject = project && day.recorded[project] === undefined &&
      (day.entries.some(e => e.checked && e.unknownCredit) || day.diagnostics.some(d => d.code === 'invalid-total') ||
        (totals.projects[project] === undefined && totals.unallocated !== 0));
    const filtered = project ? uncertainProject ? null
      : totals.complete ? totals.projects[project] ?? 0 : totals.projects[project] ?? null : totals.sum;
    row = { ...row, sum: filtered, projects: totals.projects, unallocated: totals.unallocated, paths: [day.path],
      source: day.recordedOnly ? 'recorded totals' : 'daily', disputed: disputed(day),
      issues: [...day.diagnostics.map(d => d.message), ...others.map(d => `Also a plan for this date, not counted: ${d.path}.`)] };
  } else {
    const fallback = summaries.get(date) ?? [];
    if (fallback.length === 1) {
      row = { ...row, source: 'summary', paths: [fallback[0]!.summary.path],
        sum: project ? null : fallback[0]!.row.value, unallocated: fallback[0]!.row.value!,
        issues: ['Aggregate-only record; project allocation is unavailable.'] };
    } else if (fallback.length > 1) row = { ...row, source: 'duplicate', disputed: true,
      paths: [...new Set(fallback.map(f => f.summary.path))],
      issues: ['Multiple summary records; no value selected.', ...fallback.map(f => `${f.summary.path}: ${f.row.value}m.`)] };
  }
  return { row, complete };
}
/** Actual recorded dates only; gaps remain absent instead of being filled with zero. */
export function recordedReviewRows(days: Iterable<Day>, summaries: Summary[] = []): ReviewRow[] {
  const all = [...days], counts = folderCounts(all), byDate = new Map<string, Day[]>(), records = summaryRecords(summaries);
  for (const day of all) if (day.date) byDate.set(day.date, [...(byDate.get(day.date) ?? []), day]);
  const dates = new Set([...byDate.keys(), ...summaries.flatMap(s => s.rows.map(row => row.date))]);
  return [...dates].sort().map(date => resolveReviewRow(date, byDate.get(date) ?? [], counts, '', records).row);
}
export function review(days: Iterable<Day>, start: string, end: string, project = '', summaries: Summary[] = []): Review {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Choose an ordered, valid date range.');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 36600) throw new Error('Choose a range shorter than 100 years.');
  const byDate = new Map<string, Day[]>(), all = [...days], counts = folderCounts(all), records = summaryRecords(summaries);
  for (const day of all) if (day.date && day.date >= start && day.date <= end)
    byDate.set(day.date, [...(byDate.get(day.date) ?? []), day]);
  const result: Review = { start, end, rows: [], sum: 0, projects: {}, calendarDays: 0, knownDays: 0,
    missingDays: 0, average: null, complete: true };
  for (let date = start; date <= end; date = dateAdd(date, 1)) {
    const { row, complete } = resolveReviewRow(date, byDate.get(date) ?? [], counts, project, records);
    if (!complete) result.complete = false;
    result.rows.push(row);
    if (row.sum === null) { result.missingDays++; result.complete = false; }
    else { result.sum += row.sum; result.knownDays++; }
    for (const [code, value] of Object.entries(row.projects)) result.projects[code] = (result.projects[code] ?? 0) + value;
  }
  result.calendarDays = result.rows.length;
  // The UI explicitly labels known-day means; missing days never become zeros.
  result.average = result.knownDays ? result.sum / result.knownDays : null;
  return result;
}
export function rangeFor(preset: string, today: string, summary?: Summary, days: Iterable<Day> = [], summaries: Summary[] = []): { start: string; end: string } {
  if (!validDate(today)) throw new Error('Today is not a valid date. Check the Planner time zone.');
  if (preset === 'period') {
    if (!summary?.start || summary.start > today) throw new Error('Set a summary note with a valid Days (...) period starting on or before today in Planner settings.');
    return { start: summary.start, end: today };
  }
  if (preset === '7days' || preset === '30days') return { start: dateAdd(today, preset === '7days' ? -6 : -29), end: today };
  if (preset === '6months' || preset === '12months') {
    const date = new Date(`${today}T12:00:00Z`), day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - (preset === '6months' ? 6 : 12));
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return { start: dateAdd(date.toISOString().slice(0, 10), 1), end: today };
  }
  if (preset === 'all') {
    let start = today;
    for (const day of days) if (day.date && day.date < start) start = day.date;
    for (const source of [...summaries, ...(summary ? [summary] : [])])
      for (const row of source.rows) if (row.date < start) start = row.date;
    return { start, end: today };
  }
  throw new Error('Choose a review period.');
}
export function marker(value: number, date: string, existing: string, thresholds: Summary['thresholds'], weekend: number | number[] = 5, criteria?: MarkerCriteria): string {
  return selectMarkers(value, date, existing, thresholds, Array.isArray(weekend) ? weekend : [weekend], criteria);
}
export function replaceSummaryMarkers(raw: string, value: number, symbols: string): string {
  const record = SUMMARY_ROW.exec(raw);
  if (!record || record[3] === '?') throw new Error('open the summary source and use a readable row, such as 2026-05-24 = 300, before changing its markers.');
  const suffix = /^\s*(?:(?:🦥|❄[\uFE0E\uFE0F]?|🔥|😎|☁[\uFE0E\uFE0F]?|🕶[\uFE0E\uFE0F]?|😣|✌[\uFE0E\uFE0F]?)\s*)*(.*)$/u.exec(record[4]!)![1]!;
  const wrappers = record[1]!.match(/==|\*\*|\*|~~/g) ?? [];
  const closes = wrappers.length && suffix.startsWith(wrappers.at(-1)!);
  return record[1]! + summaryRow(record[2]!, value, symbols) + (suffix && !closes ? ' ' : '') + suffix;
}
export function sortedProjectPatches(summary: Summary, values?: Record<string, number>): Patch[] {
  if (new Set(summary.projects.map(p => p.code)).size !== summary.projects.length)
    throw new Error('Resolve duplicate project totals before sorting the summary.');
  const rows = summary.projects.map(project => ({ code: project.code, value: values ? values[project.code] ?? 0 : project.value,
    raw: values ? summary.lines[project.line]!.raw.replace(/(=\s*)\d+/, `$1${values[project.code] ?? 0}`) : summary.lines[project.line]!.raw }));
  if (values) for (const [code, value] of Object.entries(values)) if (value && !rows.some(row => row.code === code)) rows.push({ code, value, raw: `${code} = ${value}` });
  rows.sort((a, b) => b.value - a.value);
  const patches: Patch[] = [];
  for (const [index, project] of summary.projects.entries()) {
    const line = summary.lines[project.line]!;
    if (line.raw !== rows[index]!.raw) patches.push(patch(summary.text, line.start, line.end, rows[index]!.raw));
  }
  const remaining = rows.slice(summary.projects.length);
  if (remaining.length) {
    const last = summary.projects.at(-1), heading = summary.lines.find(line => /^#{1,6}\s+Projects\s*$/i.test(line.raw));
    const anchor = last ? summary.lines[last.line] : heading;
    if (!anchor) throw new Error('Add a Projects heading to the summary before sorting.');
    const eol = summary.lines.find(line => line.eol)?.eol ?? '\n';
    patches.push(patch(summary.text, anchor.fullEnd, anchor.fullEnd, (anchor.eol ? '' : eol) + remaining.map(row => row.raw).join(eol) + (anchor.eol ? eol : '')));
  }
  return patches;
}
/**
 * The summary period's totals through `through`; null when the summary has no period, it
 * starts later, or it uses retired syntax (only its repair messages are reported).
 */
export function summaryTotals(summary: Summary, days: Iterable<Day>, through: string): Review | null {
  if (summary.retired.length || !summary.start || !summary.end) return null;
  const end = through < summary.end ? through : summary.end;
  return end < summary.start ? null : review(days, summary.start, end);
}
/** `totals`, when given, must be `summaryTotals` of the same summary, days and `through`. */
export function summaryPatches(summary: Summary, days: Iterable<Day>, through: string, changedDates: Set<string>, reconcile = false, totals?: Review): { patches: Patch[]; issues: string[] } {
  const issues: string[] = [], patches: Patch[] = [];
  if (summary.retired.length)
    return { patches, issues: summary.retired.map(r => `${summary.path}:${r.line + 1}: ${r.message}`) };
  if (!summary.start || !summary.end) return { patches, issues: ['The summary has no Days line, so the planner cannot tell which dates it covers. Add one such as Days (2026-05-24 - 2027-05-23).'] };
  const end = through < summary.end ? through : summary.end;
  if (end < summary.start) return { patches, issues };
  totals ??= review(days, summary.start, end);
  const eol = summary.lines.find(l => l.eol)?.eol ?? '\n';
  const insertRows = new Map<number, string[]>();
  for (const row of totals.rows) {
    if (!changedDates.has(row.date) && !reconcile) continue;
    if (row.sum === null || row.disputed) { issues.push(`${row.date}: this day's note has a problem (see its note checks), so its summary row was left as it is. Fix the note first.`); continue; }
    const targets = summary.rows.filter(r => r.date === row.date);
    if (targets.length > 1) { issues.push(`${row.date}: this date has duplicate summary rows. Keep one row in the summary note.`); continue; }
    const target = targets[0];
    if (target?.value === null) { issues.push(`${row.date}: the summary row for this date has no readable minutes, so it was left as it is. Fix that row in the summary note.`); continue; }
    const value = row.sum;
    if (target) {
      const line = summary.lines[target.line]!, original = line.raw;
      // Preserve context, emphasis, and annotations; change only minutes and productivity symbols.
      const symbols = marker(row.sum, row.date, original, summary.thresholds, summary.weekends ?? [5], summary.criteria);
      const rendered = replaceSummaryMarkers(original, row.sum, symbols);
      const next = rendered !== original ? formatRowHighlight(rendered, symbols) : original;
      if (next !== original) patches.push(patch(summary.text, line.start, line.end, next));
    } else {
      let next = summaryRow(row.date, value, marker(row.sum, row.date, '', summary.thresholds, summary.weekends ?? [5], summary.criteria));
      if ((summary.weekends ?? [5]).includes(new Date(`${row.date}T12:00:00Z`).getUTCDay())) next = `**${next}**`;
      next = formatRowHighlight(next, marker(row.sum, row.date, '', summary.thresholds, summary.weekends ?? [5], summary.criteria));
      const following = summary.rows.find(r => r.date > row.date);
      const last = summary.rows.at(-1);
      const heading = summary.lines.find(l => /^#{1,6}\s+Days(?:\s*\(|\s*$)/i.test(l.raw));
      const at = following ? summary.lines[following.line]!.start : last ? summary.lines[last.line]!.fullEnd : heading?.fullEnd;
      if (at !== undefined) insertRows.set(at, [...(insertRows.get(at) ?? []), next]);
    }
  }
  for (const [at, rows] of insertRows) {
    const prefix = at > 0 && !/[\r\n]/.test(summary.text[at - 1]!) ? eol : '';
    patches.push(patch(summary.text, at, at, prefix + rows.join(eol) + eol));
  }
  if (!totals.complete || totals.rows.some(r => r.source === 'duplicate')) {
    issues.push('Because some days still need fixing, the summary\'s project totals and results were left unchanged for now.');
  } else if (new Set(summary.projects.map(project => project.code)).size !== summary.projects.length) {
    issues.push('The summary lists the same project more than once, so its totals were left unchanged. Keep one line per project.');
  } else {
    patches.push(...sortedProjectPatches(summary, totals.projects));
    // Up to three leading spaces and spacing inside the bold label are harmless.
    const actual = summary.lines.find(l => ACTUAL_SUM.test(l.raw));
    if (actual) {
      const hours = (totals.sum / 60).toLocaleString('en-US', { maximumFractionDigits: 2 });
      const average = (totals.sum / 60 / totals.calendarDays).toFixed(2), days = totals.calendarDays.toLocaleString('en-US');
      // The average covers the days so far (through today), not the whole period; say how many.
      const next = actual.raw.replace(ACTUAL_SUM_VALUE, `$1${hours}h (${average}h/d over ${days}d)`);
      if (actual.raw !== next) patches.push(patch(summary.text, actual.start, actual.end, next));
    }
  }
  return { patches, issues };
}
const ACTUAL_SUM = /^ {0,3}\*\*\s*Actual Sum\s*:\s*\*\*/;
const ACTUAL_SUM_VALUE = /^( {0,3}\*\*\s*Actual Sum\s*:\s*\*\*\s*).*$/;
/**
 * Whether a summary patch only adds or updates the day count beside an unchanged average
 * (`3.39h/d` -> `3.39h/d over 547d`). Such a change is written with the next summary
 * update but is not a disagreement with the daily notes.
 */
export function wordingOnly(change: Patch): boolean {
  const plain = (text: string) => text.replace(/ over [\d,]+d\)/, ')');
  return ACTUAL_SUM.test(change.before) && plain(change.before) === plain(change.after);
}
/** Patches that change figures, leaving out wording-only updates. */
export function materialPatches(patches: Patch[]): Patch[] { return patches.filter(change => !wordingOnly(change)); }
export function reviewDescription(result: Review): string {
  return `${displayMinutes(result.sum)} · ${result.knownDays}/${result.calendarDays} known days` +
    (result.average === null ? '' : ` · ${(result.average / 60).toFixed(2)}h per known day`) + (result.complete ? '' : ' · incomplete');
}
