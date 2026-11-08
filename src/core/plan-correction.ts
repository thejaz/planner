import { clockText, intervalBetween } from './model';
import type { Day, Entry, Change } from './model';
import { applyPatches, changeOf, linePatch } from './changes';
import { parseDay } from './reader';

export type CorrectionMode = 'times' | 'durations' | 'elapsed';
export const CORRECTION_MODES: { value: CorrectionMode; label: string; description: string }[] = [
  { value: 'times', label: 'Rebuild end times from durations', description: 'Start each selected block after its preceding unselected activity. Keep written durations and credit.' },
  { value: 'durations', label: 'Match durations to end times', description: 'Keep end times. Match a single amount to elapsed minutes; split allocations stay intact and receive an elapsed suffix.' },
  { value: 'elapsed', label: 'Keep credit; record elapsed time', description: 'Keep end times and credit. Correct only the recorded elapsed time, using credit/elapsed when they differ.' }
];
export interface CorrectionPreview { change: Change; anchors: { time: string; label: string }[] }
/** Explicit selection-only correction; no background repairs or changes to adjacent rows. */
export function correctPlans(day: Day, entries: Entry[], mode: CorrectionMode): CorrectionPreview {
  if (!entries.length || day.legacy) throw new Error('Select modern activities to correct.');
  // Completed rows are corrected only when explicitly selected; unselected rows never change.
  if (entries.some(e => e.legacy || !day.entries.includes(e))) throw new Error('Only selected modern activities can be corrected.');
  const selected = new Set(entries), endpoints = new Map<Entry, number>(), patches = [], anchors: CorrectionPreview['anchors'] = [];
  for (const [index, entry] of day.entries.entries()) {
    if (!selected.has(entry)) continue;
    const previous = day.entries[index - 1];
    const start = previous ? endpoints.get(previous) ?? previous.clock : null;
    if (start === null || !previous) throw new Error(`Line ${entry.line + 1}: the previous activity needs a known end time. No starting time is invented.`);
    const row = /^(\s*-\s+\[[ xX]\]\s+)(\d{1,2}:\d{1,2})(\s*\()(\s*)([^()]*?)(\s*)(\).*)$/.exec(entry.raw);
    if (!row || !/^\d+(?:\s*[-+|]\s*\d+)*(?:\s*\/\s*\d+)?$/.test(entry.duration) || entry.elapsed === null || !Number.isSafeInteger(entry.elapsed))
      throw new Error(`Line ${entry.line + 1}: supply a readable time and numeric duration first; n/a and unknown durations are preserved.`);
    if (!selected.has(previous)) anchors.push({ time: clockText(start), label: previous.label });
    let time = row[2]!, duration = entry.duration;
    if (mode === 'times') {
      if (entry.elapsed >= 1440) throw new Error(`Line ${entry.line + 1}: a duration of 24 hours or more needs a source edit.`);
      const end = start + entry.elapsed;
      time = clockText(end); endpoints.set(entry, end % 1440);
    } else {
      const elapsed = intervalBetween(start, entry.clock) ?? (entry.interval !== null ? entry.interval : null);
      if (elapsed === null) throw new Error(`Line ${entry.line + 1}: end times run backwards or are unknown. Rebuild end times first, or edit the source.`);
      const credit = entry.duration.split('/')[0]!;
      if (mode === 'durations' && /^\d+$/.test(credit)) {
        if (entry.elapsed !== elapsed) duration = String(elapsed);
      } else if (entry.elapsed !== elapsed) duration = Number(credit) === elapsed ? credit : `${credit}/${elapsed}`;
    }
    const raw = row[1]! + time + row[3]! + row[4]! + duration + row[6]! + row[7]!;
    if (raw !== entry.raw) patches.push(linePatch(day, entry.line, raw));
  }
  const after = parseDay(applyPatches(day.text, patches), day.path);
  for (const issue of after.diagnostics.filter(d => d.code === 'backward-time')) {
    if (!day.diagnostics.some(d => d.code === issue.code && d.line === issue.line))
      throw new Error(`Line ${issue.line + 1}: this correction would run past an unselected activity. Include that plan in the selection or edit its time.`);
  }
  return { change: { ...changeOf(day, patches, 'Correct selected plans'), strictSource: true }, anchors };
}
export function correctionChoices(day: Day, entries: Entry[]) {
  return CORRECTION_MODES.map(option => {
    try { return { ...option, preview: correctPlans(day, entries, option.value), error: '' }; }
    catch (error) { return { ...option, preview: undefined, error: error instanceof Error ? error.message : String(error) }; }
  });
}
