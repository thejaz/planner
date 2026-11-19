import { describe, expect, it } from 'vitest';
import { migrateJoiner, targetCredits } from '../tools/joiner-core';
const codes = ['FRM', 'CHP', 'MDR', 'PLN'];
describe('offline ampersand migration', () => {
  it.each([
    ['45/120', 'frm (+15 chp)', '45-15/120', 'frm & chp'],
    ['260', 'free (+30 chp)', '230-30/260', 'free & chp'],
    ['170-40-20/315', 'chp-mdr-pln', '170-40-20/315', 'chp & mdr & pln'],
    ['0-30/40', 'free-chp (home & café)', '0-30/40', 'free & chp (home & café)'],
    ['0-0/40', 'frm-chp', '0-0/40', 'frm & chp'],
    ['10-20', 'FRM-CHP (client (A & B))', '10-20', 'FRM & CHP (client (A & B))'],
  ])('preserves allocations for %s %s', (duration, label, expected, group) => {
    const text = `## plan\r\n- [X] 00:00 (${duration}) : ${label}\r\nFRM = 45\r\nSUM = 60\r\nprose frm-chp\r\n`;
    const result = migrateJoiner(text, codes);
    expect(result.issues).toEqual([]);
    expect(result.text).toBe(text.replace(`(${duration}) : ${label}`, `(${expected}) : ${group}`));
    expect(migrateJoiner(result.text, codes).text).toBe(result.text);
  });
  it('preserves single-amount first-component attribution, ordinary names and context', () => {
    const text = '- [ ] 14:00 (30) : chp & lunch\n- [x] 15:00 (60) : free & chp\n- [x] 16:00 (60) : self-care\n- [x] 17:00 (60) : frm (A & B)';
    expect(migrateJoiner(text, codes).text).toBe(text);
    expect(targetCredits('60', 'free & chp', codes)).toEqual({});
    expect(targetCredits('30', 'chp & lunch', codes)).toEqual({CHP: 30});
  });
  it('normalizes only joiners outside parentheses and preserves no final newline', () => {
    expect(migrateJoiner('- [ ] 14:00 (30) : free&lunch (A&B)', codes).text).toBe('- [ ] 14:00 (30) : free & lunch (A&B)');
  });
  it.each([
    '- [x] 14:00 (?) : frm-chp',
    '- [x] 14:00 (20) : free (+30 chp)',
    '- [x] 14:00 (20) : frm (+10 xyz)',
    '- [x] 14:00 (20) : frm (+10 chp) (+10 mdr)',
    'prose (+10 chp)',
  ])('refuses ambiguous input: %s', text => {
    const result = migrateJoiner(text, codes);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.text).toBe(text);
  });
  it('handles copied routine rows in fences without changing fences or prose', () => {
    const text = '\uFEFF```markdown\n- [ ] 12:00 (10-20) : frm-chp\n```\n**Bookmarks**\nfrm-chp';
    expect(migrateJoiner(text, codes).text).toBe(text.replace(': frm-chp', ': frm & chp'));
  });
});
