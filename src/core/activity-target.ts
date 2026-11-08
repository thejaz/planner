import { entryFields, entryIssue } from './changes';
import { clockMinutes } from './model';

export interface ActivityTarget { from: number; to: number; query: string; prefix: string }
/** Locate a written name, never the synthetic default or schedule/context text. */
export function activityTarget(text: string, start: number, end: number): ActivityTarget {
  const fail = (message: string): never => { throw new Error(message); };
  if (start < 0 || end < start || end > text.length) return fail('Select one activity name.');
  const lineStart = text.slice(0, start).lastIndexOf('\n') + 1;
  let lineEnd = text.indexOf('\n', start); if (lineEnd < 0) lineEnd = text.length;
  if (text[lineEnd - 1] === '\r') lineEnd--;
  if (end > lineEnd) return fail('Select an activity name on one line.');
  const line = text.slice(lineStart, lineEnd), fields = entryFields(line);
  if (line.trim() && !fields) return fail('Check the end time and minutes before choosing an activity.');
  if (fields?.time && !['?', 'now'].includes(fields.time.toLowerCase()) && clockMinutes(fields.time) === null)
    return fail('Correct the end time before choosing an activity.');
  const written = fields ? line.lastIndexOf(fields.label) : -1;
  if (written < 0) {
    if (start !== end || start !== lineEnd) return fail('Place the caret after the time and minutes to add an activity.');
    return { from: lineEnd, to: lineEnd, query: '', prefix: line && !/\s$/.test(line) ? ' ' : '' };
  }
  const labelStart = lineStart + written;
  if (start < labelStart) return fail('Select the activity name, keeping its time and minutes unchanged.');
  let depth = 0, componentStart = labelStart, componentEnd = lineEnd, contextStart = -1;
  for (let i = labelStart; i < lineEnd; i++) {
    const char = text[i];
    if (char === '&' && depth === 0) {
      if (start <= i) { componentEnd = i; break; }
      componentStart = i + 1; contextStart = -1;
    } else if (char === '(') {
      if (depth === 0 && contextStart < 0) contextStart = i;
      depth++;
    } else if (char === ')') depth = Math.max(0, depth - 1);
  }
  if (end > componentEnd) return fail('Select only one activity component.');
  let from = componentStart, to = contextStart < 0 ? componentEnd : contextStart;
  while (from < to && /\s/.test(text[from]!)) from++;
  while (to > from && /\s/.test(text[to - 1]!)) to--;
  if (end > to) {
    if (start !== end && text.slice(to, end).trim()) return fail('Select the activity name outside its parentheses.');
    let contextDepth = 0;
    for (let i = to; i < start; i++) {
      if (text[i] === '(') contextDepth++;
      else if (text[i] === ')') contextDepth--;
      if (contextDepth < 0) return fail('Select the activity name outside its parentheses.');
    }
    if (contextDepth !== 0) return fail('Select the activity name outside its parentheses.');
  }
  if (from === to) from = to = contextStart < 0 ? componentEnd : from;
  return { from, to, query: start === end ? text.slice(from, to).trim() : '',
    prefix: from === to && from > lineStart && !/\s/.test(text[from - 1]!) ? ' ' : '' };
}

/** `fields` is true when the line had to be rewritten with semicolon fields to keep its meaning. */
/**
 * Edit opens with the end time and minutes selected. A selection lying only on them means
 * the activity name when the activity has a single part: returns that name's range (or the
 * end of the line when no name is written). Several parts are ambiguous: null.
 */
export function scheduleNameRange(text: string, start: number, end: number): [number, number] | null {
  if (start < 0 || end < start || end > text.length) return null;
  const lineStart = text.slice(0, start).lastIndexOf('\n') + 1;
  let lineEnd = text.indexOf('\n', start); if (lineEnd < 0) lineEnd = text.length;
  if (text[lineEnd - 1] === '\r') lineEnd--;
  if (end > lineEnd) return null;
  const line = text.slice(lineStart, lineEnd), fields = entryFields(line);
  if (!fields) return null;
  const written = line.lastIndexOf(fields.label);
  if (written < 0) return fields.time || fields.duration ? [lineEnd, lineEnd] : null;
  const labelStart = lineStart + written;
  if (end > labelStart || (!fields.time && !fields.duration)) return null;
  let depth = 0;
  for (let i = labelStart; i < lineEnd; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (text[i] === '&' && depth === 0) return null;
  }
  try { const target = activityTarget(text, lineEnd, lineEnd); return [target.from, target.to]; }
  catch { return null; }
}

export interface ActivityReplacement { text: string; caret: number; from: number; to: number; insert: string; fields?: boolean }
/** Preserve the parsed schedule/name meaning, adding explicit fields only when necessary. */
export function replaceActivityComponent(text: string, start: number, end: number, name: string): ActivityReplacement {
  if (!name.trim() || /[;\r\n]/.test(name)) throw new Error('Choose a single activity name without semicolons.');
  const target = activityTarget(text, start, end), insert = target.prefix + name;
  const lineStart = text.slice(0, start).lastIndexOf('\n') + 1;
  let lineEnd = text.indexOf('\n', start); if (lineEnd < 0) lineEnd = text.length;
  if (text[lineEnd - 1] === '\r') lineEnd--;
  const line = text.slice(lineStart, lineEnd), fields = entryFields(line);
  const written = fields ? line.lastIndexOf(fields.label) : -1;
  const labelStart = written < 0 ? lineEnd : lineStart + written;
  const label = text.slice(labelStart, target.from) + insert + text.slice(target.to, lineEnd);
  const keepsMeaning = (candidate: string) => {
    const parsed = entryFields(candidate);
    return !!parsed && (parsed.separated || (!entryIssue(candidate) && (parsed.duration !== undefined || !/^[.\d]|\s+[-+]?\d\S*\s*$/.test(parsed.label)))) && parsed.time === fields?.time && parsed.duration === fields?.duration && parsed.label === label.trim();
  };
  const compact = text.slice(lineStart, target.from) + insert + text.slice(target.to, lineEnd);
  if (keepsMeaning(compact)) return { text: text.slice(0, target.from) + insert + text.slice(target.to),
    caret: target.from + insert.length, from: target.from, to: target.to, insert };
  // Capture raw fields, including unit notation; the parser is unchanged.
  const leading = /^\s*/.exec(line)![0];
  let schedule = text.slice(lineStart + leading.length, labelStart).trimEnd();
  let time = '';
  if (fields?.time) { time = schedule.slice(0, fields.time.length); schedule = schedule.slice(time.length).trimStart(); }
  const prefix = `${leading}${time}; ${schedule}; `, labelText = label.trimStart();
  const explicit = prefix + labelText;
  if (!keepsMeaning(explicit)) throw new Error('This activity name cannot be inserted without changing the time or minutes. Use explicit fields.');
  const labelCaret = target.from - labelStart + insert.length - (label.length - labelText.length);
  return { text: text.slice(0, lineStart) + explicit + text.slice(lineEnd),
    caret: lineStart + prefix.length + labelCaret, from: lineStart, to: lineEnd, insert: explicit, fields: true };
}
