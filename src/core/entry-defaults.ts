import { clockMinutes } from './model';

/** Name used when an entry supplies only an end time or minutes. */
export const DEFAULT_ACTIVITY = 'activity';

export interface EntryDefaults { defaultBlockMinutes: number; defaultStartTime: string; defaultStartActivity: string }
export const ENTRY_DEFAULTS: EntryDefaults = { defaultBlockMinutes: 40, defaultStartTime: '04:45', defaultStartActivity: 'awake' };
export function validateEntryDefaults(value: EntryDefaults): void {
  if (!Number.isSafeInteger(value.defaultBlockMinutes) || value.defaultBlockMinutes <= 0 || value.defaultBlockMinutes >= 1440)
    throw new Error('Default block must be a whole number from 1 to 1439 minutes.');
  if (!/^\d{2}:\d{2}$/.test(value.defaultStartTime) || clockMinutes(value.defaultStartTime) === null || value.defaultStartTime === '24:00')
    throw new Error('Use a valid start time from 00:00 to 23:59.');
  if (!value.defaultStartActivity.trim() || /[\r\n]/.test(value.defaultStartActivity))
    throw new Error('Give the start activity a single-line name.');
}
export function normalizeEntryDefaults(value: Partial<EntryDefaults>): EntryDefaults {
  const result = { ...ENTRY_DEFAULTS };
  for (const key of Object.keys(result) as (keyof EntryDefaults)[]) {
    const candidate = { ...result, [key]: value[key] };
    try { validateEntryDefaults(candidate); Object.assign(result, candidate); } catch { /* Keep the valid default for this field. */ }
  }
  return result;
}
