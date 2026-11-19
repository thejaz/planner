import { readFile, writeFile } from 'node:fs/promises';
// Normalize only built-in UI source copy. Markdown parsers and note writers are excluded.
const replacements = { '‘': '\\u0027', '’': '\\u0027', '“': '\\u0022', '”': '\\u0022', '–': '-', '—': '-', '−': '-', '…': '...', '·': '|', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '↑': 'up', '↓': 'down', '‹': '<', '›': '>', '×': 'x' };
for (const file of ['src/ui/view.ts', 'src/ui/dialogs.ts', 'src/ui/review-settings.ts', 'src/main.ts']) {
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/[‘’“”–—−…·≥≤→←↑↓‹›×]/g, char => replacements[char]));
}
