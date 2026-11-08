import { describe, expect, it } from 'vitest';
import { assignProjectEmojis, normalizedEmojis, summaryEmojiChanges, singleEmoji, validProjectEmoji } from '../src/core/project-emojis';
import { parseSummary } from '../src/core/history';
import { applyPatches } from '../src/core/changes';
import { newProjectPatch } from '../src/core/projects';
import { DEFAULT_CODES as CODES } from '../src/core/model';
import { parseDay, calculate } from '../src/core/reader';

describe('persistent project emojis', () => {
  it.each(['🦉', '☀️', '🇮🇷', '👍🏽', '👩🏽‍💻', '👨‍👩‍👧‍👦', '1️⃣', '*️⃣', '🏳️‍🌈', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'])('accepts a complete emoji %s', value => expect(validProjectEmoji(value)).toBe(true));
  it.each(['', 'abc', '12', '🇮', '😀😀', '😀 x', '👩‍', '🏽', 'á', '😀́', '😀‍😀', '🦉🏽'])('rejects incomplete or multiple emoji %s', value => expect(validProjectEmoji(value)).toBe(false));
  it('preserves assignments and allows sharing while assigning missing values only once', () => {
    const summary = parseSummary('### Projects\n🦉 CAR = 50\nTHZ = 10\n', 'thejaz-summary.md');
    let calls = 0;
    const result = assignProjectEmojis(['CAR', 'THZ', 'OTHER'], { OTHER: '🦉' }, [summary], () => { calls++; return 0; });
    expect(result).toEqual({ CAR: '🦉', OTHER: '🦉', THZ: '🌱' });
    expect(calls).toBe(1);
    expect(assignProjectEmojis(Object.keys(result), result, [], () => { throw Error('Must not reroll'); })).toEqual(result);
    expect(normalizedEmojis({ car: ' 🚗 ', sum: '🦉', BAD: 'abc' })).toEqual({ CAR: '🚗' });
  });
  it.each(['\n', '\r\n'])('patches only prefixes and preserves formatting and all numbers (%j)', eol => {
    const text = ['### Projects', '**THZ = 123**', '==👩🏽‍💻 CAR = 005==', '### Bookmarks', '**IPM Proposal** ✔', 'car (ipm)', ''].join(eol);
    const summary = parseSummary(text, 'thejaz-summary.md');
    const result = summaryEmojiChanges(summary, { THZ: '🦉', CAR: '🚗' });
    expect(result.conflicts).toHaveLength(1);
    expect(applyPatches(text, result.patches)).toBe(text.replace('**THZ', '🦉 **THZ'));
    const forced = summaryEmojiChanges(summary, { THZ: '🦉', CAR: '🚗' }, new Set(['CAR']));
    expect(applyPatches(text, forced.patches)).toBe(text.replace('**THZ', '🦉 **THZ').replace('👩🏽‍💻', '🚗'));
  });
  it('accepts shared emojis and equivalent presentation, and remains idempotent', () => {
    const text = '### Projects\n☀ CAR = 1\n☀️ THZ = 2\n';
    expect(summaryEmojiChanges(parseSummary(text, ''), { CAR: '☀️', THZ: '☀️' })).toEqual({ patches: [], conflicts: [], issues: [] });
  });
  it('creates rows with complete emojis beyond the suggestion pool', () => {
    const text = '### Projects\n### Bookmarks\n';
    expect(applyPatches(text, newProjectPatch(parseSummary(text, ''), 'CAR', '🇮🇷', 0))).toContain('🇮🇷 CAR = 0');
  });
  it('keeps IPM out of defaults without changing CAR descriptions or credit', () => {
    expect(CODES).not.toContain('IPM');
    const text = '- [x] 10:00 (60) : car (ipm)\nCAR = 60\nSUM = 60\n';
    const day = parseDay(text, '2024-01-01.md', CODES);
    expect(calculate(day).projects).toEqual({ CAR: 60 }); expect(day.text).toBe(text);
  });
});

describe('one-emoji field', () => {
  it('replaces the previous emoji with a newly typed or picked one', () => {
    expect(singleEmoji('🦉🌱', 4, '🦉')).toEqual({ value: '🌱', refused: false });
    expect(singleEmoji('🌱🦉', 2, '🦉')).toEqual({ value: '🌱', refused: false });
  });
  it('keeps whole joined, flag and skin-tone emoji as one', () => {
    for (const emoji of ['👩‍💻', '🇮🇷', '👍🏽', '1️⃣']) expect(singleEmoji(emoji, emoji.length, '')).toEqual({ value: emoji, refused: false });
  });
  it('refuses ordinary text and keeps the previous emoji', () => {
    expect(singleEmoji('🦉a', 3, '🦉')).toEqual({ value: '🦉', refused: true });
    expect(singleEmoji('abc', 3, '')).toEqual({ value: '', refused: true });
  });
  it('takes the emoji from pasted text and allows blank for a random emoji', () => {
    expect(singleEmoji('my 🌱 project', 13, '')).toEqual({ value: '🌱', refused: true });
    expect(singleEmoji('', 0, '🦉')).toEqual({ value: '', refused: false });
  });
});
