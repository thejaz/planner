import { clockMinutes, clockText } from './model';

/** Optional 5-minute rounding of new input; existing note values are never rewritten. */
export interface Rounding { roundTimes?: boolean; roundCredits?: boolean }
export const ROUND_STEP = 5;
/** One credit amount: whole minutes, or a decimal fraction (.25, 1.2) of the elapsed time. */
export const CREDIT_AMOUNT = String.raw`(?:\d*\.\d+|\d+)`;
/** Input-only amounts with units: 1h, 1h30, 1h 30m, 90m. Notes store plain minutes. */
export const UNIT_AMOUNT = String.raw`(?:\d+\s*h(?:\s*\d+\s*m?)?|\d+\s*m)`;
/** Replace unit amounts with minutes: `1h 30m/2h` becomes `90/120`. */
export function unitMinutes(duration: string): string {
  return duration.replace(/(\d+)\s*h(?:\s*(\d+)\s*m?)?|(\d+)\s*m\b/gi,
    (_, hours?: string, rest?: string, plain?: string) => String(hours !== undefined ? Number(hours) * 60 + Number(rest ?? 0) : Number(plain)));
}

export function roundMinutes(minutes: number): number { return Math.round(minutes / ROUND_STEP) * ROUND_STEP; }
/** Nearest 5 minutes; late times stay on the same day (23:58 becomes 23:55). */
export function roundClock(time: string): string {
  const clock = clockMinutes(time);
  if (clock === null || clock === 1440) return time;
  return clockText(Math.min(roundMinutes(clock), 1440 - ROUND_STEP));
}
/**
 * Divide a total evenly, earlier parts taking any remainder. With rounding, the total is
 * rounded once and divided in 5-minute units, so the parts still add up to it (10 -> 5-5-0).
 */
export function equalSplit(total: number, parts: number, round = false): number[] {
  return allocateCredits(Array.from({ length: parts }, () => total / parts), total, round);
}
/** Round the group as a whole, apportioning remainder units in source order on ties. */
export function allocateCredits(values: number[], elapsed: number, round = false): number[] {
  const total = values.reduce((sum, value) => sum + value, 0), step = round ? ROUND_STEP : 1;
  if (!Number.isSafeInteger(elapsed) || elapsed < 0 || !Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER || values.some(n => !Number.isFinite(n) || n < 0))
    throw new Error('Use finite, non-negative minutes that can be calculated safely.');
  const units = Math.min(Math.round(total / step), Math.floor(elapsed / step));
  if (!total || !units) return values.map(() => 0);
  const quotas = values.map(value => value / total * units), allocated = quotas.map(Math.floor);
  const order = quotas.map((quota, i) => ({ i, remainder: quota - allocated[i]! }))
    .sort((a, b) => Math.abs(b.remainder - a.remainder) < 1e-10 ? a.i - b.i : b.remainder - a.remainder);
  const remaining = units - allocated.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < remaining; i++) allocated[order[i]!.i]!++;
  return allocated.map(n => n * step);
}
/** Round a group within its elapsed budget; explicit over-credit and /elapsed stay recorded. */
export function roundCredits(duration: string): string {
  if (!/^\d+(?:\s*-\s*\d+)*(?:\s*\/\s*\d+)?$/.test(duration.trim())) return duration;
  const [credits, ...elapsed] = duration.split('/');
  const values = credits!.split('-').map(Number), total = values.reduce((sum, n) => sum + n, 0);
  const budget = elapsed.length ? Number(elapsed[0]) : total;
  // Deliberately written over-credit is authoritative, not an automatic calculation.
  if (total > budget) return duration;
  const rounded = allocateCredits(values, budget, true);
  let index = 0;
  return [credits!.replace(/\d+/g, () => String(rounded[index++]!)), ...elapsed].join('/');
}
/**
 * Keep minute credits within their block and, when `round`, in 5-minute units. `cap` limits
 * credit to fewer minutes than the block (a later rounded end time); the block is then
 * recorded after the credit. Explicit over-credit and non-numeric durations stay as written.
 */
export function boundCredits(duration: string, cap: number | null, round: boolean): string {
  const [amounts = '', recorded, ...rest] = duration.replace(/\s/g, '').split('/');
  if (rest.length || !/^\d+(?:-\d+)*$/.test(amounts) || (recorded !== undefined && !/^\d+$/.test(recorded))) return duration;
  const values = amounts.split('-').map(Number), total = values.reduce((sum, n) => sum + n, 0);
  const block = recorded !== undefined ? Number(recorded) : total;
  if (total > block) return duration;
  const credits = allocateCredits(values, cap === null ? block : Math.min(block, cap), round);
  const written = credits.join('-');
  const result = recorded === undefined && credits.reduce((sum, n) => sum + n, 0) === block ? written : `${written}/${block}`;
  return result === duration.replace(/\s/g, '') ? duration : result;
}
export function hasPercent(duration: string): boolean { return /(?:^|[-\s])\d*\.\d/.test(duration.trim()); }
/**
 * `.25/` credits 25% of the elapsed minutes and `.1/20` 10% of an explicit 20-minute
 * duration; `.5-.5/` gives each activity of `pr1 & pr2` its own share, in order.
 * Callers require one amount per activity. The rounded group never exceeds elapsed.
 * The result is an ordinary `credits/elapsed` duration.
 */
export function resolvePercent(duration: string, elapsed: number, roundToStep = false): string {
  const credits = duration.split('/')[0]!.replace(/\s/g, '');
  const values = credits.split('-').map(amount => Number(amount) * (amount.includes('.') ? elapsed : 1));
  return `${allocateCredits(values, elapsed, roundToStep).join('-')}/${elapsed}`;
}
