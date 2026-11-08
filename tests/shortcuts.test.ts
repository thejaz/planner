import { describe, expect, it } from 'vitest';
import { ROW_SHORTCUTS, SHORTCUTS, SHORTCUT_HELP, shortcutFor } from '../src/ui/shortcuts';

const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }) as KeyboardEvent;
describe('single-key activity actions', () => {
  it.each(Object.entries(ROW_SHORTCUTS))('%s has one unambiguous single-key binding', (action, key) => {
    expect(shortcutFor(event(key), { onRow: true, activity: true })?.action).toBe(action);
    expect(shortcutFor(event(key.toUpperCase()), { onRow: true, activity: true })?.action).toBe(action);
    expect(SHORTCUTS.filter(shortcut => shortcut.matches(event(key))).map(shortcut => shortcut.action)).toEqual([action]);
    expect(SHORTCUT_HELP.some(shortcut => shortcut.action === action && shortcut.keys.includes(key.toUpperCase()))).toBe(true);
  });
  it.each(Object.entries(ROW_SHORTCUTS))('%s leaves modified keys and Report alone', (_, key) => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])
      expect(shortcutFor(event(key, { [modifier]: true }), { onRow: true, activity: true })).toBeUndefined();
    expect(shortcutFor(event(key), { onRow: false, activity: false })).toBeUndefined();
  });
  it('keeps context, existing editing/deletion aliases and native row keys', () => {
    const where = { onRow: true, activity: true };
    expect(shortcutFor(event('c'), where)?.action).toBe('day-context');
    for (const key of ['Enter', 'F2']) expect(shortcutFor(event(key), where)?.action).toBe('edit');
    for (const key of ['Delete', 'Backspace']) expect(shortcutFor(event(key), where)?.action).toBe('delete');
    expect(shortcutFor(event(' '), where)?.action).toBe('toggle');
    expect(shortcutFor(event('ArrowUp'), where)?.action).toBe('previous');
    expect(shortcutFor(event('ArrowDown'), where)?.action).toBe('next');
  });
});
