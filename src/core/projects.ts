import type { Entry, Patch } from './model';
import { activityGroup } from './model';
import type { Summary } from './history';
import { patch } from './changes';
import { EMOJI_SUGGESTIONS, projectEmoji } from './project-emojis';

export const PROJECT_EMOJI = EMOJI_SUGGESTIONS;
export function projectCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(code) || code === 'SUM')
    throw new Error('Use a project code starting with a letter, followed by letters or numbers. SUM is reserved for totals.');
  return code;
}
export function newProjectPatch(summary: Summary, input: string, emoji: string, value = 0): Patch[] {
  const code = projectCode(input);
  emoji = projectEmoji(emoji);
  const matches = summary.projects.filter(project => project.code === code);
  if (matches.length > 1) throw new Error(`More than one ${code} total exists in Projects. Keep one before adding it.`);
  if (matches.length) return [];
  const headings = summary.lines.filter(line => /^#{1,6}\s+Projects(?:\s+#+)?\s*$/i.test(line.raw));
  if (headings.length !== 1) throw new Error('The summary needs one Projects heading. Open its source and add a ### Projects heading before Bookmarks.');
  const last = summary.projects.at(-1);
  const anchor = last ? summary.lines[last.line]! : headings[0]!;
  const eol = summary.lines.find(line => line.eol)?.eol ?? '\n';
  const at = anchor.fullEnd;
  return [patch(summary.text, at, at, (anchor.eol ? '' : eol) + `${emoji} ${code} = ${value}` + (anchor.eol ? eol : ''))];
}

export interface ProjectLabelPart { text: string; code: string | null; known: boolean }
export function projectLabelParts(entry: Pick<Entry, 'label' | 'duration'>, codes: Iterable<string>): { parts: ProjectLabelPart[]; unknown: string[] } {
  const known = new Set([...codes].map(code => code.toUpperCase()));
  // Match the same leading project notation as the Markdown reader.
  const tokens = activityGroup(entry.label).units;
  const recognized = tokens.filter(token => known.has(token.name.toUpperCase()));
  if (!recognized.length) return { parts: [{ text: entry.label, code: null, known: false }], unknown: [] };
  const mixedActivity = tokens.some(token => /\s\/\s/.test(token.joiner)) && recognized.length === 1 && entry.duration.split('/')[0]!.split(/\s*[-+|]\s*/).length === 1;
  // One amount on an & group credits the first component; the rest are not unknown projects.
  const amounts = entry.duration.split('/')[0]!.split(/\s*[-+|]\s*/).length;
  const allocated = amounts === tokens.length || (amounts === 1 && tokens.length > 1);
  const parts: ProjectLabelPart[] = [], unknown: string[] = [];
  let at = 0;
  for (const token of tokens) {
    if (!token.name) continue;
    const index = token.nameStart, code = token.name.toUpperCase(), isKnown = known.has(code);
    if (index > at) parts.push({ text: entry.label.slice(at, index), code: null, known: false });
    parts.push({ text: token.name, code: isKnown || (!mixedActivity && !allocated) ? code : null, known: isKnown });
    if (!isKnown && !mixedActivity && !unknown.includes(code)) unknown.push(code);
    at = token.nameEnd;
  }
  if (at < entry.label.length) parts.push({ text: entry.label.slice(at), code: null, known: false });
  return { parts, unknown };
}
