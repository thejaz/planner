export interface CacheEntry { mtime: number; size: number; text: string }
/** A verified entry stays valid while the file revision and the parsed text are both unchanged. */
export function reusableEntry(known: CacheEntry | undefined, mtime: number, size: number, text: string): known is CacheEntry {
  return !!known && known.mtime === mtime && known.size === size && known.text === text;
}
