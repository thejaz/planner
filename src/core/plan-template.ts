import { totalLine } from './syntax';
import { applyPatches, changeOf, Conflict, footerPatches, makeDay, patch } from './changes';
import { DEFAULT_CODES } from './model';
import type { Change, Day, Line, Patch } from './model';
import { parseDay } from './reader';

export interface PlanReplacement {
  change: Change;
  removed: number;
  completed: number;
  added: number;
}

function headings(day: Day): Map<string, Line> {
  const result = new Map<string, Line>();
  let fenced = false;
  for (const line of day.lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fenced = !fenced; continue; }
    const name = !fenced && /^###\s+(.+?)\s*$/.exec(line.raw)?.[1];
    if (!name) continue;
    if (result.has(name)) throw new Error(`More than one “${name}” section. Give each section a unique heading before replacing the plan.`);
    result.set(name, line);
  }
  return result;
}

/** Replace activities, preserving all other source text and existing sections. */
export function replacePlan(day: Day, routine: string, codes = DEFAULT_CODES): PlanReplacement {
  if (!day.date) throw new Error('Choose a dated daily note.');
  if (day.recordedOnly) throw new Error('Edit recorded totals in the Markdown source; a plan template would mix activities with this record.');
  if (day.legacy) throw new Error('This older format is read-only in Planner. Open its source to edit it.');
  const template = parseDay(makeDay(day.date, routine), day.path, codes);
  if (template.recordedOnly) throw new Error('Choose an activity plan template, not a recorded totals note.');
  if (template.legacy) throw new Error('Choose a template with the current end-time activity format.');
  const templateError = template.diagnostics.find(d => ['invalid-time', 'backward-time', 'invalid-total', 'duplicate-total'].includes(d.code));
  if (templateError) throw new Error(`Check template line ${templateError.line + 1}: ${templateError.message}`);
  const currentHeadings = headings(day), templateHeadings = headings(template);
  const groups = new Map<string, string[]>([...templateHeadings.keys()].map(name => [name, []]));
  for (const entry of template.entries) {
    if (!groups.has(entry.section)) groups.set(entry.section, []);
    groups.get(entry.section)!.push(entry.raw);
  }
  const edits: Patch[] = [], replaced = new Set<string>();
  for (const entry of day.entries) {
    const line = day.lines[entry.line]!;
    const rows = replaced.has(entry.section) ? [] : groups.get(entry.section) ?? [];
    const after = rows.join(day.eol) + (rows.length && line.eol ? day.eol : '');
    edits.push(patch(day.text, line.start, line.fullEnd, after));
    replaced.add(entry.section);
  }
  const newSections: string[] = [];
  for (const [name, rows] of groups) {
    if (replaced.has(name)) continue;
    const heading = currentHeadings.get(name);
    if (heading) {
      if (rows.length) edits.push(patch(day.text, heading.fullEnd, heading.fullEnd,
        (heading.eol ? '' : day.eol) + day.eol + rows.join(day.eol) + day.eol));
    } else newSections.push(`### ${name}${day.eol}${day.eol}${rows.length ? rows.join(day.eol) + day.eol + day.eol : ''}`);
  }
  if (newSections.length) {
    const firstFooter = day.footers[0]?.line ?? day.lines.length;
    const lastEntry = day.entries.at(-1)?.line ?? -1;
    const divider = day.lines.filter(l => l.index > lastEntry && l.index < firstFooter && /^---\s*$/.test(l.raw)).at(-1);
    const at = divider?.start ?? day.lines[firstFooter]?.start ?? day.text.length;
    const prefix = at && !day.text.slice(0, at).endsWith(day.eol + day.eol) ? (day.text.slice(0, at).endsWith(day.eol) ? day.eol : day.eol + day.eol) : '';
    edits.push(patch(day.text, at, at, prefix + newSections.join('')));
  }
  let text = applyPatches(day.text, edits);
  // Template-specific project definitions remain ordinary readable footer rows.
  for (const code of Object.keys(template.recorded)) {
    const current = parseDay(text, day.path, codes);
    if (current.recorded[code] !== undefined) continue;
    const sum = current.footers.find(f => f.code === 'SUM');
    const at = sum ? current.lines[sum.line]!.start : text.length;
    text = applyPatches(text, [patch(text, at, at,
      (at && !text.slice(0, at).endsWith(day.eol) ? day.eol : '') + totalLine(code, 0) + day.eol)]);
  }
  const next = parseDay(text, day.path, codes);
  const issue = next.diagnostics.find(d => d.blocks && !['unknown-credit', 'unknown-project'].includes(d.code));
  if (issue) throw new Error(`The replacement needs attention on line ${issue.line + 1}: ${issue.message}`);
  text = applyPatches(text, footerPatches(next, false, codes));
  // Guard the complete previewed revision. A concurrent edit inside it must
  // request a fresh preview rather than silently discard or reinterpret work.
  const change = changeOf(day, [patch(day.text, 0, day.text.length, text)], 'Replace plan from template');
  if (!change.patches.length) throw new Conflict('This day already matches the selected template.');
  return { change, removed: day.entries.length, completed: day.entries.filter(e => e.checked).length, added: template.entries.length };
}
