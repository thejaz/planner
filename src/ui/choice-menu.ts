import { setIcon } from 'obsidian';

export interface ChoiceOption { value: string; label: string; icon: string }

/**
 * Themed, keyboard-accessible menu anchored below (or above) its button.
 * Escape/Tab close it and return focus to the button when `canRestoreFocus`
 * allows; an outside click or `hide()` closes it without moving focus.
 */
export function openChoiceMenu(button: HTMLButtonElement, name: string, options: ChoiceOption[], current: string,
  choose: (value: string) => void, canRestoreFocus: () => boolean, onClose: () => void): { hide: () => void } {
  const doc = button.ownerDocument;
  const popup = doc.body.createDiv({ cls: 'planner-choice-menu', attr: { role: 'menu', 'aria-label': name } });
  const items: HTMLButtonElement[] = [];
  let open = true;
  const hide = (restore = true) => {
    if (!open) return;
    open = false;
    popup.remove(); doc.removeEventListener('keydown', keyboard, true); doc.removeEventListener('pointerdown', outside, true);
    button.setAttribute('aria-expanded', 'false');
    onClose();
    if (restore && canRestoreFocus() && button.isConnected) button.focus({ preventScroll: true });
  };
  const keyboard = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); hide(); return; }
    if (!popup.contains(event.target as Node)) return;
    const index = items.indexOf(doc.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]!.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation(); items[Math.max(index, 0)]!.click();
    } else if (event.key === 'Tab') hide();
  };
  const outside = (event: PointerEvent) => { if (!popup.contains(event.target as Node) && !button.contains(event.target as Node)) hide(false); };
  for (const option of options) {
    const item = popup.createEl('button', { cls: 'planner-choice-menu-item', attr: { type: 'button', role: 'menuitemradio', 'aria-checked': String(current === option.value) } });
    const glyph = item.createSpan({ cls: 'planner-choice-icon', attr: { 'aria-hidden': 'true' } }); setIcon(glyph, option.icon);
    item.createSpan({ text: option.label });
    const check = item.createSpan({ cls: 'planner-choice-icon', attr: { 'aria-hidden': 'true' } });
    if (current === option.value) setIcon(check, 'check');
    item.onfocus = () => { for (const other of items) other.classList.toggle('is-selected', other === item); };
    item.onclick = () => { hide(); choose(option.value); };
    items.push(item);
  }
  doc.addEventListener('keydown', keyboard, true); doc.addEventListener('pointerdown', outside, true);
  button.setAttribute('aria-expanded', 'true');
  const rect = button.getBoundingClientRect(), win = doc.defaultView!;
  popup.style.minWidth = `${Math.min(Math.max(rect.width, 200), win.innerWidth - 16)}px`;
  popup.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${rect.bottom + 4 + popup.offsetHeight > win.innerHeight ? Math.max(8, rect.top - popup.offsetHeight - 4) : rect.bottom + 4}px`;
  items[Math.max(0, options.findIndex(option => option.value === current))]!.focus();
  return { hide: () => hide(false) };
}
