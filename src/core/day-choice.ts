/**
 * When more than one planner day names the same date, the one in the folder that
 * holds the most planner days is the day; the others are left alone and named in
 * Review. Ties go to the shorter path, then alphabetical order.
 */
export function folderOf(path: string): string { const at = path.lastIndexOf('/'); return at < 0 ? '' : path.slice(0, at); }
/** Planner days per folder; count once and reuse it for every date being resolved. */
export function folderCounts(all: Iterable<{ path: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of all) counts.set(folderOf(day.path), (counts.get(folderOf(day.path)) ?? 0) + 1);
  return counts;
}
export function chooseDay<T extends { path: string }>(candidates: T[], counts: ReadonlyMap<string, number>): { chosen: T; others: T[] } {
  if (!candidates.length) throw new Error('chooseDay needs at least one candidate.');
  if (candidates.length === 1) return { chosen: candidates[0]!, others: [] };
  const ranked = [...candidates].sort((a, b) => (counts.get(folderOf(b.path)) ?? 0) - (counts.get(folderOf(a.path)) ?? 0)
    || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { chosen: ranked[0]!, others: ranked.slice(1) };
}
