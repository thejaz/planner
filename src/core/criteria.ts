import { parseMarkerCriteria } from './marker-rules';
import type { MarkerCriteria } from './marker-rules';

/**
 * Day-marker criteria live in one note, `thejaz-criteria.md`, found by name like
 * summaries. Every summary and Review use it; a Criteria & Markers section left in
 * a summary is ordinary text and is never read.
 */
export const CRITERIA_NOTE = 'thejaz-criteria.md';
export function isCriteriaPath(path: string): boolean { return (path.split('/').pop() ?? '').toLowerCase() === CRITERIA_NOTE; }
/** The vault's criteria: none means built-in minute defaults; more than one note blocks marker writes. */
export function vaultCriteria(notes: ReadonlyMap<string, string>): MarkerCriteria | null {
  const [first] = [...notes].sort(([a], [b]) => a.localeCompare(b));
  if (!first) return null;
  const [path, text] = first;
  if (notes.size > 1) return { definitions: [], combinations: [], issues: [{ path, line: 0,
    message: `Keep one ${CRITERIA_NOTE}; found ${[...notes.keys()].sort().join(', ')}. Merge them into one note.` }] };
  return parseMarkerCriteria(text, path);
}
