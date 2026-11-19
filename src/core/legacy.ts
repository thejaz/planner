import { minutes } from './model';

/** Read-only compatibility with earlier ranges, endpoints and hour/minute totals. */
export function legacyActivity(text: string): { startTime: string | null; time: string; duration: string; label: string } | null {
  const range = /^(\d{1,2}:\d{1,2})\s*[-–]\s*(\d{1,2}:\d{1,2})\s*\(([^()]*)\)\s*:\s*(.*)$/.exec(text);
  if (range) return { startTime: range[1]!, time: range[2]!, duration: range[3]!, label: range[4]! };
  const endpoint = /^(\d{1,2}:\d{1,2})\s*(?::\s*)?(.*)$/.exec(text);
  return endpoint ? { startTime: null, time: endpoint[1]!, duration: 'n/a', label: endpoint[2]! } : null;
}

export function legacyTotal(text: string, known: Set<string>): { code: string; value: number } | null {
  const footer = /^([A-Z][A-Z0-9]*)\s*:\s*(\d+(?:\s*[hm])?(?:\s+\d+\s*m)?)$/i.exec(text);
  const named = /^Total ([A-Z][A-Z0-9]*) Time:\s*([\dhm\s]+?)(?:\s*\([^)]*\))?\s*$/i.exec(text);
  const match = footer ?? named;
  if (!match) return null;
  const code = match[1]!.toUpperCase(), value = minutes(match[2]!);
  return value !== null && (known.has(code) || (footer && code === 'SUM')) ? { code, value } : null;
}
