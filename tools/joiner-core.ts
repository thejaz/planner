// Offline migration only. This is deliberately not imported by the plugin.
import { activityPrefix, linesOf, minutes } from '../src/core/pre-ampersand/model';
import { parseDay } from '../src/core/pre-ampersand/reader';

const ROW = /^(\s*-\s+\[[ xX]\]\s*\d{1,2}:\d{1,2}\s*\()([^()]*)(\)\s*:?\s*)(.*)$/;
const EXTRA = /\(\+(\d+)\s+([a-z][a-z0-9]*)\)/ig;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const creditSignature = (credits: Record<string, number>) => Object.entries(credits).sort(([a], [b]) => a.localeCompare(b));

/** Parentheses are literal context, including nested parentheses and ampersands. */
export function activityHead(label: string): string {
  return label.split('(')[0]!.trimEnd();
}

/** Independent reference for the proposed grammar, NOT the installed parser. */
export function targetCredits(duration: string, label: string, codes: string[]): Record<string, number> {
  const head = activityHead(label), parts = head.split('&').map(p => p.trim());
  if (parts.length === 1) return parseDay(`- [x] 12:00 (${duration}) : ${label}`, '', codes).entries[0]!.credits;
  const known = new Set(codes.map(c => c.toUpperCase()));
  const values = duration.split('/')[0]!.split('-').map(minutes);
  const credits: Record<string, number> = {};
  if (!parts.some(p => known.has(p.toUpperCase()))) return credits;
  if (parts.some(p => !p) || values.some(v => v === null) || (values.length !== 1 && values.length !== parts.length))
    throw Error('Ambiguous allocation in target activity group');
  parts.forEach((part, i) => {
    if (known.has(part.toUpperCase())) credits[part.toUpperCase()] = (credits[part.toUpperCase()] ?? 0) + (values.length === 1 ? i === 0 ? values[0]! : 0 : values[i]!);
  });
  // Zero allocations do not create work, but remain comparable to old absent codes.
  return Object.fromEntries(Object.entries(credits).filter(([, value]) => value !== 0));
}
const nonzero = (credits: Record<string, number>) => creditSignature(Object.fromEntries(Object.entries(credits).filter(([, n]) => n !== 0)));

export interface JoinerPatch { line: number; before: string; after: string; extra: boolean }
export function migrateJoiner(text: string, codes: string[]) {
  const known = new Set(codes.map(c => c.toUpperCase()));
  const patches: JoinerPatch[] = [], issues: string[] = [], literals: string[] = [];
  const output = linesOf(text).map(line => {
    const row = ROW.exec(line.raw);
    if (!row) {
      if ([...line.raw.matchAll(EXTRA)].length) issues.push(`Line ${line.index + 1}: extra credit outside a supported activity row`);
      return line.raw + line.eol;
    }
    let duration = row[2]!, label = row[4]!;
    const before = parseDay(line.raw, '', codes).entries[0]!;
    const extras = [...label.matchAll(EXTRA)];
    if (extras.length) {
      const extra = extras[0]!;
      const base = label.slice(0, extra.index).trimEnd();
      if (extras.length !== 1 || label.slice(extra.index! + extra[0].length).trim() || !/^[a-z][a-z0-9]*$/i.test(base) || !known.has(extra[2]!.toUpperCase())) {
        issues.push(`Line ${line.index + 1}: unsupported extra-credit shape; needs explicit allocation`);
        return line.raw + line.eol;
      }
      const fields = duration.split('/'), value = minutes(fields[0]!), added = Number(extra[1]);
      if (value === null || fields.length > 2 || before.unknownCredit || before.elapsed === null) {
        issues.push(`Line ${line.index + 1}: unreadable extra-credit duration`);
        return line.raw + line.eol;
      }
      // Registered base credit stays intact. Ordinary base partitions elapsed,
      // as explicitly approved for free (+30 chp), never adds to its elapsed.
      const first = known.has(base.toUpperCase()) ? value : before.elapsed - added;
      if (first < 0) {
        issues.push(`Line ${line.index + 1}: extra credit exceeds the ordinary block`);
        return line.raw + line.eol;
      }
      duration = `${first}-${added}/${before.elapsed}`;
      label = `${base}-${extra[2]}${label.slice(extra.index! + extra[0].length)}`;
      const retired = parseDay(`${row[1]}${duration}${row[3]}${label}`, '', codes).entries[0]!;
      if (!equal(nonzero(before.credits), nonzero(retired.credits)) || before.elapsed !== retired.elapsed)
        throw Error(`Line ${line.index + 1}: retiring extra credit changed its meaning`);
    }
    const prefix = activityPrefix(label), parts = prefix.split(/\s*[-+|/]\s*/);
    if (parts.length > 1 && parts.some(p => known.has(p.toUpperCase()))) {
      if (before.unknownCredit) {
        issues.push(`Line ${line.index + 1}: existing project allocation is unreadable`);
        return line.raw + line.eol;
      }
      // Spaced historical slash with a single amount attributed its one project,
      // even if it appeared later. Require explicit review instead of reallocating.
      if (/\s\/\s/.test(prefix) && !duration.split('/')[0]!.includes('-')) {
        issues.push(`Line ${line.index + 1}: historical slash requires explicit allocation`);
        return line.raw + line.eol;
      }
      label = parts.join(' & ') + label.slice(prefix.length);
    } else if (parts.length > 1) literals.push(prefix);
    // Canonicalize existing joiners only outside context; retain authored words.
    const head = activityHead(label);
    if (head.includes('&')) label = head.replace(/\s*&\s*/g, ' & ') + label.slice(head.length);
    const after = `${row[1]}${duration}${row[3]}${label}`;
    if (after !== line.raw) {
      if (before.unknownCredit || !equal(nonzero(before.credits), nonzero(targetCredits(duration, label, codes))))
        throw Error(`Line ${line.index + 1}: project credit changed`);
      const elapsed = duration.includes('/') ? minutes(duration.split('/')[1]!) : duration.split('-').map(minutes).reduce<number | null>((sum, n) => sum === null || n === null ? null : sum + n, 0);
      if (before.elapsed !== elapsed) throw Error(`Line ${line.index + 1}: elapsed time changed`);
      patches.push({line: line.index + 1, before: line.raw, after, extra: extras.length > 0});
    } else if (head.includes('&') && !duration.split('/')[0]!.includes('-') && !equal(nonzero(before.credits), nonzero(targetCredits(duration, label, codes)))) {
      throw Error(`Line ${line.index + 1}: existing ampersand group would change project credit`);
    }
    return after + line.eol;
  }).join('');
  return {text: output, patches, issues, literals};
}
