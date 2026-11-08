import { activityGroup, DEFAULT_CODES, clockMinutes, dateFromPath, intervalBetween, linesOf, minutes } from './model';
import type { Day, Entry, Totals } from './model';
import { legacyActivity, legacyTotal } from './legacy';
import { MALFORMED_TOTAL, RETIRED_PLAN_HEADING, RETIRED_TOTAL, TOTAL, headingDate, planHeading, retiredRowIssue } from './syntax';

export function parseDay(text: string, path = '', codes: string[] = DEFAULT_CODES): Day {
  const lines = linesOf(text), known = new Set(codes.map(s => s.toUpperCase()));
  const day: Day = { text, path, date: dateFromPath(path), lines,
    eol: lines.find(l => l.eol)?.eol ?? '\n', entries: [], footers: [],
    recorded: {}, recordedSum: null, diagnostics: [], legacy: false, recordedOnly: false };
  let section = 'morning', fence = false, previous: number | null = null;
  const genericTotals: number[] = [];
  const diagnostic = (line: number, code: string, message: string, blocks = false, action = 'Open the note at this line to fix it.') => {
    day.diagnostics.push({ line, code, message, blocks, action, severity: blocks ? 'error' : 'warning' });
  };
  const recordedHeadings: number[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; continue; }
    if (!fence && /^##[ \t]+recorded totals(?:[ \t]+##)?[ \t]*$/i.test(line.raw)) recordedHeadings.push(line.index);
  }
  fence = false;
  day.recordedOnly = recordedHeadings.length > 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^###\s+(.+?)\s*$/.exec(line.raw);
    if (heading) section = heading[1]!;
    if (/^##\s+plan for\b/i.test(line.raw)) {
      // Headings never affect totals; they only need to name this day readably.
      const named = headingDate(line.raw);
      if (RETIRED_PLAN_HEADING.test(line.raw.trim()))
        diagnostic(line.index, 'retired-syntax', `Write this heading as ${day.date ? planHeading(day.date) : '## plan for 5 oct 26'}.`, false, 'Your numbers still count; update the line when convenient.');
      else if (day.date && named && named !== day.date)
        diagnostic(line.index, 'heading-date', `This heading says ${named}, but the note is for ${day.date}. Change it to ${planHeading(day.date)}.`, false);
      continue;
    }
    const clean = line.raw.replace(/\*\*/g, '').replace(/\[\^[^\]]+\]/g, '').trim();
    const total = TOTAL.exec(clean), retired = total ? null : RETIRED_TOTAL.exec(clean);
    const historicalTotal = total || retired ? null : legacyTotal(clean, known);
    let code: string | null = null, value: number | null = null, number: string | null = null;
    if (total) { code = total[1]!; value = +total[2]!; number = total[2]!; }
    else if (retired) {
      // Retired `030 : CODE`: still counted, but blocking until rewritten.
      code = retired[2]!.toUpperCase(); value = +retired[1]!; number = retired[1]!;
      diagnostic(line.index, 'retired-syntax', `Write this total as ${code} = ${value}.`, true, 'Your numbers still count; update the line when convenient.');
    } else if (historicalTotal) {
      code = historicalTotal.code; value = historicalTotal.value; day.legacy = true;
    }
    if (code !== null && value !== null) {
      if (!Number.isSafeInteger(value) || value < 0) {
        diagnostic(line.index, 'invalid-total', `The ${code} total is not a whole number of minutes.`, true,
          'Fix the number in the note; it was left as you wrote it.');
        continue;
      }
      if (code === 'SUM' ? day.recordedSum !== null : day.recorded[code] !== undefined)
        diagnostic(line.index, 'duplicate-total', `${code} has more than one total line. Keep one.`, true);
      if (code === 'SUM') day.recordedSum = value;
      else { day.recorded[code] = value; known.add(code); }
      const at = number === null ? -1 : total ? line.raw.lastIndexOf(number) : line.raw.indexOf(number);
      day.footers.push({ line: line.index, code, value, numberStart: at < 0 ? -1 : line.start + at,
        numberEnd: at < 0 ? -1 : line.start + at + number!.length });
      continue;
    }
    const sum = /^(?:Sum|Total(?: Study| Project| Work)? Time):\s*([\dhm\s]+)$/i.exec(clean);
    if (sum) {
      const m = minutes(sum[1]!);
      if (m !== null) {
        if (/^Sum:|^Total Time:/i.test(clean)) day.recordedSum = m;
        else genericTotals.push(m);
        day.legacy = true;
      } else diagnostic(line.index, 'invalid-total', 'This total line cannot be read.', true, 'Fix it in the note; it was left as you wrote it.');
      continue;
    }
    const uncertainFooter = /^-\s*\[/.test(clean) ? null : /^(.*?)\s*:\s*([A-Z][A-Z0-9]*)(?:\s+add)?$/i.exec(clean);
    const uncertainTotal = /^-\s*\[/.test(clean) ? null : MALFORMED_TOTAL.exec(clean);
    const uncertainOldFooter = /^(?:Total\s+)?([A-Z][A-Z0-9]*)(?:\s+Time)?\s*:\s*(.*?)$/i.exec(clean);
    const uncertainGeneric = /^(?:Sum|Total(?: Study| Project| Work)? Time):/i.test(clean);
    const uncertainCode = uncertainGeneric ? 'SUM' : uncertainTotal?.[1] ?? uncertainFooter?.[2]?.toUpperCase() ?? uncertainOldFooter?.[1]?.toUpperCase();
    if (uncertainCode && (known.has(uncertainCode) || uncertainCode === 'SUM' || (day.recordedOnly && /^[A-Z][A-Z0-9]*$/i.test(uncertainCode)))) {
      diagnostic(line.index, 'invalid-total', `This ${uncertainCode} total cannot be read.`, true,
        'Fix the number in the note; it was left as you wrote it.');
      continue;
    }
    const task = /^-\s+\[([ xX])\]\s*(.*)$/.exec(line.raw.trim());
    if (!task) continue;
    let time: string | null = null, startTime: string | null = null;
    let duration = '?', label = task[2]!, legacy = false;
    // The colon before the activity is optional when reading; writers always include it.
    // `? (30) : prj` is an activity whose end time is unknown; it breaks the time chain like a gap.
    const modern = /^(\d{1,2}:\d{1,2}|\?)\s*\(([^()]*)\)\s*:?\s*(.*)$/.exec(task[2]!);
    const historicalActivity = modern ? null : legacyActivity(task[2]!.replace(/\*\*/g, ''));
    if (modern) { time = modern[1] === '?' ? null : modern[1]!; duration = modern[2]!; label = modern[3]!; }
    else if (task[2]!.trim() === '...') { duration = 'n/a'; label = '...'; }
    else if (historicalActivity) {
      ({ startTime, time, duration, label } = historicalActivity); legacy = true;
    }
    const clock = time === null ? null : clockMinutes(time);
    let interval = intervalBetween(startTime ? clockMinutes(startTime) : previous, clock);
    // An explicit duration can disambiguate a long block crossing midnight.
    if (interval === null && previous !== null && clock !== null && clock < previous && /^\d+(?:\s*[-+|]\s*\d+)*(?:\s*\/\s*\d+)?$/.test(duration.trim())) {
      const pieces = duration.split('/');
      const elapsed = pieces.length === 2 ? minutes(pieces[1]!) : pieces[0]!.split(/[-+|]/).reduce((sum, value) => sum + (minutes(value) ?? NaN), 0);
      if (elapsed === clock + 1440 - previous) interval = elapsed;
    }
    if (time !== null && clock === null) diagnostic(line.index, 'invalid-time', `"${time}" is not a valid time. Use a 24-hour time such as 09:30.`, true);
    if (previous !== null && clock !== null && interval === null && !startTime)
      diagnostic(line.index, 'backward-time', 'This time is earlier than the activity before it, and the duration does not show it crossing midnight.', true);
    const retiredRow = modern ? retiredRowIssue(duration, label, true) : null;
    if (retiredRow) diagnostic(line.index, 'retired-syntax', retiredRow, true, 'Your numbers still count; update the line when convenient.');
    const entry: Entry = { line: line.index, raw: line.raw, checked: task[1]!.toLowerCase() === 'x',
      section, time, startTime, clock, interval, duration: duration.trim(), label,
      credits: {}, unknownCredit: false, elapsed: null, legacy };
    day.entries.push(entry);
    day.legacy ||= legacy;
    // Unknown anchors break the chain: the next known endpoint cannot bridge a gap.
    previous = clock;
  }
  if (day.recordedSum === null && genericTotals.length) day.recordedSum = genericTotals.reduce((a, b) => a + b, 0);
  for (const entry of day.entries) {
    const group = activityGroup(entry.label), names = group.units.map(unit => unit.name);
    const projectNames = names.map(s => s.toUpperCase());
    const projects = projectNames.filter(s => known.has(s));
    const expr = entry.duration;
    const slash = expr === 'n/a' ? [] : expr.split('/');
    const amount = slash[0]?.trim();
    const values = amount?.split(/\s*[-+|]\s*/).map(minutes) ?? [];
    entry.elapsed = slash.length === 2 ? minutes(slash[1]!) : values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value, 0) : null;
    // Preserve historical one-credit "prj / breakfast" notation. A single amount on an
    // `&` group credits its first component; explicit allocations map left to right.
    const mixedActivity = group.units.some(unit => /\s\/\s/.test(unit.joiner)) && projects.length === 1 && values.length === 1;
    const firstOnly = !mixedActivity && projectNames.length > 1 && values.length === 1;
    const hyphenated = hyphenatedProjects(names, known, values.length);
    if (group.issues.length) {
      // A malformed group blocks only when project credit depends on it.
      if (projects.length) entry.unknownCredit = true;
      diagnostic(entry.line, 'activity-group', group.issues[0]!, projects.length > 0 && entry.checked, 'Your other numbers are kept.');
    } else if (hyphenated) {
      entry.unknownCredit = true;
      diagnostic(entry.line, 'hyphen-joiner', `"${hyphenated}" reads as one activity, because a hyphen is part of a name, so it earns no credit.`, true,
        `Join activities with &: ${hyphenated.split('-').join(' & ')}.`);
    } else if (projects.length) {
      if ((!mixedActivity && !firstOnly && values.length !== projectNames.length) || values.some(v => v === null) || slash.length > 2 || (slash.length === 2 && entry.elapsed === null)) {
        entry.unknownCredit = true;
        diagnostic(entry.line, 'unknown-credit', 'The minutes for this activity are missing, unreadable, or do not match the number of projects named.', entry.checked,
          `Give one amount per part (${projectNames.join(', ')}), for example 60-210/270 for frm & party. Only registered projects count as work.`);
      } else {
        if (mixedActivity) entry.credits[projects[0]!] = values[0]!;
        else if (firstOnly) { if (known.has(projectNames[0]!)) entry.credits[projectNames[0]!] = values[0]!; }
        else projectNames.forEach((name, i) => {
          if (known.has(name)) entry.credits[name] = (entry.credits[name] ?? 0) + values[i]!;
        });
      }
    }
    if (['?', '>', '→', ''].includes(entry.label.trim()) || (expr === '?' && !projects.length && entry.label.trim() !== '...')) {
      entry.unknownCredit = true;
      diagnostic(entry.line, 'unknown-activity', 'It is unclear what this activity was or how many minutes it earns.', entry.checked, 'Name the activity and its minutes, or leave it unchecked.');
    }
    if (entry.interval !== null && entry.elapsed !== null && entry.interval !== entry.elapsed) {
      diagnostic(entry.line, 'interval-difference', `The written duration is ${entry.elapsed}m, but the clock times span ${entry.interval}m. Your written value is used.`,
        false, 'Nothing to do if that is intended; otherwise fix the duration.');
    }
    if (slash.length === 2 && entry.elapsed !== null && Object.values(entry.credits).reduce((a, b) => a + b, 0) > entry.elapsed)
      diagnostic(entry.line, 'credit-exceeds-elapsed', 'This activity credits more minutes than it lasted. Your numbers are kept.', false, 'Nothing to do if that is intended; otherwise fix the amounts.');
  }
  if (day.recordedOnly) {
    if (recordedHeadings.length > 1) diagnostic(recordedHeadings[1]!, 'duplicate-recorded-heading', 'This note has more than one ## recorded totals heading. Keep one.', true);
    if (day.entries.length) diagnostic(day.entries[0]!.line, 'mixed-recorded-day', 'A ## recorded totals note cannot also have activity checkboxes.', true,
      'Remove the checkboxes to keep it totals-only, or remove the ## recorded totals heading and log the full day. Your numbers are kept.');
    if (!Object.keys(day.recorded).length && day.recordedSum !== 0) diagnostic(recordedHeadings[0]!, 'missing-project-totals', 'Add the project totals in minutes, such as CHP = 60 (not needed when SUM = 0).', true);
    if (day.recordedSum === null) diagnostic(recordedHeadings[0]!, 'missing-recorded-sum', 'Add a SUM line equal to the project minutes, such as SUM = 120.', true);
    const sum = Object.values(day.recorded).reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(sum) || (day.recordedSum !== null && day.recordedSum !== sum))
      diagnostic(day.footers.find(f => f.code === 'SUM')?.line ?? recordedHeadings[0]!, 'recorded-sum-conflict',
        `SUM says ${day.recordedSum ?? '?'}m, but the project totals add up to ${sum}m.`, true,
        'Open the note and fix SUM or the project amounts. No activity times are needed.');
    return day;
  }
  const totals = calculate(day);
  for (const [code, recorded] of Object.entries(day.recorded)) {
    if (recorded !== (totals.projects[code] ?? 0))
      diagnostic(day.footers.find(f => f.code === code)?.line ?? 0, 'total-conflict',
        `${code}: the note says ${recorded}m, but completed activities add up to ${totals.projects[code] ?? 0}m.`, false, 'Your numbers are kept. Choose Compare totals to update them.');
  }
  if (day.recordedSum !== null && day.recordedSum !== totals.sum)
    diagnostic(day.footers.find(f => f.code === 'SUM')?.line ?? 0, day.legacy ? 'unallocated-history' : 'total-conflict',
      `SUM: the note says ${day.recordedSum}m, but completed activities add up to ${totals.sum}m.`, false, 'Your numbers are kept. Choose Compare totals to update them.');
  return day;
}

/**
 * A hyphenated name that still reads like the retired `-` joiner: every piece is a
 * registered project, or a piece is one and the minutes are split. `check-in` is not.
 */
export function hyphenatedProjects(names: string[], known: Set<string>, amounts: number): string | null {
  for (const name of names) {
    const pieces = name.toUpperCase().split('-');
    if (pieces.length > 1 && pieces.some(p => known.has(p)) && (pieces.every(p => known.has(p)) || amounts > 1)) return name;
  }
  return null;
}

export function calculate(day: Pick<Day, 'entries'>): Totals {
  const result: Totals = { projects: {}, sum: 0, planned: {}, plannedSum: 0, complete: true };
  for (const entry of day.entries) {
    if (entry.checked && entry.unknownCredit) result.complete = false;
    const target = entry.checked ? result.projects : result.planned;
    for (const [code, value] of Object.entries(entry.credits)) target[code] = (target[code] ?? 0) + value;
  }
  result.sum = Object.values(result.projects).reduce((a, b) => a + b, 0);
  result.plannedSum = Object.values(result.planned).reduce((a, b) => a + b, 0);
  return result;
}
export function disputed(day: Day): boolean {
  return day.diagnostics.some(d => d.blocks || d.code === 'total-conflict');
}
/** Footer values as `CODE=value` pairs, for comparing two versions of a day. */
export function footerSignature(day: Day): string { return day.footers.map(f => `${f.code}=${f.value}`).join(','); }
/**
 * Whether differing totals are the user's own recorded values. `plannerText` is the
 * note as of the planner's last write that set its footer. A footer still equal to
 * that one only lags behind the activities (for example after an update blocked by
 * a time error) and may follow them again; a footer the planner never set, or one
 * the user changed, is preserved. Callers still refuse writes while the result is blocked.
 */
export function userDisputed(day: Day, plannerText: string | undefined, codes?: string[]): boolean {
  if (!disputed(day)) return false;
  if (plannerText === undefined) return true;
  return footerSignature(parseDay(plannerText, day.path, codes)) !== footerSignature(day);
}
export function effectiveTotals(day: Day): { projects: Record<string, number>; sum: number | null; unallocated: number; complete: boolean } {
  if (day.recordedOnly) {
    const projectSum = Object.values(day.recorded).reduce((a, b) => a + b, 0);
    return { projects: { ...day.recorded }, sum: day.recordedSum,
      unallocated: day.recordedSum === null ? 0 : day.recordedSum - projectSum, complete: !disputed(day) };
  }
  const computed = calculate(day);
  if (day.diagnostics.some(d => d.code === 'invalid-total')) computed.complete = false;
  const projects = { ...computed.projects, ...day.recorded };
  const projectSum = Object.values(projects).reduce((a, b) => a + b, 0);
  const sum = day.recordedSum ?? (computed.complete ? projectSum : null);
  return { projects, sum, unallocated: sum === null ? 0 : sum - projectSum,
    complete: (computed.complete || day.recordedSum !== null) && !day.entries.some(entry => entry.checked && entry.unknownCredit) };
}
