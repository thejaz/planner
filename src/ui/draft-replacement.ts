import type { ActivityReplacement } from '../core/activity-target';

const replacing = new WeakSet<HTMLTextAreaElement>();
export function isDraftReplacement(input: HTMLTextAreaElement): boolean { return replacing.has(input); }

/** Use the owning browser's edit history, with a selected range as one replacement. */
export function replaceDraft(input: HTMLTextAreaElement, next: ActivityReplacement): void {
  const doc = input.ownerDocument, before = input.value;
  // Chromium's native edit transaction retains typing history; direct assignments do not.
  const execute = doc.execCommand?.bind(doc), supports = doc.queryCommandSupported?.bind(doc);
  if (input.disabled || input.readOnly || !execute || !supports?.('insertText'))
    throw new Error('Undoable insertion is unavailable. Type the activity name directly; your draft is unchanged.');
  if (before.slice(0, next.from) + next.insert + before.slice(next.to) !== next.text)
    throw new Error('The draft changed. Choose the activity again.');
  const selection: [number, number] = [input.selectionStart, input.selectionEnd];
  input.focus();
  if (before === next.text) { input.setSelectionRange(next.caret, next.caret); return; }
  replacing.add(input);
  try {
    let { from, to, insert } = next;
    // A selected replacement separates this undo step from preceding typing,
    // including insertion into an omitted name after a time/duration.
    if (from === to && before.length) {
      if (from > 0) { from--; insert = before[from]! + insert; }
      else { to++; insert += before[0]!; }
    }
    input.setSelectionRange(from, to);
    const accepted = execute('insertText', false, insert);
    if (!accepted || input.value !== next.text) {
      if (input.value !== before) execute('undo');
      input.setSelectionRange(...selection);
      throw new Error('The activity could not be inserted with Undo support. Your draft was not accepted; type the name directly.');
    }
    input.setSelectionRange(next.caret, next.caret);
  } finally { replacing.delete(input); }
}
