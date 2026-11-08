import { dateFromPath } from './model';
import { parseDay, effectiveTotals } from './reader';
import { isSummaryPath, parseSummary } from './history';
import type { Summary } from './history';
import type { Day, Change } from './model';
import { newProjectPatch, projectCode, PROJECT_EMOJI } from './projects';
import { applyPatches, minimalDiff } from './changes';

export interface ProjectDocument { path: string; text: string }
export function normalizedCodes(values: Iterable<string>): string[] {
  const codes = new Set<string>();
  for (const value of values) { try { codes.add(projectCode(value)); } catch { /* Invalid declarations never become projects. */ } }
  return [...codes];
}
export function isRoutine(path: string, folder: string): boolean {
  const root = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  return !!root && path.startsWith(root + '/');
}
/** A summary filename with a valid period is a summary even inside the routines folder; anything else there is a template. */
export function isRoutineSummary(path: string, text: string): boolean {
  if (!isSummaryPath(path)) return false;
  const summary = parseSummary(text, path);
  return !!summary.start && !!summary.end;
}
function isTemplate(doc: ProjectDocument, folder: string): boolean {
  return isRoutine(doc.path, folder) && !isRoutineSummary(doc.path, doc.text);
}
export function discoverProjectCodes(documents: Iterable<ProjectDocument>, registered: string[], folder: string, current: string): string[] {
  const sources = [...documents], saved = normalizedCodes(registered), codes = [...saved];
  // Summary definitions are collected first so historical footers see the same
  // recognition context regardless of enumeration order.
  for (const doc of sources) if (!isTemplate(doc, folder) && !dateFromPath(doc.path) && (doc.path === current || isSummaryPath(doc.path)))
    codes.push(...parseSummary(doc.text, doc.path).projects.filter(p => Number.isSafeInteger(p.value)).map(p => p.code));
  for (const doc of sources) {
    if (isTemplate(doc, folder)) continue;
    if (dateFromPath(doc.path)) {
      const day = parseDay(doc.text, doc.path, codes);
      codes.push(...Object.entries(day.recorded).filter(([, value]) => value > 0).map(([code]) => code));
    } else if (doc.path === current || isSummaryPath(doc.path)) {
      codes.push(...parseSummary(doc.text, doc.path).projects.filter(p => Number.isSafeInteger(p.value)).map(p => p.code));
    }
  }
  return [...saved, ...normalizedCodes(codes).filter(code => !saved.includes(code)).sort()];
}
/**
 * The same codes as `discoverProjectCodes`, read from notes the index has already
 * parsed: summary project rows and positive day footers. A day's recorded totals do
 * not depend on which codes are known, so nothing needs parsing again.
 */
export function codesFromParsed(days: Iterable<Pick<Day, 'recorded'>>, summaries: Iterable<Pick<Summary, 'projects'>>, registered: string[]): string[] {
  const saved = normalizedCodes(registered), codes: string[] = [];
  for (const summary of summaries) codes.push(...summary.projects.filter(p => Number.isSafeInteger(p.value)).map(p => p.code));
  for (const day of days) for (const [code, value] of Object.entries(day.recorded)) if (value > 0) codes.push(code);
  return [...saved, ...normalizedCodes(codes).filter(code => !saved.includes(code)).sort()];
}
export function summaryForDate(date: string, summaries: Iterable<Summary>): Summary {
  const matches = [...summaries].filter(s => s.start && s.end && s.start <= date && date <= s.end);
  if (matches.length !== 1) throw new Error(`${date}: ${matches.length ? 'more than one summary covers this date (' + matches.map(s => s.path).join(', ') + '). Fix their Days lines so only one does.' : 'no summary covers this date. Add it to a summary\'s Days line.'}`);
  return matches[0]!;
}
export function projectValue(days: Iterable<Day>, summary: Summary, code: string, today: string): number {
  if (!summary.start || !summary.end) throw new Error(`${summary.path}: add a readable Days line (YYYY-MM-DD - YYYY-MM-DD) first.`);
  let total = 0; const dates = new Set<string>();
  for (const day of days) {
    if (!day.date || day.date < summary.start || day.date > summary.end || day.date > today) continue;
    if (dates.has(day.date)) throw new Error(`${day.date}: there is more than one note for this date. Keep one before project totals can update.`);
    dates.add(day.date);
    if (day.recorded[code] === undefined && day.entries.some(e => e.checked && e.unknownCredit))
      throw new Error(`${day.path}: a completed activity has no minutes for its project, so ${code} cannot be totalled. Open the note and add them.`);
    if (day.diagnostics.some(d => d.blocks && /total/.test(d.code))) throw new Error(`${day.path}: a total at the bottom of this note is unreadable or repeated. Open the note and fix it first.`);
    total += effectiveTotals(day).projects[code] ?? 0;
    if (!Number.isSafeInteger(total)) throw new Error(`${code}: this project total is too large to calculate safely. Check the note totals for a typo.`);
  }
  return total;
}
/** Add missing period-specific definitions only; existing figures are never reconciled here. */
export function missingProjectChanges(days: Iterable<Day>, summaries: Iterable<Summary>, today: string, dates?: Set<string>, emojis: Record<string, string> = {}): { changes: Change[]; issues: string[] } {
  const daily = [...days], sources = [...summaries], targets = new Map<string, Set<string>>(), issues: string[] = [];
  for (const day of daily) {
    if (!day.date || day.date > today || (dates && !dates.has(day.date))) continue;
    const codes = Object.entries(day.recorded).filter(([code, value]) => value > 0 && normalizedCodes([code]).length).map(([code]) => code);
    if (!codes.length) continue;
    try {
      const summary = summaryForDate(day.date, sources);
      const pending = targets.get(summary.path) ?? new Set<string>();
      codes.forEach(code => pending.add(code)); targets.set(summary.path, pending);
    } catch (error) { issues.push((error as Error).message); }
  }
  const changes: Change[] = [];
  for (const [path, codes] of targets) {
    const summary = sources.find(s => s.path === path)!; let text = summary.text;
    for (const code of [...codes].sort()) {
      if (summary.projects.some(p => p.code === code)) continue;
      try { text = applyPatches(text, newProjectPatch(parseSummary(text, path), code, emojis[code] ?? PROJECT_EMOJI[0]!, projectValue(daily, summary, code, today))); }
      catch (error) { issues.push((error as Error).message); }
    }
    if (text !== summary.text) changes.push({ path, base: summary.text, patches: minimalDiff(summary.text, text), label: 'Register period projects' });
  }
  return { changes, issues: [...new Set(issues)] };
}
