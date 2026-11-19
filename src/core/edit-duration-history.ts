import { compactDuration, entryFields } from './changes';

/** Only replacing selected amount text can request a same-value calculation.
 * Actual amount changes are detected after input; boundary whitespace is not intent.
 */
export function replacesDuration(text: string, from: number, to: number, data: string | null): boolean {
  if (from === to || !data?.trim()) return false;
  const fields = entryFields(text), duration = fields?.duration;
  if (duration === undefined) return false;
  // Locate the written field, not the normalized amount (1h parses as 60),
  // and never search an activity name that happens to contain the same digits.
  let start = fields?.time ? text.indexOf(fields.time) + fields.time.length : 0;
  const labelAt = text.lastIndexOf(fields!.label);
  let end = labelAt >= start ? labelAt : text.length;
  while (start < end && /[\s;]/.test(text[start]!)) start++;
  while (end > start && /[\s;]/.test(text[end - 1]!)) end--;
  return from >= start && to <= end && from < to;
}

/** Duration-edit intent follows native text history, independently of label/context edits. */
export class EditDurationHistory {
  private states: { text: string; touched: boolean }[];
  private index = 0;
  constructor(initial: string, private readonly originalDuration: string) {
    this.states = [{ text: initial, touched: false }];
  }
  remember(text: string, touched: boolean): void {
    const current = this.states[this.index]!;
    if (current.text === text && current.touched === touched) return;
    this.states.splice(this.index + 1);
    this.states.push({ text, touched }); this.index++;
  }
  restore(text: string, direction: 'undo' | 'redo'): boolean {
    const step = direction === 'undo' ? -1 : 1;
    for (let i = this.index + step; i >= 0 && i < this.states.length; i += step) {
      if (this.states[i]!.text === text) { this.index = i; return this.states[i]!.touched; }
    }
    // A browser may restore a state predating this editor's observations.
    const touched = compactDuration(text) !== this.originalDuration;
    this.states = [{ text, touched }]; this.index = 0;
    return touched;
  }
}
