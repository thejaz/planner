/** Normalize interface punctuation without changing capitalization or note data. */
export function uiText(value: string): string {
  // File names are identifiers, not interface copy.
  if (/^[^\r\n]+\.md$/i.test(value)) return value;
  const replacements: Record<string, string> = {
    '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-',
    '…': '...', '·': '|', '≥': '>=', '≤': '<=', '→': '->', '←': '<-',
    '↑': 'up', '↓': 'down', '‹': '<', '›': '>', '×': 'x', '\u00a0': ' '
  };
  return value.replace(/[‘’“”–—−…·≥≤→←↑↓‹›×\u00a0]/g, char => replacements[char]!);
}
/** Readable text for any thrown value. */
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
