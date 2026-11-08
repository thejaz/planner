import { describe, it, expect } from 'vitest';
import { correctPlans, correctionChoices } from '../src/core/plan-correction';
import { parseDay } from '../src/core/reader';
import { applyPatches, rebase } from '../src/core/changes';
const text = '## plan for 24 oct 26\n### morning\n- [x] 07:10 (n/a) : awake\n- [ ] 07:20 (10) : buffer\n- [ ] 07:35 (15) : bath\n- [ ] 05:03 (18) : iwbs\n- [ ] 05:23 (20) : breakfast\n- [ ] 05:35 (12) : preps\n- [ ] 06:30 (55) : hike\n- [ ] 06:50 (20) : recovery\n- [ ] 07:20 (30) : setup\n- [ ] ...\n\n000 : SUM\n';
describe('optional selected-plan correction', () => {
  it('rebuilds six end times from the unselected 07:35 anchor and preserves every other byte', () => {
    const day = parseDay(text,'2026-10-24.md'),result=correctPlans(day,day.entries.slice(3,9),'times');
    expect(result.anchors).toEqual([{time:'07:35',label:'bath'}]);
    expect(result.change.patches.map(p=>p.after)).toEqual([
      '- [ ] 07:53 (18) : iwbs','- [ ] 08:13 (20) : breakfast','- [ ] 08:25 (12) : preps',
      '- [ ] 09:20 (55) : hike','- [ ] 09:40 (20) : recovery','- [ ] 10:10 (30) : setup'
    ]);
    const after=applyPatches(text,result.change.patches);
    expect(after.slice(0,after.indexOf('- [ ] 07:53'))).toBe(text.slice(0,text.indexOf('- [ ] 05:03')));
    expect(after.slice(after.indexOf('- [ ] ...'))).toBe(text.slice(text.indexOf('- [ ] ...')));
    const corrected = parseDay(after,day.path);
    expect(correctPlans(corrected,corrected.entries.slice(3,9),'times').change.patches).toEqual([]);
  });
  it('is disabled when every offered option is a no-op', () => {
    const day=parseDay('- [x] 07:35 (n/a) : bath\n- [ ] 07:53 (18) : iwbs\n','d.md');
    expect(correctionChoices(day,[day.entries[1]!]).every(c=>c.preview?.change.patches.length===0)).toBe(true);
    const intentional = parseDay('- [x] 07:35 (n/a) : bath\n- [ ] 07:53 (10/18) : chp\n','d.md');
    expect(correctionChoices(intentional,[intentional.entries[1]!]).every(c=>c.preview?.change.patches.length===0)).toBe(true);
  });
  it('offers explicit duration matching or preserving credit with an elapsed suffix', () => {
    const day=parseDay('- [x] 07:35 (n/a) : bath\n- [ ] 07:53 (10) : chp\n- [ ] 08:13 (5-5) : chp-mdr\n- [ ] 08:20 (7) : next\n','d.md');
    const rows=day.entries.slice(1,3);
    expect(correctPlans(day,rows,'durations').change.patches.map(p=>p.after)).toEqual(['- [ ] 07:53 (18) : chp','- [ ] 08:13 (5-5/20) : chp-mdr']);
    expect(correctPlans(day,rows,'elapsed').change.patches.map(p=>p.after)).toEqual(['- [ ] 07:53 (10/18) : chp','- [ ] 08:13 (5-5/20) : chp-mdr']);
    expect(correctPlans(day,rows,'elapsed').change.patches.some(p=>p.before.includes('next'))).toBe(false);
  });
  it('uses slash elapsed duration for end-time rebuilding while preserving split credit', () => {
    const day=parseDay('- [ ] 09:00 (n/a) : anchor\n- [ ] 08:00 (20-10/45) : chp-mdr\n','d.md');
    expect(correctPlans(day,[day.entries[1]!],'times').change.patches[0]!.after).toBe('- [ ] 09:45 (20-10/45) : chp-mdr');
  });
  it('uses each unselected predecessor for separate selected blocks', () => {
    const day=parseDay('- [ ] 08:00 (n/a) : first\n- [ ] 07:00 (10) : alpha\n- [ ] 10:00 (n/a) : separate\n- [ ] 09:00 (20) : beta\n','d.md');
    const result=correctPlans(day,[day.entries[1]!,day.entries[3]!],'times');
    expect(result.anchors.map(a=>a.time)).toEqual(['08:00','10:00']);
    expect(result.change.patches.map(p=>p.after)).toEqual(['- [ ] 08:10 (10) : alpha','- [ ] 10:20 (20) : beta']);
  });
  it('preserves literal zero, duration padding, annotations and CRLF', () => {
    const raw='- [x] 09:00 (n/a) : anchor\r\n- [ ] 08:00 ( 0 ) : note 08:00 (0)\r\n';
    const day=parseDay(raw,'d.md'),next=applyPatches(raw,correctPlans(day,[day.entries[1]!],'times').change.patches);
    expect(next).toBe('- [x] 09:00 (n/a) : anchor\r\n- [ ] 09:00 ( 0 ) : note 08:00 (0)\r\n');
  });
  it('supports midnight crossings', () => {
    const day=parseDay('- [x] 23:50 (n/a) : anchor\n- [ ] 22:00 (20) : first\n- [ ] 22:10 (15) : next\n','d.md');
    expect(correctPlans(day,day.entries.slice(1),'times').change.patches.map(p=>p.after)).toEqual(['- [ ] 00:10 (20) : first','- [ ] 00:25 (15) : next']);
  });
  it('blocks missing anchors, unknown durations and new boundary conflicts', () => {
    const day=parseDay('- [x] 09:00 (n/a) : anchor\n- [ ] 09:05 (60) : selected\n- [ ] 09:10 (5) : boundary\n','d.md');
    expect(()=>correctPlans(day,[day.entries[0]!],'times')).toThrow('previous');
    expect(()=>correctPlans(day,[day.entries[1]!],'times')).toThrow('unselected');
    const first=parseDay('- [ ] 08:00 (10) : first\n','d.md');expect(()=>correctPlans(first,first.entries,'times')).toThrow('previous');
    const unknown=parseDay('- [x] 09:00 (n/a) : anchor\n- [ ] 09:30 (?) : unknown\n','d.md');expect(()=>correctPlans(unknown,[unknown.entries[1]!],'times')).toThrow('numeric duration');
  });
  it('retains existing unrelated discrepancies and rejects stale anchors through source protection', () => {
    const day=parseDay(text,'d.md'),change=correctPlans(day,day.entries.slice(3,9),'times').change;
    expect(()=>rebase(change,text.replace('07:35','07:40'))).toThrow('changed');
    expect(()=>rebase(change,text+'unrelated change\n')).toThrow('changed');
  });
  it('anchors across section headings and blank lines', () => {
    const day=parseDay('## plan for 26 oct 26\n### afternoon\n- [x] 19:08 (8) : iwbs\n\n### evening\n- [ ] 19:22 (12) : dinner\n\nSUM = 0\n','d.md');
    expect(correctPlans(day,[day.entries[1]!],'durations').change.patches.map(p=>p.after)).toEqual(['- [ ] 19:22 (14) : dinner']);
    expect(correctPlans(day,[day.entries[1]!],'times').anchors).toEqual([{time:'19:08',label:'iwbs'}]);
  });
  it('corrects explicitly selected completed rows and keeps them checked', () => {
    const text='## plan for 26 oct 26\n### afternoon\n- [x] 19:08 (8) : iwbs\n\n### evening\n- [x] 19:22 (12) : dinner\n- [x] 19:40 (18) : walk\n\nSUM = 0\n';
    const day=parseDay(text,'d.md'),dinner=[day.entries[1]!];
    expect(correctionChoices(day,dinner).map(c=>c.preview?.change.patches.map(p=>p.after))).toEqual([['- [x] 19:20 (12) : dinner'],['- [x] 19:22 (14) : dinner'],['- [x] 19:22 (12/14) : dinner']]);
    expect(applyPatches(text,correctPlans(day,dinner,'durations').change.patches)).toBe(text.replace('(12) : dinner','(14) : dinner'));
  });
});
