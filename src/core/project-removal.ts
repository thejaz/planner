import type { MarkerCriteria } from './marker-rules';
import { formatRowHighlight, rowMarkers } from './marker-rules';
import { applyPatches, patch } from './changes';
import { calculate, parseDay } from './reader';
import { marker, parseSummary, replaceSummaryMarkers } from './history';
import { activityGroup, activityNames, dateFromPath, keepUnits, minutes } from './model';
import type { Change, Patch } from './model';
import { projectCode } from './projects';

export interface ProjectRemoval {
  code: string; mode: 'unlink' | 'delete'; changes: Change[]; blockers: string[]; sources: { path: string; text: string }[];
}
export function removeProject(documents: { path: string; text: string }[], input: string, mode: 'unlink' | 'delete', codes: string[], weekends: number[] = [5], criteria?: MarkerCriteria | null): ProjectRemoval {
  const code = projectCode(input), result: ProjectRemoval = { code, mode, changes: [], blockers: [], sources: documents };
  const known = [...new Set([...codes, code])], sums = new Map<string, number>(), dates = new Map<string, number>(), removedByDate = new Map<string, number>();
  const label = `${mode === 'unlink' ? 'Unlink' : 'Delete'} ${code} project`;
  for (const doc of documents) {
    const date = dateFromPath(doc.path); if (!date) continue;
    dates.set(date, (dates.get(date) ?? 0) + 1);
    const day = parseDay(doc.text, doc.path, known), patches: Patch[] = [];
    for (const footer of day.footers.filter(f => f.code === code)) {
      const line = day.lines[footer.line]!; patches.push(patch(doc.text, line.start, line.fullEnd, ''));
    }
    if (day.diagnostics.some(d => d.code === 'invalid-total' && d.message.includes(` ${code} `))) result.blockers.push(`${doc.path}: the ${code} total cannot be read. Fix it first.`);
    let affected = false;
    if (mode === 'unlink') for (const entry of day.entries) {
      if (entry.unknownCredit && activityNames(entry.label).some(name => name.toUpperCase() === code))
        result.blockers.push(`${doc.path}:${entry.line + 1}: this activity's minutes per project are unclear. Give one amount per project first.`);
    }
    if (mode === 'delete') for (const entry of day.entries) {
      const { units } = activityGroup(entry.label), names = units.map(unit => unit.name);
      const indexes = names.map((name, index) => name.toUpperCase() === code ? index : -1).filter(i => i >= 0);
      if (!indexes.length) continue;
      affected = true;
      if (entry.legacy || entry.unknownCredit) { result.blockers.push(`${doc.path}:${entry.line + 1}: this activity uses an older format or unclear minutes. Fix it before deleting ${code}.`); continue; }
      const line = day.lines[entry.line]!;
      const values = entry.duration.split('/')[0]!.split(/\s*[-+|]\s*/);
      const mixed = units.some(unit => /\s\/\s/.test(unit.joiner)) && names.length > 1 && values.length === 1;
      const kept = names.map((_, i) => i).filter(i => !indexes.includes(i));
      if (!kept.length) {
        if (Object.keys(entry.credits).some(c => c !== code)) { result.blockers.push(`${doc.path}:${entry.line + 1}: this row also credits another project. Move that credit to its own row first.`); continue; }
        patches.push(patch(doc.text, line.start, line.fullEnd, '')); continue;
      }
      if (!mixed && (values.length !== names.length || values.some(v => minutes(v) === null))) {
        result.blockers.push(`${doc.path}:${entry.line + 1}: give one amount per project in this activity first.`); continue;
      }
      // A removed part takes its own words and parentheses with it.
      const nextLabel = keepUnits(entry.label, units, kept);
      const duration = mixed ? entry.duration : kept.map(i => values[i]).join('-') + (entry.duration.includes('/') ? '/' + entry.duration.split('/')[1] : '');
      const modern = /^(\s*-\s+\[[ xX]\]\s*(?:\d{1,2}:\d{1,2}|\?)\s*\()([^()]*)(\)\s*:\s*)(.*)$/.exec(line.raw);
      if (!modern) { result.blockers.push(`${doc.path}:${entry.line + 1}: the planner cannot rewrite this activity line safely. Edit it in the note.`); continue; }
      patches.push(patch(doc.text, line.start, line.end, modern[1]! + duration + modern[3]! + nextLabel));
    }
    const removed = day.recorded[code] ?? calculate(day).projects[code] ?? 0;
    removedByDate.set(date, (removedByDate.get(date) ?? 0) + removed);
    if (affected || removed) {
      if (day.diagnostics.some(d => d.code === 'duplicate-total')) result.blockers.push(`${doc.path}: this note has a total listed twice. Keep one before deleting work.`);
      if (day.diagnostics.some(d => d.code === 'invalid-total')) result.blockers.push(`${doc.path}: a total in this note cannot be read. Fix it before deleting work.`);
      if (day.recordedSum !== null) {
        const sum = day.footers.find(f => f.code === 'SUM');
        if (!sum || sum.numberStart < 0 || day.recordedSum < removed) result.blockers.push(`${doc.path}: the SUM line is missing, unreadable or too small. Fix it before deleting work.`);
        else {
          const next = day.recordedSum - removed; sums.set(date, next);
          if (removed) patches.push(patch(doc.text, sum.numberStart, sum.numberEnd, String(next)));
        }
      } else sums.set(date, calculate(parseDay(applyPatches(doc.text, patches), doc.path, known.filter(c => c !== code))).sum);
    }
    if (patches.length) result.changes.push({ path: doc.path, base: doc.text, patches, label });
  }
  for (const [date] of sums) if ((dates.get(date) ?? 0) > 1) result.blockers.push(`${date}: there is more than one note for this date. Keep one before deleting work.`);
  for (const doc of documents) {
    if (dateFromPath(doc.path)) continue;
    const summary = parseSummary(doc.text, doc.path, weekends, criteria), patches: Patch[] = [];
    for (const project of summary.projects.filter(p => p.code === code)) {
      const accounted = [...removedByDate].filter(([date]) => summary.start && summary.end && date >= summary.start && date <= summary.end).reduce((sum, [, value]) => sum + value, 0);
      if (project.value > 0 && (!summary.start || !summary.end || project.value !== accounted)) result.blockers.push(`${doc.path}: ${code}'s total in this summary does not match the daily notes. Fix the summary's Days line or project total before removing it.`);
      const line = summary.lines[project.line]!; patches.push(patch(doc.text, line.start, line.fullEnd, ''));
    }
    for (const row of summary.rows) {
      const value = sums.get(row.date); if (value === undefined) continue;
      if (summary.rows.filter(r => r.date === row.date).length > 1) { result.blockers.push(`${doc.path}: duplicate summary rows for ${row.date}.`); continue; }
      const line = summary.lines[row.line]!;
      const next = line.raw.replace(/(\d{4}-\d{2}-\d{2}\s*=\s*)(\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m?)/i, (_, before: string) => before + String(value));
      if (row.value === null) { result.blockers.push(`${doc.path}: resolve unknown credit for ${row.date} first.`); continue; }
      if (row.value !== value && next === line.raw) { result.blockers.push(`${doc.path}: simplify the amount formatting for ${row.date} before deleting credited work.`); continue; }
      const contexts = /🦥|❄|🔥|😎|🕶|☁|😣|✌/u.test(rowMarkers(line.raw)) ? marker(value, row.date, line.raw, summary.thresholds, weekends, summary.criteria) : '';
      const updated = contexts ? formatRowHighlight(replaceSummaryMarkers(next, value, contexts), contexts) : next;
      if (updated !== line.raw) patches.push(patch(doc.text, line.start, line.end, updated.trimEnd()));
    }
    if (patches.length) result.changes.push({ path: doc.path, base: doc.text, patches, label });
  }
  return result;
}
