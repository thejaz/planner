import { singleEmoji } from '../core/project-emojis';

/** Keep a project emoji field to one emoji while typing, picking or pasting, with a hint when text is refused. */
export function singleEmojiField(input: HTMLInputElement): HTMLInputElement {
  let kept = input.value.trim();
  const hint = createEl('p', { cls: 'planner-input-hint planner-emoji-hint', attr: { 'aria-live': 'polite' } });
  input.insertAdjacentElement('afterend', hint);
  input.addEventListener('input', event => {
    // An input method may still be composing the emoji.
    if ((event as InputEvent).isComposing) return;
    const result = singleEmoji(input.value, input.selectionStart ?? input.value.length, kept);
    hint.setText(result.refused ? 'One emoji only: type or pick a single emoji.' : '');
    if (input.value !== result.value) { input.value = result.value; input.setSelectionRange(result.value.length, result.value.length); }
    kept = result.value;
  });
  return input;
}
