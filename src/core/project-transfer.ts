import { applyPatches, patch } from './changes';
import { parseSummary } from './history';
import { activityGroup, activityNames, keepUnits, linesOf, minutes } from './model';
import type { Change, Day, Entry, Line, Patch } from './model';
import { calculate, effectiveTotals, parseDay } from './reader';
import { projectCode } from './projects';
import { normalizedCodes } from './project-registry';
import { normalizedEmojis, summaryEmojiChanges } from './project-emojis';
import { normalizeGroups } from './review-extras';
import type { ProjectGroup } from './review-extras';

export type ProjectTransferMode = 'rename' | 'merge';
export interface ProjectDocument { path: string; text: string; kind: 'day' | 'summary' | 'template' }
export interface ProjectIdentity { projectCodes: string[]; projectGroups: ProjectGroup[]; projectEmojis: Record<string, string> }
export interface TransferBlocker { path: string; line: number; message: string }
export interface ProjectTransfer {
  source: string; target: string; mode: ProjectTransferMode; changes: Change[];
  sources: ProjectDocument[]; before: ProjectIdentity; after: ProjectIdentity;
  blockers: TransferBlocker[]; targetExists: boolean; replacements: number;
  totals: { path: string; kind: ProjectDocument['kind']; source: number; target: number; combined: number }[];
}

/** A parsing view carries exact UTF-16 source offsets through Markdown emphasis. */
function view(raw: string, summary = false): { text: string; offsets: number[] } {
  const expression = summary ? /\*\*|==|~~|\*(?!\uFE0F?\u20E3)/g : /\*\*|\[\^[^\]]+\]/g;
  const skipped = new Set<number>();
  for (const match of raw.matchAll(expression)) for (let i = match.index; i < match.index + match[0].length; i++) skipped.add(i);
  const offsets: number[] = []; let text = '';
  for (let i = 0; i < raw.length; i++) if (!skipped.has(i)) { offsets.push(i); text += raw[i]; }
  return { text, offsets };
}
function replaceRange(text: string, line: Line, mapped: ReturnType<typeof view>, start: number, end: number, value: string): Patch {
  if (start < 0 || end <= start || mapped.offsets[start] === undefined || mapped.offsets[end - 1] === undefined) throw Error('Unsupported project notation.');
  return patch(text, line.start + mapped.offsets[start], line.start + mapped.offsets[end - 1]! + 1, value);
}
/** Unwrap only the enclosing routine fence supported by makeDay; offsets stay unchanged. */
export function projectTemplateView(text: string): string {
  const wrapped = /^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/d.exec(text);
  if (!wrapped) return text;
  const [start, end] = wrapped.indices![1]!;
  return text.slice(0, start).replace(/[^\r\n]/g, ' ') + text.slice(start, end) + text.slice(end).replace(/[^\r\n]/g, ' ');
}
function mappedCredits(values: Record<string, number>, source: string, target: string): Record<string, number> {
  const result = { ...values };
  if (Object.hasOwn(result, source)) { result[target] = (result[target] ?? 0) + result[source]!; delete result[source]; }
  return Object.fromEntries(Object.entries(result).filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b)));
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function safe(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function activitySource(entry: Entry): { mapped: ReturnType<typeof view>; label: [number, number]; duration?: [number, number] } | null {
  const mapped = entry.legacy ? view(entry.raw) : { text: entry.raw, offsets: Array.from({ length: entry.raw.length }, (_, i) => i) };
  const task = /^\s*-\s+\[[ xX]\]\s*(.*)$/d.exec(mapped.text); if (!task) return null;
  const body = task[1]!, base = task.indices![1]![0];
  const modern = /^(\d{1,2}:\d{1,2}|\?)\s*\(([^()]*)\)\s*:\s*(.*)$/d.exec(body);
  const range = modern ? null : /^(\d{1,2}:\d{1,2})\s*[-–]\s*(\d{1,2}:\d{1,2})\s*\(([^()]*)\)\s*:\s*(.*)$/d.exec(body);
  const endpoint = modern || range ? null : /^(\d{1,2}:\d{1,2})\s*(?::\s*)?(.*)$/d.exec(body);
  const match = modern ?? range ?? endpoint; if (!match) return null;
  const li = modern ? 3 : range ? 4 : 2, di = modern ? 2 : range ? 3 : null;
  if (match[li] !== entry.label) return null;
  return { mapped, label: match.indices![li]!.map(n => n + base) as [number, number], duration: di === null ? undefined : match.indices![di]!.map(n => n + base) as [number, number] };
}

export function transferProject(documents: ProjectDocument[], input: string, destination: string, mode: ProjectTransferMode, identity: ProjectIdentity): ProjectTransfer {
  const source = projectCode(input), target = projectCode(destination);
  const before: ProjectIdentity = { projectCodes: normalizedCodes(identity.projectCodes), projectGroups: normalizeGroups(identity.projectGroups), projectEmojis: normalizedEmojis(identity.projectEmojis) };
  const after: ProjectIdentity = structuredClone(before);
  const result: ProjectTransfer = { source, target, mode, changes: [], sources: documents, before, after, blockers: [], targetExists: before.projectCodes.includes(target), replacements: 0, totals: [] };
  const block = (path: string, line: number, message: string) => result.blockers.push({ path, line, message });
  if (!before.projectCodes.includes(source)) block('', 0, 'Choose a registered source project.');
  if (source === target) { if (mode === 'merge') block('', 0, 'Choose a different destination project.'); return result; }
  if (mode === 'merge' && !result.targetExists) block('', 0, 'Choose an existing registered destination project.');
  if (mode === 'rename' && result.targetExists) block('', 0, `${target} already exists. Choose merge instead, or use an unused code.`);
  after.projectCodes = normalizedCodes(before.projectCodes.flatMap(code => code === source ? mode === 'merge' ? [] : [target] : [code]));
  after.projectGroups = before.projectGroups.map(g => ({ ...g, projects: g.projects.flatMap(code => code === source ? mode === 'merge' ? [] : [target] : [code]) }));
  delete after.projectEmojis[source];
  if (mode === 'rename' && before.projectEmojis[source]) after.projectEmojis[target] = before.projectEmojis[source]!;
  const known = [...new Set([...before.projectCodes, source])];
  const parsedDays: Day[] = [], summaries: ReturnType<typeof parseSummary>[] = [];

  for (const doc of documents) {
    const patches: Patch[] = [], label = `${mode === 'rename' ? 'Rename' : 'Merge'} project ${source} ${mode === 'rename' ? 'to' : 'into'} ${target}`;
    const add = (p: Patch) => { if (p.before !== p.after) { patches.push(p); result.replacements++; } };
    if (doc.kind === 'summary') {
      const summary = parseSummary(doc.text, doc.path); summaries.push(summary);
      let section = '', fenced = false;
      for (const line of summary.lines) {
        if (/^\s*(```|~~~)/.test(line.raw)) { fenced = !fenced; continue; }
        if (fenced) continue;
        const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line.raw); if (heading) section = heading[1]!.toLowerCase();
        if (section === 'projects' && new RegExp(`\\b(${source}|${target})\\s*=`, 'i').test(line.raw) && !summary.projects.some(p => p.line === line.index)) block(doc.path, line.index, 'This project line cannot be read. Fix it to the form EMOJI CODE = minutes first.');
      }
      const old = summary.projects.filter(p => p.code === source), existing = summary.projects.filter(p => p.code === target);
      if (mode === 'rename' && existing.length) block(doc.path, existing[0]!.line, `${target} is already declared here.`);
      if (!old.length) continue;
      if (old.length > 1 || existing.length > 1) { block(doc.path, old[0]!.line, 'One of these projects is listed twice here. Keep one line for each first.'); continue; }
      const from = old[0]!, to = existing[0], total = from.value + (mode === 'merge' ? to?.value ?? 0 : 0);
      result.totals.push({ path: doc.path, kind: doc.kind, source: from.value, target: to?.value ?? 0, combined: total });
      if (!safe(total)) { block(doc.path, from.line, 'The combined total is too large to calculate safely. Check the numbers for a typo.'); continue; }
      const kept = mode === 'merge' && to ? to : from, line = summary.lines[kept.line]!, mapped = view(line.raw, true);
      const match = new RegExp(`\\b(${kept.code})\\s*=\\s*(\\d+)\\s*$`, 'id').exec(mapped.text);
      if (!match) { block(doc.path, kept.line, 'This project line has extra text the planner cannot rewrite safely. Simplify it to EMOJI CODE = minutes first.'); continue; }
      if (kept === from) add(replaceRange(doc.text, line, mapped, ...match.indices![1]!, target));
      if (mode === 'merge' && to) {
        add(replaceRange(doc.text, line, mapped, ...match.indices![2]!, String(total).padStart(match[2]!.length, '0')));
        const removed = summary.lines[from.line]!; add(patch(doc.text, removed.start, removed.fullEnd, ''));
      }
      if (mode === 'merge') {
        const emoji = after.projectEmojis[target];
        if (!emoji) block(doc.path, kept.line, 'Give the destination project an emoji in Projects settings before merging.');
        else {
          // Patch the retained source row using its old code until the rename is applied.
          const emojis = { [kept.code]: emoji };
          const update = summaryEmojiChanges({ ...summary, projects: [kept] }, emojis, new Set([kept.code]));
          if (update.issues.length) block(doc.path, kept.line, 'The emoji before this project code cannot be read. Leave a single emoji before the code first.');
          update.patches.forEach(add);
        }
      }
    } else {
      const parsing = doc.kind === 'template' ? projectTemplateView(doc.text) : doc.text;
      const day = parseDay(parsing, doc.kind === 'template' ? '' : doc.path, known), lines = linesOf(doc.text);
      if (doc.kind === 'day') parsedDays.push(day);
      const oldFooters = day.footers.filter(f => f.code === source), targetFooters = day.footers.filter(f => f.code === target);
      if (mode === 'rename' && targetFooters.length) block(doc.path, targetFooters[0]!.line, `${target} is already declared here, including zero totals.`);
      const affected = oldFooters.length || day.entries.some(e => activityNames(e.label).some(n => n.toUpperCase() === source));
      if (affected && (oldFooters.length > 1 || targetFooters.length > 1)) block(doc.path, oldFooters[0]?.line ?? targetFooters[0]!.line, 'One of these projects has two totals in this note. Keep one each first.');
      for (const diagnostic of day.diagnostics) if (diagnostic.code === 'invalid-total' && new RegExp(`\\b(${source}|${target})\\b`).test(diagnostic.message)) block(doc.path, diagnostic.line, 'This project total cannot be read. Fix it to CODE = minutes first.');
      if (affected && mode === 'merge' && doc.kind !== 'template' && day.entries.length) {
        for (const diagnostic of day.diagnostics) if (diagnostic.code === 'total-conflict' && new RegExp(`^(${source}|${target}):`).test(diagnostic.message)) block(doc.path, diagnostic.line, 'The total for this project in this note does not match its completed activities. Choose Compare totals, or fix the note, before merging.');
      }
      if (oldFooters.length === 1 && targetFooters.length <= 1) {
        const from = oldFooters[0]!, to = targetFooters[0], total = from.value + (mode === 'merge' ? to?.value ?? 0 : 0);
        const kept = mode === 'merge' && to ? to : from, line = lines[kept.line]!, mapped = view(line.raw);
        // Current `CODE = N` and historical `Total CODE Time: N` share the code/number group layout.
        const current = /^(\s*)([a-z][a-z0-9]*)\s*=\s*(\d+)\s*$/id.exec(mapped.text);
        const modern = current ? null : /^(\s*)(\d+)\s*:\s*([a-z][a-z0-9]*)(?:\s+add)?\s*$/id.exec(mapped.text);
        const legacy = current || modern ? null : /^(\s*)(?:Total\s+)?([a-z][a-z0-9]*)(?:\s+Time)?\s*:\s*([\dhm\s]+?)(?:\s*\([^)]*\))?\s*$/id.exec(mapped.text);
        const match = current ?? modern ?? legacy;
        if (!match || !safe(total)) block(doc.path, kept.line, 'This project total cannot be read or is too large. Fix it to CODE = minutes first.');
        else {
          if (kept === from) add(replaceRange(doc.text, line, mapped, ...match.indices![modern ? 3 : 2]!, target));
          if (mode === 'merge' && to) {
            if (/\[\^|\([^)]*\)/.test(lines[from.line]!.raw)) block(doc.path, from.line, 'This total has a note or footnote attached. Move it to its own line before combining.');
            const number = match.indices![modern ? 2 : 3]!;
            const formatted = current ? String(total) : modern ? String(total).padStart(match[2]!.length, '0') : /h|m/i.test(match[3]!) ? `${Math.floor(total / 60)}h ${total % 60}m` : String(total).padStart(match[3]!.length, '0');
            add(replaceRange(doc.text, line, mapped, ...number, formatted));
            const removed = lines[from.line]!; add(patch(doc.text, removed.start, removed.fullEnd, ''));
          }
        }
      }
      for (const entry of day.entries) {
        const units = activityGroup(entry.label).units, components = units.map(unit => unit.name);
        const old = units.filter(u => u.name.toUpperCase() === source), dest = units.filter(u => u.name.toUpperCase() === target);
        if (mode === 'rename' && dest.length) block(doc.path, entry.line, `${target} is already used in an activity component. Choose another code to avoid changing its meaning.`);
        if (!old.length) continue;
        if (entry.unknownCredit) { block(doc.path, entry.line, 'The minutes per project in this activity are unclear. Give one amount per project first.'); continue; }
        if (Object.values(entry.credits).some(value => !safe(value)) || (entry.elapsed !== null && !safe(entry.elapsed))) { block(doc.path, entry.line, 'This activity has a number too large to calculate safely. Check it for a typo.'); continue; }
        const located = activitySource(entry), line = lines[entry.line]!;
        if (!located) { block(doc.path, entry.line, 'The planner cannot rewrite this activity line safely. Edit it in the note first.'); continue; }
        const labelAt = located.label[0];
        if (mode === 'merge' && old.length && dest.length) {
          const values = entry.duration.split('/')[0]!.split(/\s*[-+|]\s*/).map(minutes);
          if (!located.duration || values.length !== components.length || values.some(v => v === null)) { block(doc.path, entry.line, 'Give one amount per project in this activity (for example 60-30) before combining projects.'); continue; }
          const affectedIndexes = components.map((name, i) => [source, target].includes(name.toUpperCase()) ? i : -1).filter(i => i >= 0), first = affectedIndexes[0]!;
          const combined = affectedIndexes.reduce((sum, i) => sum + values[i]!, 0);
          if (!safe(combined)) { block(doc.path, entry.line, 'The combined minutes are too large to calculate safely. Check the numbers for a typo.'); continue; }
          const kept = components.map((_, i) => i).filter(i => i === first || !affectedIndexes.includes(i));
          // The combined part takes the target name and keeps every merged part's words and parentheses.
          const rest = (unit: (typeof units)[number]) => entry.label.slice(unit.nameEnd, unit.end);
          const nextLabel = keepUnits(entry.label, units, kept, (unit, text) => unit === units[first] ? target.toLowerCase() + affectedIndexes.map(i => rest(units[i]!)).join('') : text);
          const originalValues = entry.duration.split('/')[0]!.trim().split(/\s*[-+|]\s*/);
          const durationSeparators = [...entry.duration.split('/')[0]!.matchAll(/\s*[-+|]\s*/g)].map(m => m[0]);
          const nextAmounts = kept.map((i, at) => (at ? durationSeparators[i - 1]! : '') + (i === first ? String(combined) : originalValues[i])).join('');
          const amount = /^\s*([^/]*?)(?=\s*(?:\/|$))/.exec(entry.duration)![1]!;
          const durationAt = located.duration[0] + located.mapped.text.slice(...located.duration).indexOf(amount);
          add(replaceRange(doc.text, line, located.mapped, labelAt, labelAt + entry.label.length, nextLabel));
          add(replaceRange(doc.text, line, located.mapped, durationAt, durationAt + amount.length, nextAmounts));
        } else for (const unit of old) add(replaceRange(doc.text, line, located.mapped, labelAt + unit.nameStart, labelAt + unit.nameEnd, target.toLowerCase()));
      }
      let next: Day;
      try { next = parseDay(doc.kind === 'template' ? projectTemplateView(applyPatches(doc.text, patches)) : applyPatches(doc.text, patches), day.path, after.projectCodes); }
      catch { block(doc.path, 0, 'This note mentions these projects in a way the planner cannot rewrite safely. Edit it first.'); continue; }
      const a = calculate(day), b = calculate(next);
      if (next.footers.some(f => f.code === source) || next.entries.some(e => activityNames(e.label).some(n => n.toUpperCase() === source))) block(doc.path, 0, 'Some mentions of the project could not be renamed safely. Edit how they are written first.');
      if (!equal(mappedCredits(a.projects, source, target), mappedCredits(b.projects, source, target)) || !equal(mappedCredits(a.planned, source, target), mappedCredits(b.planned, source, target)) || !equal(mappedCredits(day.recorded, source, target), mappedCredits(next.recorded, source, target)) || day.recordedSum !== next.recordedSum || a.complete !== b.complete || day.entries.some((e, i) => e.time !== next.entries[i]?.time || e.elapsed !== next.entries[i]?.elapsed || e.checked !== next.entries[i]?.checked)) block(doc.path, 0, 'Renaming here would change minutes or completeness unexpectedly. Check the activities in this note first.');
      const priorErrors = day.diagnostics.filter(d => d.blocks).map(d => `${d.code}:${d.message.replace(new RegExp(`\\b${source}\\b`, 'g'), target)}`);
      for (const diagnostic of next.diagnostics) if (diagnostic.blocks) {
        const index = priorErrors.indexOf(`${diagnostic.code}:${diagnostic.message}`);
        if (index < 0) block(doc.path, diagnostic.line, 'Renaming here would make a line unreadable. Fix the note first.');
        else priorErrors.splice(index, 1);
      }
      if (affected && doc.kind !== 'template') { const totals = effectiveTotals(day).projects; const amount = (totals[source] ?? 0) + (mode === 'merge' ? totals[target] ?? 0 : 0); if (!safe(amount)) block(doc.path, 0, 'The combined daily minutes are too large to calculate safely. Check the numbers for a typo.'); result.totals.push({ path: doc.path, kind: doc.kind, source: totals[source] ?? 0, target: totals[target] ?? 0, combined: amount }); }
    }
    if (patches.length) {
      if (doc.kind === 'summary') {
        const original = parseSummary(doc.text, doc.path), next = parseSummary(applyPatches(doc.text, patches), doc.path);
        if (next.projects.some(p => p.code === source) || !equal(mappedCredits(Object.fromEntries(original.projects.map(p => [p.code, p.value])), source, target), mappedCredits(Object.fromEntries(next.projects.map(p => [p.code, p.value])), source, target)) || !equal(original.rows.map(r => [r.date, r.value]), next.rows.map(r => [r.date, r.value])) || original.start !== next.start || original.end !== next.end) block(doc.path, 0, 'Renaming here would change other numbers in this summary. Fix the project line first.');
      }
      result.changes.push({ path: doc.path, base: doc.text, patches, label, strictSource: true });
    }
  }
  if (mode === 'merge') for (const summary of summaries) {
    if (!summary.projects.some(p => p.code === source) || !summary.start || !summary.end) continue;
    const period = parsedDays.filter(d => d.date && d.date >= summary.start! && d.date <= summary.end!);
    const dates = new Set(period.map(d => d.date));
    if (period.length !== dates.size) { block(summary.path, 0, 'Some dates in this summary period have more than one note. Keep one note per date before merging.'); continue; }
    // Incomplete historical coverage is valid; compare aggregates only when every recorded day is available.
    if (!summary.rows.length || summary.rows.some(r => !dates.has(r.date) || r.value === null)) continue;
    for (const code of [source, target]) {
      const declaration = summary.projects.find(p => p.code === code); if (!declaration) continue;
      if (period.some(d => d.entries.some(e => e.checked && e.unknownCredit) && d.recorded[code] === undefined)) { block(summary.path, declaration.line, 'Some days in this period have activities with unclear minutes. Fix them before merging.'); continue; }
      const actual = period.reduce((sum, d) => sum + (effectiveTotals(d).projects[code] ?? 0), 0);
      if (!safe(actual) || actual !== declaration.value) block(summary.path, declaration.line, `${code}'s total in this summary does not match the daily notes. Choose Review summary to fix it before merging.`);
    }
  }
  result.blockers = result.blockers.filter((b, i, all) => all.findIndex(a => equal(a, b)) === i);
  return result;
}
