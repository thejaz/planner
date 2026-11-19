import { linesOf } from './model';
import type { Change } from './model';
import { patch } from './changes';
import { COMBINATION_RULES } from './marker-combinations';
import { parseMarkerCriteria } from './marker-rules';

export function simplifyCombinationRules(text: string, path: string): Change {
  const criteria = parseMarkerCriteria(text, path);
  if (criteria.issues.length) throw new Error(`${path}: ${criteria.issues[0]!.message}`);
  const patches = [];
  for (const rule of criteria.combinations) {
    if (rule.kind !== 'exclusive' || !['context', 'productivity'].includes(rule.label)) continue;
    const line = linesOf(text)[rule.line]!;
    patches.push(patch(text, line.start, line.end, line.raw.replace(/\s*\|\s*(?:context|productivity)\s*$/i, '')));
  }
  const lines = linesOf(text), headings = new Set(criteria.combinations.map(rule => lines.filter(line => line.index < rule.line && /^#{1,6}\s+combination rules\s*$/i.test(line.raw)).at(-1)?.index));
  for (const line of lines) if (headings.has(line.index) && /^#{1,6}\s+Combination rules\s*$/.test(line.raw))
    patches.push(patch(text, line.start, line.end, line.raw.replace('Combination rules', 'combination rules')));
  return { path, base: text, patches, label: 'Simplify combination rule labels and heading' };
}

/** Explicit, insertion-only migration. Never used during indexing or startup. */
export function addCombinationRules(text: string, path: string): Change {
  const criteria = parseMarkerCriteria(text, path);
  if (criteria.issues.length) throw new Error(`${path}: ${criteria.issues[0]!.message}`);
  const lines = linesOf(text);
  const headings = lines.filter(line => /^(#{1,5})\s+criteria\s*&\s*markers\s*$/i.test(line.raw.replace(/^\uFEFF/, '')));
  if (headings.length !== 1) throw new Error(`${path}: expected one Criteria & Markers heading at level 1-5.`);
  const heading = headings[0]!, depth = heading.raw.replace(/^\uFEFF/, '').match(/^#+/)![0].length;
  const end = lines.find(line => {
    const match = /^(#{1,6})\s/.exec(line.raw);
    return line.index > heading.index && !!match && match[1]!.length <= depth;
  })?.index ?? lines.length;
  const section = lines.slice(heading.index + 1, end);
  if (section.some(line => /^#{1,6}\s+combination rules\s*$/i.test(line.raw))) {
    const canonical = parseMarkerCriteria(text.slice(heading.start, section.at(-1)?.fullEnd ?? text.length).split(/\n#{1,6}\s+Combination rules/i)[0] + '\n' + COMBINATION_RULES, path);
    const signature = (rules: typeof criteria.combinations) => JSON.stringify(rules.map(({line, ...rule}) => rule));
    if (signature(criteria.combinations) !== signature(canonical.combinations)) throw new Error(`${path}: existing custom combination rules require manual review; nothing was overwritten.`);
    return { path, base: text, patches: [], label: 'Add explicit combination rules' };
  }
  const last = section.filter(line => /^\s*-\s/.test(line.raw)).at(-1);
  if (!last) throw new Error(`${path}: no legend definitions to follow.`);
  const eol = heading.eol || '\n', body = COMBINATION_RULES.replace(/^####/, '#'.repeat(depth + 1)).replace(/\n/g, eol);
  const insert = last.fullEnd, addition = (last.eol ? eol : eol + eol) + body;
  return { path, base: text, patches: [patch(text, insert, insert, addition)], label: 'Add explicit combination rules' };
}
