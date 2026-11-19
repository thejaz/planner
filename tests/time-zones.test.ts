import { describe, expect, it } from 'vitest';
import { timeZoneChoices, zoneOffset } from '../src/core/time-zones';

describe('time zone choices', () => {
  const now = new Date('2026-01-15T12:00:00Z');
  it('lists named zones with their UTC offset, sorted, including UTC and the system zone', () => {
    const choices = timeZoneChoices('Europe/Berlin', 'Asia/Kolkata', now);
    expect(choices.length).toBeGreaterThan(100);
    const values = choices.map(c => c.value);
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    expect(new Set(values).size).toBe(values.length);
    expect(choices.find(c => c.value === 'UTC')?.label).toBe('UTC');
    expect(choices.find(c => c.value === 'Asia/Kolkata')?.label).toBe('Asia/Kolkata (UTC+05:30)');
    expect(choices.find(c => c.value === 'Europe/Berlin')?.label).toBe('Europe/Berlin (UTC+01:00)');
    expect(choices.find(c => c.value === 'America/New_York')?.label).toBe('America/New York (UTC-05:00)');
  });
  it('keeps a saved zone the runtime does not list, marked, instead of replacing it', () => {
    const choices = timeZoneChoices('Mars/Olympus', 'UTC', now);
    expect(choices.find(c => c.value === 'Mars/Olympus')?.label).toBe('Mars/Olympus (unrecognized)');
    expect(zoneOffset('Mars/Olympus', now)).toBe('');
  });
});
