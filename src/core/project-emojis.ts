import type { Summary } from './history';
import type { Patch } from './model';
import { patch } from './changes';

export const EMOJI_SUGGESTIONS = ['🌱', '🪁', '🦊', '🌻', '🧩', '🎨', '🎯', '🛶', '🪴', '🐬', '🦋', '🌙', '🍀', '💡', '🧭', '⭐'];
export type ProjectEmojis = Record<string, string>;
const completeEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v');
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function validProjectEmoji(input: string): boolean {
  const value = input.trim();
  if (!value || /^\p{Emoji_Modifier}$/u.test(value) || [...segments.segment(value)].length !== 1) return false;
  return completeEmoji.test(value) || completeEmoji.test(value + '\uFE0F');
}
export function projectEmoji(input: string): string {
  const value = input.trim();
  if (!validProjectEmoji(value)) throw new Error('Enter one complete emoji, or leave it blank for a random emoji.');
  return value;
}
/**
 * What a one-emoji field should hold after an edit. The emoji just typed, picked or
 * pasted (the one before the caret) replaces the previous one; other text is refused
 * (reported as `refused`) and the field keeps `kept`. Blank stays blank (a random
 * emoji is chosen on save).
 */
export function singleEmoji(value: string, caret: number, kept: string): { value: string; refused: boolean } {
  if (!value.trim()) return { value: '', refused: false };
  const parts = [...segments.segment(value)];
  const inserted = parts.filter(part => part.index < caret).at(-1)?.segment.trim();
  const next = inserted && validProjectEmoji(inserted) ? inserted
    : parts.map(part => part.segment.trim()).reverse().find(validProjectEmoji) ?? kept;
  // Replacing one emoji with another is expected; only dropped text is reported.
  return { value: next, refused: parts.some(part => part.segment.trim() && !validProjectEmoji(part.segment.trim())) };
}
export function emojiKey(value: string): string { return value.normalize('NFC').replace(/[\uFE0E\uFE0F]/g, ''); }
export function randomProjectEmoji(random = Math.random): string { return EMOJI_SUGGESTIONS[Math.min(EMOJI_SUGGESTIONS.length - 1, Math.max(0, Math.floor(random() * EMOJI_SUGGESTIONS.length)))]!; }
export function normalizedEmojis(value: unknown): ProjectEmojis {
  const result: ProjectEmojis = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [code, emoji] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    if (/^[A-Z][A-Z0-9]*$/i.test(code) && code.toUpperCase() !== 'SUM' && typeof emoji === 'string' && validProjectEmoji(emoji)) result[code.toUpperCase()] = emoji.trim();
  return result;
}
/** Ranges are UTF-16 source offsets, including joined emoji as one whole unit. */
export function projectEmojiSource(raw: string, code: string, start: number): { emoji?: string; emojiStart?: number; emojiEnd?: number; emojiInsert?: number } {
  const matches = [...raw.matchAll(new RegExp(`\\b${code}\\b`, 'gi'))];
  const at = matches.find(m => /^\s*=\s*\d+\s*$/.test(raw.slice(m.index + code.length).replace(/\*\*|==|~~|\*(?!\uFE0F?\u20E3)/g, '')))?.index;
  if (at === undefined) return {};
  const prefix = raw.slice(0, at), clean = prefix.replace(/\*\*|==|~~|\*(?!\uFE0F?\u20E3)/g, '').trim();
  if (!clean) return { emojiInsert: start + (/^\s*/.exec(raw)?.[0].length ?? 0) };
  if (!validProjectEmoji(clean)) return {};
  const index = prefix.indexOf(clean);
  return { emoji: clean, emojiStart: start + index, emojiEnd: start + index + clean.length };
}
export function assignProjectEmojis(codes: string[], stored: unknown, summaries: Summary[], random = Math.random): ProjectEmojis {
  const existing = normalizedEmojis(stored), result: ProjectEmojis = {};
  for (const code of [...codes].sort()) {
    result[code] = existing[code] ?? summaries.flatMap(s => s.projects).find(p => p.code === code && p.emoji)?.emoji ?? randomProjectEmoji(random);
  }
  return result;
}
export interface EmojiConflict { code: string; emoji: string; assigned: string; path: string; line: number }
export function summaryEmojiChanges(summary: Summary, emojis: ProjectEmojis, force = new Set<string>()): { patches: Patch[]; conflicts: EmojiConflict[]; issues: string[] } {
  const patches: Patch[] = [], conflicts: EmojiConflict[] = [], issues: string[] = [];
  for (const project of summary.projects) {
    const assigned = emojis[project.code]; if (!assigned) continue;
    if (project.emoji && emojiKey(project.emoji) !== emojiKey(assigned) && !force.has(project.code)) {
      conflicts.push({ code: project.code, emoji: project.emoji, assigned, path: summary.path, line: project.line }); continue;
    }
    if (project.emoji && project.emojiStart !== undefined && project.emojiEnd !== undefined) {
      if (force.has(project.code) && project.emoji !== assigned) patches.push(patch(summary.text, project.emojiStart, project.emojiEnd, assigned));
    } else if (project.emojiInsert !== undefined) patches.push(patch(summary.text, project.emojiInsert, project.emojiInsert, assigned + ' '));
    else issues.push(`${summary.path}:${project.line + 1}: simplify the prefix before ${project.code} to one emoji before synchronizing it.`);
  }
  return { patches, conflicts, issues };
}
