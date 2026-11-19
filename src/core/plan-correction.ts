import { clockText, intervalBetween } from './model';
import type { Day, Entry, Change } from './model';
import { applyPatches, changeOf, linePatch } from './changes';
import { parseDay } from './reader';

type CorrectionMode = 'times' | 'durations' | 'elapsed';
const CORRECTION_MODES: { value: CorrectionMode; label: string; description: string }[] = [
  { value: 'times', label: 'Rebuild end times from durations', description: 'Start each selected block after its preceding unselected activity. Keep written durations and credit.' },
  { value: 'durations', label: 'Match durations to end times', description: 'Keep end times. Match a single amount to elapsed minutes; split allocations stay intact and receive an elapsed suffix.' },
  { value: 'elapsed', label: 'Keep credit; record elapsed time', description: 'Keep end times and credit. Correct only the recorded elapsed time, using credit/elapsed when they differ.' }
];
interface CorrectionPreview { change: Change; anchors: { time: string; label: string }[]; following: number }
/**
 * Explicit correction of the selection. Rebuilding end times continues through the
 * following planned rows only while they would otherwise run backwards (0.2.135): one
 * mistyped time no longer blocks every option. The preview shows each of those rows.
 * Completed rows change only when selected; other rows never change.
 */
export function correctPlans(day: Day, entries: Entry[], mode: CorrectionMode): CorrectionPreview {
  if (!entries.length || day.legacy) throw new Error('Select modern activities to correct.');
  if (entries.some(e => e.legacy || !day.entries.includes(e))) throw new Error('Only selected modern activities can be corrected.');
  const selected = new Set(entries);
  for (let following = 0; ; following++) {
    const result = correctOnce(day, selected, mode);
    if (!('blocked' in result)) return { ...result, following };
    const next = result.blocked;
    if (mode !== 'times' || !next || selected.has(next) || !selected.has(day.entries[day.entries.indexOf(next) - 1]!) || next.clock === null || next.elapsed === null)
      throw new Error(result.message);
    if (next.checked) throw new Error(`Line ${next.line + 1}: this correction would move the completed activity after it. Select that activity too if its time should change, or edit it.`);
    selected.add(next);
  }
}
function correctOnce(day: Day, selected: Set<Entry>, mode: CorrectionMode): Omit<CorrectionPreview, 'following'> | { blocked: Entry | undefined; message: string } {
  const endpoints = new Map<Entry, number>(), patches = [], anchors: CorrectionPreview['anchors'] = [];
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
  const last = Math.max(...[...selected].map(entry => day.entries.indexOf(entry))), next = day.entries[last + 1];
  // The row right after the corrected block, if it now (or still) runs backwards, may join it.
  if (mode === 'times' && next && after.diagnostics.some(d => d.code === 'backward-time' && d.line === next.line))
    return { blocked: next, message: `Line ${next.line + 1}: this correction would run past an unselected activity. Include that plan in the selection or edit its time.` };
  for (const issue of after.diagnostics.filter(d => d.code === 'backward-time')) {
    if (!day.diagnostics.some(d => d.code === issue.code && d.line === issue.line))
      return { blocked: undefined, message: `Line ${issue.line + 1}: this correction would run past an unselected activity. Include that plan in the selection or edit its time.` };
  }
  return { change: { ...changeOf(day, patches, 'Correct selected plans'), strictSource: true }, anchors };
}
export function correctionChoices(day: Day, entries: Entry[]) {
  return CORRECTION_MODES.map(option => {
    try { return { ...option, preview: correctPlans(day, entries, option.value), error: '' }; }
    catch (error) { return { ...option, preview: undefined, error: error instanceof Error ? error.message : String(error) }; }
  });
}
