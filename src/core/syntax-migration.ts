import { activityPrefix, clockMinutes, clockText, linesOf, minutes } from './pre-ampersand/model';
import { calculate, parseDay } from './pre-ampersand/reader';
import { legacyActivity, legacyTotal } from './pre-ampersand/legacy';
import { parseSummary } from './history';
import { ANCHOR, RETIRED_PERIOD, RETIRED_PLAN_HEADING, RETIRED_SUMMARY_ROW, headingDate, nameSeparatorIssue, planDate, summaryRow, totalLine } from './pre-ampersand/syntax';
import { dateFromPath, validDate } from './pre-ampersand/model';

/**
 * One-time conversion of a note to the 0.2.61 grammar (see `syntax.ts`). Only the
 * retired forms change; every other byte is kept. The result carries the checks that
 * prove the counted minutes are unchanged, and callers refuse a note with issues.
 */
export interface SyntaxMigration { text: string; changed: number; kind: 'daily' | 'summary' | 'none'; issues: string[] }

const ROW = /^(\s*-\s+\[[ xX]\]\s*)(\d{1,2}:\d{1,2})\s*\(([^()]*)\)\s*(:?)\s*(.*)$/;
const TASK = /^(\s*-\s+\[[ xX]\]\s*)(.*)$/;
const FOOTER = /^(\s*(?:\*\*)?\s*)(\d+)\s*:\s*([A-Za-z][A-Za-z0-9]*)(?:\s+add)?((?:\s*\*\*)?(?:\[\^[^\]]+\])?\s*)$/;
const PLANNER_NOTE = /^\s*(?:\*\*)?\s*(?:\d+\s*:\s*SUM|SUM\s*=\s*\d+|Sum:)/im;

function time(text: string): string {
  const clock = clockMinutes(text);
  return clock === null || clock === 1440 ? text : clockText(clock);
}
/** Join activity names with `-`; a one-amount row naming one project gives it the amount and 0 to the rest. */
function joinNames(label: string, duration: string, known: Set<string>): { label: string; duration: string } {
  if (!nameSeparatorIssue(label)) return { label, duration };
  const name = activityPrefix(label.trim()), at = label.indexOf(name);
  const parts = name.split(/\s*[-+|/]\s*/);
  const joined = label.slice(0, at) + parts.join('-') + label.slice(at + name.length);
  const [credit, ...elapsed] = duration.split('/');
  const values = credit!.trim().split(/\s*-\s*/);
  const projects = parts.map(p => known.has(p.toUpperCase()));
  if (values.length !== 1 || !/^\d+$/.test(values[0]!) || parts.length < 2 || projects.filter(Boolean).length !== 1) return { label: joined, duration };
  const amounts = parts.map((_, i) => projects[i] ? values[0]! : '0');
  return { label: joined, duration: [amounts.join('-'), ...elapsed].join('/') };
}
function migrateRow(raw: string, known: Set<string>): string {
  const row = ROW.exec(raw);
  if (row) {
    const [, prefix, clock, duration, colon, label] = row;
    let next = { label: label!, duration: duration!.replace(/(\d)\s*[+|]\s*(?=\.?\d)/g, '$1-') };
    if (next.label.trim() === '→') next.label = next.label.replace('→', ANCHOR);
    // The anchor marks a time, not an activity: `12:55 (n/a) : >`.
    if (next.label.trim() === ANCHOR && /^0+$/.test(next.duration.trim())) next.duration = 'n/a';
    if (next.label.trim() === '...' && next.duration.trim() === '?') next.duration = 'n/a';
    next = joinNames(next.label, next.duration, known);
    const normalized = time(clock!);
    if (next.label === label && next.duration === duration && normalized === clock) return raw;
    return `${prefix}${normalized} (${next.duration})${colon || next.label !== label ? ' : ' : ' '}${next.label}`;
  }
  // Pre-plugin rows: `**06:00 - 06:40 (40m)**: Walk` and `**22:30**: Bedtime`.
  const task = TASK.exec(raw);
  const legacy = task && /^\s*(?:\*\*)?\d{1,2}:\d{1,2}/.test(task[2]!) ? legacyActivity(task[2]!.replace(/\*\*/g, '')) : null;
  if (!task || !legacy) return raw;
  const amount = minutes(legacy.duration);
  const next = joinNames(legacy.label.trim(), amount === null ? legacy.duration.trim() : String(amount), known);
  return `${task[1]}${time(legacy.time)} (${next.duration}) : ${next.label}`;
}
/** `## plan for 05.10.26` becomes `## plan for 5 oct 26`; a template's `??.??.26` becomes `?? ??? 26`. */
function migrateHeading(raw: string): string {
  const placeholder = /^(##\s+plan for\s+)DD\.MM\.YY(\s*)$/i.exec(raw);
  if (placeholder) return `${placeholder[1]}D mon YY${placeholder[2]}`;
  const old = RETIRED_PLAN_HEADING.exec(raw);
  if (!old) return raw;
  if (old[2] === '??' || old[3] === '??') return `${old[1]}?? ??? ${old[4]}${old[5]}`;
  const date = `20${old[4]}-${old[3]}-${old[2]}`;
  return validDate(date) ? `${old[1]}${planDate(date)}${old[5]}` : raw;
}
function migrateTotal(raw: string, known: Set<string>): string {
  const footer = FOOTER.exec(raw);
  if (footer && (known.has(footer[3]!.toUpperCase()) || /^[A-Z][A-Z0-9]*$/.test(footer[3]!)))
    return footer[1]! + totalLine(footer[3]!.toUpperCase(), Number(footer[2])) + footer[4]!;
  const old = legacyTotal(raw.replace(/\*\*/g, '').trim(), known);
  return old ? raw.match(/^\s*/)![0] + totalLine(old.code, old.value) : raw;
}

/** The counted meaning of a day: what must not change. */
function meaning(text: string, codes: string[]): string {
  const day = parseDay(text, '', codes), totals = calculate(day);
  return JSON.stringify({ projects: totals.projects, planned: totals.planned, recorded: day.recorded, sum: day.recordedSum,
    entries: day.entries.map(e => [e.checked, e.clock, e.credits, ['>', '→'].includes(e.label.trim()) ? 'anchor' : e.elapsed, e.unknownCredit]) });
}
function fenceBodies(text: string): string[] {
  const bodies: string[] = [];
  let body: string[] | null = null;
  for (const line of linesOf(text)) {
    if (/^\s*(```|~~~)/.test(line.raw)) { if (body) bodies.push(body.join('\n')); body = body ? null : []; continue; }
    body?.push(line.raw);
  }
  return bodies;
}

export function migrateDaily(text: string, path: string, codes: string[]): SyntaxMigration {
  const known = new Set(codes.map(c => c.toUpperCase()));
  const template = /(^|[\\/])_Codes[\\/]/.test(path);
  if (!template && !PLANNER_NOTE.test(text)) return { text, changed: 0, kind: 'none', issues: [] };
  let fence = false, changed = 0, out = '';
  for (const line of linesOf(text)) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; out += line.raw + line.eol; continue; }
    let next = line.raw;
    // Template bodies are often fenced; ordinary notes keep fenced text as written.
    if (!fence || template) next = migrateHeading(next) !== next ? migrateHeading(next)
      : migrateTotal(next, known) === next ? migrateRow(next, known) : migrateTotal(next, known);
    if (next !== line.raw) changed++;
    out += next + line.eol;
  }
  const issues: string[] = [], named = dateFromPath(path);
  // A heading naming another date than its file is left for the owner to settle.
  for (const line of linesOf(text)) {
    const date = /^##\s+plan for\b/i.test(line.raw) ? headingDate(line.raw) : null;
    if (named && date && date !== named) issues.push(`${path}:${line.index + 1}: the heading names ${date}, but the note is ${named}.`);
  }
  if (meaning(text, codes) !== meaning(out, codes)) issues.push(`${path}: counted minutes would change.`);
  const before = fenceBodies(text), after = fenceBodies(out);
  if (before.length !== after.length || before.some((body, i) => meaning(body, codes) !== meaning(after[i]!, codes)))
    issues.push(`${path}: a fenced template's counted minutes would change.`);
  for (const body of [out, ...(template ? after : [])])
    for (const d of parseDay(body, path, codes).diagnostics.filter(d => d.code === 'retired-syntax'))
      issues.push(`${path}:${d.line + 1}: still retired: ${d.message}`);
  return { text: out, changed, kind: 'daily', issues };
}

export function migrateSummary(text: string, path: string): SyntaxMigration {
  const summary = parseSummary(text, path);
  if (!summary.retired.length) return { text, changed: 0, kind: 'summary', issues: [] };
  const lines = linesOf(text), byLine = new Map(summary.rows.map(r => [r.line, r]));
  let changed = 0, out = '';
  for (const line of lines) {
    let next = line.raw;
    const row = byLine.get(line.index), old = RETIRED_SUMMARY_ROW.exec(line.raw);
    if (row && old) next = old[1]! + summaryRow(row.date, row.value ?? '?') + old[4]!;
    const period = RETIRED_PERIOD.exec(next);
    if (period && summary.start && summary.end) next = next.replace(period[0], `Days (${summary.start} - ${summary.end})`);
    if (next !== line.raw) changed++;
    out += next + line.eol;
  }
  const after = parseSummary(out, path), issues: string[] = [];
  const shape = (s: typeof summary) => JSON.stringify([s.start, s.end, s.rows.map(r => [r.date, r.value])]);
  if (shape(summary) !== shape(after)) issues.push(`${path}: summary dates or minutes would change.`);
  for (const r of after.retired) issues.push(`${path}:${r.line + 1}: still retired: ${r.message}`);
  return { text: out, changed, kind: 'summary', issues };
}

/** Summaries are the notes with a Days period line; every other planner note uses the daily rules. */
export function migrateSyntax(text: string, path: string, codes: string[]): SyntaxMigration {
  return /^\s*Days\s*\(/m.test(text) && !/(^|[\\/])_Codes[\\/]/.test(path) ? migrateSummary(text, path) : migrateDaily(text, path, codes);
}
