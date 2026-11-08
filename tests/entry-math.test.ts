import { describe, expect, it } from 'vitest';
import { hasPercent, resolvePercent, roundClock, roundCredits } from '../src/core/entry-math';
import { compactEdit, entryFields, makeDay, quickEntry, requestsElapsed, shiftEntries } from '../src/core/changes';
import { activityHelpers, DEFAULT_ACTIVITY_HELPERS, matchHelpers, normalizeHelpers, parseHelperList } from '../src/core/activity-helpers';
import { interpretEntry } from '../src/core/interpret';
import { parseDay, userDisputed } from '../src/core/reader';

const codes = ['CHP', 'MDR'];
const start = parseDay('- [x] 10:00 (n/a) : start\n', 'x.md').entries[0];
const rows = (input: string, options = {}) => quickEntry(input, 'log', start, '12:00', codes, options);

describe('5-minute rounding', () => {
  it('rounds clock times to the nearest 5 minutes without leaving the day', () => {
    expect(['10:12', '10:13', '10:47', '00:02', '23:58'].map(roundClock)).toEqual(['10:10', '10:15', '10:45', '00:00', '23:55']);
    expect(roundClock('24:00')).toBe('24:00');
  });
  it('rounds credit amounts but keeps a recorded elapsed part and non-numeric durations', () => {
    expect(roundCredits('17')).toBe('15');
    expect(roundCredits('12-33/47')).toBe('10-35/47');
    expect(roundCredits('n/a')).toBe('n/a');
    expect(roundCredits('?')).toBe('?');
  });
  it('applies to new times and credits only when enabled', () => {
    expect(rows('10:47 chp').rows).toEqual(['- [x] 10:47 (47) : chp']);
    expect(rows('10:47 chp', { roundTimes: true }).rows).toEqual(['- [x] 10:45 (45) : chp']);
    expect(rows('10:47 33 chp', { roundCredits: true }).rows).toEqual(['- [x] 10:47 (30/33) : chp']);
    expect(rows('17 chp', { roundCredits: true }).rows).toEqual(['- [x] 10:17 (15/17) : chp']);
    expect(rows('12:58 >', { roundTimes: true }).rows).toEqual(['- [ ] 13:00 (n/a) : >']);
  });
  it('keeps the elapsed time when rounding changes credit taken from the end time', () => {
    for (const input of ['10:47 chp', '10:47 / chp', '10:47 0 chp', '10:47; chp'])
      expect(rows(input, { roundCredits: true }).rows).toEqual(['- [x] 10:47 (45/47) : chp']);
    const saved = parseDay(`- [x] 10:00 (n/a) : start\n${rows('10:47 chp', { roundCredits: true }).rows[0]}\n`, 'd.md', codes);
    expect(saved.diagnostics.map(d => d.code)).not.toContain('interval-difference');
    // Already on a 5-minute step needs no suffix; a rounded endpoint retains actual elapsed.
    expect(rows('10:45 chp', { roundCredits: true }).rows).toEqual(['- [x] 10:45 (45) : chp']);
    expect(rows('10:47 chp', { roundTimes: true, roundCredits: true }).rows).toEqual(['- [x] 10:45 (45) : chp']);
    // Typed durations retain their elapsed budget rather than rounding it upward.
    expect(rows('10:47 33 chp', { roundCredits: true }).rows).toEqual(['- [x] 10:47 (30/33) : chp']);
    expect(rows('10:47 32/ chp', { roundCredits: true }).rows).toEqual(['- [x] 10:47 (30/47) : chp']);
    expect(rows('10:02 chp', { roundCredits: true }).rows).toEqual(['- [x] 10:02 (0/2) : chp']);
  });
  it('never rounds an unchanged time or duration while editing', () => {
    const day = parseDay('- [x] 10:00 (n/a) : start\n- [x] 10:12 (12) : chp\n', 'd.md');
    const entry = day.entries[1]!, options = { roundTimes: true, roundCredits: true };
    expect(compactEdit(day, entry, '10:12 12 mdr', '12:00', codes, options).entry.raw).toBe('- [x] 10:12 (12) : mdr');
    expect(compactEdit(day, entry, '10:17 0 chp', '12:00', codes, { ...options, durationTouched: true }).entry.raw).toBe('- [x] 10:15 (15) : chp');
    expect(compactEdit(day, entry, '10:17 0 chp', '12:00', codes, { roundCredits: true, durationTouched: true }).entry.raw).toBe('- [x] 10:17 (15/17) : chp');
  });
});

describe('percent credit', () => {
  it('recognises one decimal fraction and resolves it against elapsed or stated minutes', () => {
    expect(hasPercent('.25/')).toBe(true);
    expect(hasPercent('25/')).toBe(false);
    expect(requestsElapsed('.25/')).toBe(true);
    expect(requestsElapsed('.1/20')).toBe(false);
    expect(resolvePercent('.25/', 47)).toBe('12/47');
    expect(resolvePercent('0.5/', 60)).toBe('30/60');
    expect(resolvePercent('.25/', 47, true)).toBe('10/47');
  });
  it('saves ordinary minute credits from the end time or an explicit duration', () => {
    expect(rows('10:47 .25/ chp').rows).toEqual(['- [x] 10:47 (12/47) : chp']);
    expect(rows('10:47 .25/ chp', { roundTimes: true, roundCredits: true }).rows).toEqual(['- [x] 10:45 (10/45) : chp']);
    expect(rows('.1/20 chp').rows).toEqual(['- [x] 10:20 (2/20) : chp']);
    expect(rows('10:30 .1/20 chp').rows).toEqual(['- [x] 10:30 (2/20) : chp']);
    expect(rows('.5/60 chp').rows).toEqual(['- [x] 11:00 (30/60) : chp']);
  });
  it('gives each activity of a combined entry its own fraction, in order', () => {
    const shared = (input: string) => quickEntry(input, 'log', start, '12:00', ['PR1', 'PR2', 'PRJ', 'STD']);
    expect(shared('10:40 .25-.75/ pr1 & pr2').rows).toEqual(['- [x] 10:40 (10-30/40) : pr1 & pr2']);
    expect(shared('10:40; .5-.5/; pr1 & pr2').rows).toEqual(['- [x] 10:40 (20-20/40) : pr1 & pr2']);
    expect(shared('10:40 .5-.5/; pr1 & pr2').rows).toEqual(['- [x] 10:40 (20-20/40) : pr1 & pr2']);
    expect(shared('.5-.5/60 pr1 & pr2').rows).toEqual(['- [x] 11:00 (30-30/60) : pr1 & pr2']);
    expect(shared('10:40 20-.5/ prj & std').rows).toEqual(['- [x] 10:40 (20-20/40) : prj & std']);
    expect(resolvePercent('.1-.9/', 47)).toBe('5-42/47');
    expect(resolvePercent('.1-.9/', 47, true)).toBe('5-40/47');
  });
  it('needs exactly one amount per activity', () => {
    for (const input of ['11:00 .1-.1/ pln', '10:47 20-.5/ chp'])
      expect(rows(input).diagnostics.join(' ')).toContain('one fraction, such as .25/');
    expect(rows('10:47 .2-.3/ a & b & c').diagnostics.join(' ')).toContain('3 amounts');
  });
  it('explains when a fraction has no elapsed time to use', () => {
    expect(rows('10:47 .5 chp').diagnostics.join(' ')).toContain('Percent credit needs elapsed minutes');
    expect(rows('.5 chp').diagnostics.join(' ')).toContain('percent credit needs elapsed minutes');
    expect(rows('.5/ chp').diagnostics.join(' ')).toContain('need an end time');
  });
});

describe('semicolon fields', () => {
  it('reads time, minutes and activity by semicolons as well as by position', () => {
    expect(entryFields('14:30; 30; read two chapters')).toEqual({ time: '14:30', label: 'read two chapters', duration: '30', separated: true });
    expect(entryFields('30; prj')).toEqual({ time: undefined, label: 'prj', duration: '30', separated: true });
    expect(entryFields('14:30 30; prj')).toEqual({ time: '14:30', label: 'prj', duration: '30', separated: true });
    expect(entryFields('14:30; prj')).toEqual({ time: '14:30', label: 'prj', duration: undefined, separated: true });
    expect(entryFields('14:30 30 prj')).toEqual({ time: '14:30', label: 'prj', duration: '30', separated: false });
    expect(entryFields('a; b; c; d')).toBeNull();
    expect(entryFields('25:99x; 30; prj')).toBeNull();
    expect(entryFields('14:30; soon; prj')).toBeNull();
    // The earlier order is not read as minutes.
    expect(entryFields('14:30; prj; 30')).toBeNull();
  });
  it('saves the same rows, and lets a label contain digits', () => {
    expect(rows('10:47; 30; chp').rows).toEqual(rows('10:47 30 chp').rows);
    expect(rows('10:47; 30; read 2 chapters').rows).toEqual(['- [x] 10:47 (30) : read 2 chapters']);
    expect(rows('30; chp').rows).toEqual(['- [x] 10:30 (30) : chp']);
    expect(rows('10:47; chp').rows).toEqual(['- [x] 10:47 (47) : chp']);
    expect(rows('10:47; .25/; chp').rows).toEqual(['- [x] 10:47 (12/47) : chp']);
    // By position the number after the time is minutes; the rest is the name, digits included.
    expect(rows('10:47 30 read chapter 2').rows).toEqual(['- [x] 10:47 (30) : read chapter 2']);
    expect(rows('10:47 2 chapters').rows).toEqual(['- [x] 10:47 (2) : chapters']);
    // A trailing number without leading minutes is the earlier order; it is refused, not guessed.
    expect(rows('10:47 read chapter 2').diagnostics.join(' ')).toContain('put the minutes before the activity');
    expect(rows('10:47; read chapter 2').rows).toEqual(['- [x] 10:47 (47) : read chapter 2']);
  });
});

describe('activity helpers', () => {
  it('offers the configured lowercase names, then project codes, without repeats', () => {
    expect(DEFAULT_ACTIVITY_HELPERS).toEqual(['break', 'free', 'buffer', 'setup', 'awake', 'lunch', 'dinner', 'breakfast', 'procrastination']);
    expect(normalizeHelpers([' Lunch ', 'lunch', '', 'a;b', 42, 'walk'])).toEqual(['lunch', 'walk']);
    expect(normalizeHelpers(undefined)).toEqual(DEFAULT_ACTIVITY_HELPERS);
    expect(parseHelperList('break, Free ,, gym')).toEqual(['break', 'free', 'gym']);
    expect(activityHelpers(['break', 'prj'], ['PRJ', 'STD'])).toEqual(['break', 'prj', 'std']);
    expect(matchHelpers(['break', 'breakfast', 'lunch', 'outbreak'], 'brea')).toEqual(['break', 'breakfast', 'outbreak']);
  });
});

describe('generic defaults', () => {
  it('includes a new user’s own project codes in a minimal day', () => {
    expect(makeDay('2026-01-02', '', ['PRJ', 'GYM'])).toContain('PRJ = 0\nGYM = 0\n\nSUM = 0');
  });
});

describe('shift durations', () => {
  const text = '- [x] 09:00 (n/a) : start\n- [ ] 10:00 (60) : chp\n- [ ] 10:30 (20-10) : chp & mdr\n- [x] 11:00 (30) : done\n';
  const day = parseDay(text, 'd.md', codes);
  const apply = (mode: 'keep' | 'match' | 'elapsed') => {
    const change = shiftEntries(day, [day.entries[1]!], 15, mode);
    return change.patches.map(p => p.after);
  };
  it('keeps durations as written by default', () => {
    expect(apply('keep')).toEqual(['- [ ] 10:15 (60) : chp']);
  });
  it('matches minutes to the new elapsed time, including the following plan', () => {
    expect(apply('match')).toEqual(['- [ ] 10:15 (75) : chp', '- [ ] 10:30 (20-10/15) : chp & mdr']);
  });
  it('keeps credit and records the new elapsed time', () => {
    expect(apply('elapsed')).toEqual(['- [ ] 10:15 (60/75) : chp', '- [ ] 10:30 (20-10/15) : chp & mdr']);
  });
  it('never changes completed rows', () => {
    const later = shiftEntries(day, [day.entries[2]!], 10, 'match').patches.map(p => p.after);
    expect(later).toEqual(['- [ ] 10:40 (20-10/40) : chp & mdr']);
  });
});

describe('edit explanation', () => {
  it('states end time, elapsed time, project credit and completion', () => {
    const day = parseDay('- [x] 10:00 (n/a) : start\n- [x] 10:47 (5-42/47) : chp & mdr\n- [ ] 11:30 (n/a) : lunch\n', 'd.md', codes);
    expect(interpretEntry(day.entries[1]!, day.entries[0])).toEqual([
      'Ends 10:47: 47m after 10:00 (start).', 'Project credit: CHP 5m + MDR 42m = 47m.', 'Completed: 47m counts toward project totals.']);
    const recorded = parseDay('- [x] 10:00 (n/a) : start\n- [x] 10:45 (30/60) : chp\n', 'd.md', codes);
    expect(interpretEntry(recorded.entries[1]!, recorded.entries[0])).toContain('Recorded elapsed time: 60m.');
    expect(interpretEntry(day.entries[2]!, day.entries[1])).toEqual([
      'Ends 11:30: 43m after 10:47 (chp & mdr).', 'No project credit (n/a).', 'Planned: no project credit.']);
    expect(interpretEntry(day.entries[0]!, undefined)[0]).toBe('Ends 10:00. No previous end time, so elapsed time is unknown.');
  });
});

describe('footer lag versus recorded totals', () => {
  const codes = ['PLN'];
  const lagging = '- [x] 09:00 (n/a) : start\n- [x] 09:15 (15) : pln\n- [x] 09:30 (15) : pln\n\n---\nPLN = 15\nSUM = 15\n';
  it('lets totals follow the activities when the footer is the planner\u2019s own last write', () => {
    const day = parseDay(lagging, 'd.md', codes);
    expect(userDisputed(day, '- [x] 09:00 (n/a) : start\n- [x] 09:15 (15) : pln\n\n---\nPLN = 15\nSUM = 15\n', codes)).toBe(false);
  });
  it('preserves totals the user changed or without planner history', () => {
    const day = parseDay(lagging, 'd.md', codes);
    expect(userDisputed(day, '- [x] 09:15 (15) : pln\n\n---\nPLN = 10\nSUM = 10\n', codes)).toBe(true);
    expect(userDisputed(day, undefined, codes)).toBe(true);
    const blocked = parseDay('- [x] 09:00 (n/a) : start\n- [x] 08:30 (15) : pln\n\n---\nPLN = 0\nSUM = 0\n', 'd.md', codes);
    // A time conflict before an edit is not the user's dispute; the edit's result is checked separately.
    expect(userDisputed(blocked, blocked.text, codes)).toBe(false);
    expect(userDisputed(blocked, undefined, codes)).toBe(true);
    expect(userDisputed(parseDay('- [x] 09:15 (15) : pln\n\n---\nPLN = 15\nSUM = 15\n', 'd.md', codes), undefined, codes)).toBe(false);
  });
});
