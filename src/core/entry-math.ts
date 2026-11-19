/** One credit amount: whole minutes, or a decimal fraction (.25, 1.2) of the elapsed time. */
export const CREDIT_AMOUNT = String.raw`(?:\d*\.\d+|\d+)`;
/** Input-only amounts with units: 1h, 1h30, 1h 30m, 90m. Notes store plain minutes. */
export const UNIT_AMOUNT = String.raw`(?:\d+\s*h(?:\s*\d+\s*m?)?|\d+\s*m)`;
/** Replace unit amounts with minutes: `1h 30m/2h` becomes `90/120`. */
export function unitMinutes(duration: string): string {
  return duration.replace(/(\d+)\s*h(?:\s*(\d+)\s*m?)?|(\d+)\s*m\b/gi,
    (_, hours?: string, rest?: string, plain?: string) => String(hours !== undefined ? Number(hours) * 60 + Number(rest ?? 0) : Number(plain)));
}

/** Divide a total evenly in whole minutes, earlier parts taking any remainder (10 -> 4-3-3). */
export function equalSplit(total: number, parts: number): number[] {
  return allocateCredits(Array.from({ length: parts }, () => total / parts), total);
}
/**
 * Whole minutes for a group of exact shares, never more than `elapsed` in all: the group is
 * apportioned as a whole, remainder minutes going in source order on ties.
 */
export function allocateCredits(values: number[], elapsed: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(elapsed) || elapsed < 0 || !Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER || values.some(n => !Number.isFinite(n) || n < 0))
    throw new Error('Use finite, non-negative minutes that can be calculated safely.');
  const units = Math.min(Math.round(total), Math.floor(elapsed));
  if (!total || !units) return values.map(() => 0);
  const quotas = values.map(value => value / total * units), allocated = quotas.map(Math.floor);
  const order = quotas.map((quota, i) => ({ i, remainder: quota - allocated[i]! }))
    .sort((a, b) => Math.abs(b.remainder - a.remainder) < 1e-10 ? a.i - b.i : b.remainder - a.remainder);
  const remaining = units - allocated.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < remaining; i++) allocated[order[i]!.i]!++;
  return allocated;
}
export function hasPercent(duration: string): boolean { return /(?:^|[-\s])\d*\.\d/.test(duration.trim()); }
/**
 * `.25/` credits 25% of the elapsed minutes and `.1/20` 10% of an explicit 20-minute
 * duration; `.5-.5/` gives each activity of `pr1 & pr2` its own share, in order.
 * Callers require one amount per activity. The shares never exceed elapsed in all.
 * The result is an ordinary `credits/elapsed` duration.
 */
export function resolvePercent(duration: string, elapsed: number): string {
  const credits = duration.split('/')[0]!.replace(/\s/g, '');
  const values = credits.split('-').map(amount => Number(amount) * (amount.includes('.') ? elapsed : 1));
  return `${allocateCredits(values, elapsed).join('-')}/${elapsed}`;
}
