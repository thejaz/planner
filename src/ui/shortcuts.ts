/**
 * Planner keyboard shortcuts: one table drives both the key handling and Help.
 *
 * Shortcuts apply while focus is anywhere inside the planner view, never while
 * typing in a field. Letter keys fire only without Ctrl/Alt/Cmd. Scope decides
 * where else a key is needed:
 * - planner: anywhere in the planner, both views.
 * - activity: in the Activity view with an activity selected (focus may be on
 *   another planner control, but not on one that uses that key itself).
 * - row: only when an activity row itself has focus, so buttons keep Enter/Space
 *   and text-like keys.
 */
export type ShortcutAction = 'previous' | 'next' | 'extend-previous' | 'extend-next' | 'edit' | 'toggle' | 'delete'
  | 'add-below' | 'shift' | 'correct' | 'duplicate' | 'move-up' | 'move-down'
  | 'open-source' | 'toggle-view' | 'day-context' | 'settings' | 'help' | 'undo' | 'redo';
export interface Shortcut {
  action: ShortcutAction; scope: 'planner' | 'activity' | 'row'; section: 'Move around' | 'Selected activity' | 'Undo';
  keys: string; description: string; matches(event: KeyboardEvent): boolean;
}
const command = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const bare = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
const letter = (e: KeyboardEvent, key: string) => bare(e) && !e.shiftKey && e.key.toLowerCase() === key;

/** Single-key row actions, also shown beside their buttons. C remains day context. */
export const ROW_SHORTCUTS = { 'add-below': 'a', edit: 'e', shift: 's', correct: 'r', duplicate: 'd', 'move-up': 'k', 'move-down': 'j', delete: 'x' } as const;
export type RowAction = keyof typeof ROW_SHORTCUTS;

export const SHORTCUTS: Shortcut[] = [
  { action: 'day-context', scope: 'planner', section: 'Move around', keys: 'C', description: 'Set day context in Activity view', matches: e => letter(e, 'c') },
  { action: 'previous', scope: 'activity', section: 'Move around', keys: 'Up', description: 'Previous activity; from another control, jump to the list',
    matches: e => bare(e) && !e.shiftKey && e.key === 'ArrowUp' },
  { action: 'next', scope: 'activity', section: 'Move around', keys: 'Down', description: 'Next activity; from another control, jump to the list',
    matches: e => bare(e) && !e.shiftKey && e.key === 'ArrowDown' },
  { action: 'extend-previous', scope: 'row', section: 'Move around', keys: 'Shift + Up / Down', description: 'Extend the selection',
    matches: e => bare(e) && e.shiftKey && e.key === 'ArrowUp' },
  { action: 'extend-next', scope: 'row', section: 'Move around', keys: 'Shift + Down', description: 'Extend the selection',
    matches: e => bare(e) && e.shiftKey && e.key === 'ArrowDown' },
  { action: 'toggle-view', scope: 'planner', section: 'Move around', keys: 'V', description: 'Switch between Activity and Report', matches: e => letter(e, 'v') },
  { action: 'help', scope: 'planner', section: 'Move around', keys: '?', description: 'Open this help', matches: e => bare(e) && e.key === '?' },
  { action: 'settings', scope: 'planner', section: 'Move around', keys: ',', description: 'Open Planner settings', matches: e => bare(e) && !e.shiftKey && e.key === ',' },
  { action: 'add-below', scope: 'activity', section: 'Selected activity', keys: 'A', description: 'Add below the current activity', matches: e => letter(e, ROW_SHORTCUTS['add-below']) },
  { action: 'edit', scope: 'activity', section: 'Selected activity', keys: 'E or F2', description: 'Edit with the time and minutes selected; Enter saves, Escape cancels',
    matches: e => letter(e, ROW_SHORTCUTS.edit) || (bare(e) && !e.shiftKey && e.key === 'F2') },
  { action: 'edit', scope: 'row', section: 'Selected activity', keys: 'Enter', description: 'Edit the focused activity', matches: e => bare(e) && !e.shiftKey && e.key === 'Enter' },
  { action: 'toggle', scope: 'row', section: 'Selected activity', keys: 'Space', description: 'Mark completed or planned', matches: e => bare(e) && !e.shiftKey && e.key === ' ' },
  { action: 'shift', scope: 'activity', section: 'Selected activity', keys: 'S', description: 'Shift selected plans', matches: e => letter(e, ROW_SHORTCUTS.shift) },
  { action: 'correct', scope: 'activity', section: 'Selected activity', keys: 'R', description: 'Preview corrections for selected plans', matches: e => letter(e, ROW_SHORTCUTS.correct) },
  { action: 'duplicate', scope: 'activity', section: 'Selected activity', keys: 'D', description: 'Duplicate the current activity as a plan', matches: e => letter(e, ROW_SHORTCUTS.duplicate) },
  { action: 'move-up', scope: 'activity', section: 'Selected activity', keys: 'K', description: 'Move the current activity up one place', matches: e => letter(e, ROW_SHORTCUTS['move-up']) },
  { action: 'move-down', scope: 'activity', section: 'Selected activity', keys: 'J', description: 'Move the current activity down one place', matches: e => letter(e, ROW_SHORTCUTS['move-down']) },
  { action: 'delete', scope: 'activity', section: 'Selected activity', keys: 'X', description: 'Preview deletion of selected activities', matches: e => letter(e, ROW_SHORTCUTS.delete) },
  { action: 'delete', scope: 'row', section: 'Selected activity', keys: 'Delete / Backspace', description: 'Delete the selected activities',
    matches: e => bare(e) && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') },
  { action: 'open-source', scope: 'activity', section: 'Selected activity', keys: 'Ctrl + Shift + O', description: 'Open its line in the note',
    matches: e => command(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o' },
  { action: 'undo', scope: 'planner', section: 'Undo', keys: 'Ctrl + Z', description: 'Undo the last planner change', matches: e => command(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' },
  { action: 'redo', scope: 'planner', section: 'Undo', keys: 'Ctrl + Shift + Z', description: 'Redo',
    matches: e => command(e) && !e.altKey && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y')) }
];
/** Help rows: the extension shortcut is listed once, under its first entry. */
export const SHORTCUT_HELP = SHORTCUTS.filter(s => s.action !== 'extend-next');

/** The shortcut for a key event, given where focus is. */
export function shortcutFor(event: KeyboardEvent, where: { onRow: boolean; activity: boolean }): Shortcut | undefined {
  return SHORTCUTS.find(s => s.matches(event) && (s.scope === 'planner' || (s.scope === 'activity' ? where.activity : where.onRow)));
}
