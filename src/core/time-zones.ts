/** One selectable time zone: its IANA name and a label with the current UTC offset. */
interface TimeZoneChoice { value: string; label: string }

/** `UTC+05:30` style offset of `zone` at `now`, or '' when the runtime cannot say. */
export function zoneOffset(zone: string, now = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now)
      .find(part => part.type === 'timeZoneName')?.value ?? '';
    return name === 'GMT' ? 'UTC+00:00' : name.replace(/^GMT/, 'UTC');
  } catch { return ''; }
}

/**
 * Every time zone this runtime knows, by name, for a settings list instead of typed text.
 * UTC, the system zone and the saved zone are always included, even on a runtime whose
 * list is short or missing; an unknown saved value is kept so it is never silently replaced.
 */
export function timeZoneChoices(saved: string, system: string, now = new Date()): TimeZoneChoice[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  let zones: string[] = [];
  try { zones = intl.supportedValuesOf?.('timeZone') ?? []; } catch { zones = []; }
  const names = [...new Set([...zones, 'UTC', system, saved].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return names.map(value => {
    const offset = zoneOffset(value, now);
    if (value === 'UTC' && offset) return { value, label: 'UTC' };
    return { value, label: `${value.replace(/_/g, ' ')}${offset ? ` (${offset})` : ' (unrecognized)'}` };
  });
}
