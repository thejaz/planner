import {describe,expect,it} from 'vitest';
import {activityCompletion} from '../src/core/activity-completion';
import {DEFAULT_ACTIVITY_HELPERS,upgradedHelpers} from '../src/core/activity-helpers';
import {allocateCredits,resolvePercent,roundCredits} from '../src/core/entry-math';
import {applyPatches,compactActivity,compactEdit,editParts,quickEntry,unknownEndTime} from '../src/core/changes';
import {calculate,parseDay} from '../src/core/reader';
import {transferProject} from '../src/core/project-transfer';
import {removeProject} from '../src/core/project-removal';
const codes=['CHP','MDR'];
const day=parseDay('- [x] 10:00 (n/a) : awake\n- [x] 10:30 (30) : chp\n','2026-10-29.md',codes);
const quick=(input:string,options={})=>quickEntry(input,'log',day.entries[0],'12:00',codes,options);
describe('omitted activity',()=>{
  it.each(['10:30','10:30 30','30','30m','10:30;','10:30; 30;'])('uses activity for %s',input=>{
    const result=quick(input);expect(result.diagnostics).toEqual([]);expect(result.rows).toEqual(['- [x] 10:30 (30) : activity']);
  });
  it('handles now, multiline and editing without inserting or changing status',()=>{
    expect(quick('now').rows).toEqual(['- [x] 12:00 (120) : activity']);
    expect(quick('10:30\n15').rows).toEqual(['- [x] 10:30 (30) : activity','- [x] 10:45 (15) : activity']);
    const result=compactEdit(day,day.entries[1]!,'10:30 30','12:00',codes);
    expect(applyPatches(day.text,result.change.patches)).toContain('- [x] 10:30 (30) : activity');
    expect(quick('').rows).toEqual([]);
    expect(quick('10:30; 30; read chapter 2').rows[0]).toContain('read chapter 2');
  });
});
describe('preserving unknown-time edits',()=>{
  it.each(['?', '...'])('retains the fields of an unknown-time %s activity',label=>{
    const text=`- [x] 10:00 (n/a) : awake\n- [x] ? (30) : ${label}\n`;
    const day=parseDay(text,'d.md',codes),entry=day.entries[1]!;
    const input=compactActivity(entry);
    expect(input).toBe(`? 30 ${label}`);
    expect(editParts(input,entry)).toEqual({time:[0,1],minutes:[2,4],activity:[5,input.length],schedule:[0,4]});
    expect(compactEdit(day,entry,input,'12:00',codes,{roundCredits:true}).change.patches).toEqual([]);
    expect(applyPatches(text,compactEdit(day,entry,'? 30 buffer','12:00',codes).change.patches))
      .toBe(text.replace(`: ${label}\n`,': buffer\n'));
  });
  it.each(['x',' '])('preserves recorded amounts and status [%s] on name-only edits',checked=>{
    for(const duration of ['0','33','0-33/40','70/60','?','n/a']){
      const label=duration.includes('-')?'chp & mdr':'chp';
      const text=`- [x] 10:00 (n/a) : awake\n- [${checked}] ? (${duration}) : ${label}\n`;
      const day=parseDay(text,'d.md',codes),entry=day.entries[1]!;
      const next=label.replace('chp','buffer');
      // Incomplete checked project minutes remain subject to existing validation.
      if(checked==='x' && ['?','n/a'].includes(duration))continue;
      const edited=compactEdit(day,entry,`? ${duration} ${next}`,'12:00',codes,{roundCredits:true});
      expect(applyPatches(text,edited.change.patches)).toBe(text.replace(`: ${label}\n`,`: ${next}\n`));
      expect(unknownEndTime(edited.entry)).toBe(true);
    }
  });
  it('still rounds deliberate duration changes and rejects calculation without a known endpoint',()=>{
    const day=parseDay('- [ ] ? (30) : chp\n','d.md',codes),entry=day.entries[0]!;
    expect(compactEdit(day,entry,'? 33 chp','12:00',codes,{roundCredits:true,durationTouched:true}).entry.duration).toBe('30/33');
    expect(()=>compactEdit(day,entry,'? 0 chp','12:00',codes,{durationTouched:true})).toThrow('write the minutes');
    expect(quick('? 0 chp').diagnostics.join(' ')).toContain('write the minutes');
    expect(parseDay('- [ ] ?\n- [ ] ...\n','g.md',codes).entries.map(compactActivity)).toEqual(['?','...']);
  });
});

describe('Tab completion',()=>{
  const helpers=['break','buffer','free','free time'];
  it.each([
    ['10:30 30 br','10:30 30 break'],['30 bu','30 buffer'],['10:30; 30; fr','10:30; 30; free'],
    ['chp & bu','chp & buffer'],['10:15 15 free\n10:30 15 bu','10:15 15 free\n10:30 15 buffer'],
  ])('completes only the current component of %s',(input,expected)=>{
    expect(activityCompletion(input,input.length,input.length,helpers)).toMatchObject({text:expected,caret:expected.length});
  });
  it('leaves exact names, unknown names, selections and numeric fields alone',()=>{
    for(const input of ['break','unknown','10:30','30','bu ','chp (bu'])expect(activityCompletion(input,input.length,input.length,helpers)).toBeNull();
    expect(activityCompletion('bu',0,2,helpers)).toBeNull();
    expect(activityCompletion('10:30 30 break',3,3,helpers)).toBeNull();
    const input='br (at home) & chp';expect(activityCompletion(input,2,2,helpers)?.text).toBe('break (at home) & chp');
  });
  it('adds procrastination to defaults once while preserving custom/removable helpers',()=>{
    expect(DEFAULT_ACTIVITY_HELPERS).toContain('procrastination');
    const old=DEFAULT_ACTIVITY_HELPERS.slice(0,-1);expect(upgradedHelpers(old,false)).toEqual(DEFAULT_ACTIVITY_HELPERS);
    expect(upgradedHelpers(old,true)).toEqual(old);expect(upgradedHelpers(['custom'],false)).toEqual(['custom']);expect(upgradedHelpers([],false)).toEqual([]);
  });
});
describe('one bounded credit budget',()=>{
  it('rounds shares together, including half-minute ties and five-minute units',()=>{
    expect(resolvePercent('.5-.5/',1)).toBe('1-0/1');
    expect(resolvePercent('.9-.1/',5)).toBe('5-0/5');
    expect(resolvePercent('.9-.1/',18,true)).toBe('15-0/18');
    expect(roundCredits('8-8/16')).toBe('10-5/16');
    expect(roundCredits('33')).toBe('30');
    expect(roundCredits('70/60')).toBe('70/60');
    expect(resolvePercent('.9-.9/',20)).toBe('10-10/20');
  });
  it('keeps credit within the entered minutes and records the written block',()=>{
    expect(quick('10:13 chp',{roundTimes:true}).rows).toEqual(['- [x] 10:15 (13/15) : chp']);
    expect(quick('10:13 chp',{roundTimes:true,roundCredits:true}).rows).toEqual(['- [x] 10:15 (10/15) : chp']);
    expect(quick('17 chp',{roundCredits:true}).rows).toEqual(['- [x] 10:17 (15/17) : chp']);
    expect(quick('10:30 70/60 chp',{roundCredits:true}).rows[0]).toContain('(70/60)');
    expect(quick('10:13 .9-.1/ chp & mdr',{roundTimes:true,roundCredits:true}).rows[0]).toContain('(10-0/15)');
    const over=parseDay('- [x] 10:00 (n/a) : awake\n- [x] 10:30 (70/60) : chp\n','d.md',codes);
    expect(compactEdit(over,over.entries[1]!,'10:30 70/60 chp','12:00',codes,{roundCredits:true}).change.patches).toEqual([]);
  });
  it('keeps consecutive rows consistent with their rounded times, crediting no extra minutes',()=>{
    const start=parseDay('- [x] 10:00 (n/a) : start\n','x.md').entries[0];
    for(const options of [{roundTimes:true},{roundTimes:true,roundCredits:true}])for(const first of ['10:43','10:47','10:48','10:52']){
      const result=quickEntry(`${first} chp\n11:00 mdr`,'log',start,'12:00',codes,options);
      const saved=parseDay('- [x] 10:00 (n/a) : start\n'+result.rows.join('\n')+'\n','d.md',codes);
      // Each row's recorded elapsed time matches its times, so they add up to the hour.
      expect(saved.diagnostics.map(d=>d.code)).not.toContain('interval-difference');
      expect(saved.entries.slice(1).reduce((sum,e)=>sum+e.elapsed!,0)).toBe(60);
      // A rounded end time never credits minutes that were not entered.
      const firstCredit=Object.values(saved.entries[1]!.credits).reduce((a,b)=>a+b,0);
      expect(firstCredit).toBeLessThanOrEqual(Number(first.slice(3)));
    }
    expect(quickEntry('10:48 chp','log',start,'12:00',codes,{roundTimes:true}).rows).toEqual(['- [x] 10:50 (48/50) : chp']);
    expect(quickEntry('10:48 .5/ chp','log',start,'12:00',codes,{roundTimes:true}).rows).toEqual(['- [x] 10:50 (24/50) : chp']);
  });
  it('keeps a last ? as the activity and reads n/a as an unaccounted duration',()=>{
    const start=parseDay('- [x] 10:00 (n/a) : start\n','x.md').entries[0];
    expect(quickEntry('10:47 ?','plan',start,'12:00',codes).rows).toEqual(['- [ ] 10:47 (47) : ?']);
    expect(quickEntry('10:47 n/a','plan',start,'12:00',codes).rows).toEqual(['- [ ] 10:47 (n/a) : activity']);
    expect(quickEntry('10:47 n/a awake','plan',start,'12:00',codes).rows).toEqual(['- [ ] 10:47 (n/a) : awake']);
    // At the start of a day there is no previous end time to account for.
    expect(quickEntry('04:45 n/a','log',undefined,'12:00',codes).rows).toEqual(['- [x] 04:45 (n/a) : activity']);
    expect(quickEntry('10:47','plan',start,'12:00',codes).rows).toEqual(['- [ ] 10:47 (47) : activity']);
  });
  it('writes a gap when nothing is known',()=>{
    const start=parseDay('- [x] 10:00 (n/a) : start\n','x.md').entries[0];
    for(const input of ['?','? ? ?','?; ?; ?','...'])for(const mode of ['plan','log'] as const)
      expect(quickEntry(input,mode,start,'12:00',codes).rows).toEqual(['- [ ] ...']);
  });
  it('writes, reads and edits an unknown end time as ? (30) : prj',()=>{
    const start=parseDay('- [x] 10:00 (n/a) : start\n','x.md').entries[0];
    for(const input of ['? 30 chp','?; 30; chp'])expect(quickEntry(input,'log',start,'12:00',codes).rows).toEqual(['- [x] ? (30) : chp']);
    expect(quickEntry('? ? chp','plan',start,'12:00',codes).rows).toEqual(['- [ ] ? (?) : chp']);
    expect(quickEntry('?; 30; ?','plan',start,'12:00',codes).rows).toEqual(['- [ ] ? (30) : ?']);
    expect(quickEntry('? 20-10 chp & mdr','log',start,'12:00',codes).rows).toEqual(['- [x] ? (20-10) : chp & mdr']);
    // Its minutes cannot come from the clock.
    expect(quickEntry('? / chp','log',start,'12:00',codes).diagnostics.join(' ')).toContain('write the minutes');
    // Two fields keep ? as the minutes, as before.
    expect(quickEntry('? chp','plan',start,'12:00',codes).rows).toEqual([]);
    const text='- [x] 10:00 (n/a) : start\n- [x] ? (30) : chp\n- [x] 11:00 (30) : mdr\n';
    const day=parseDay(text,'d.md',codes),unknown=day.entries[1]!;
    expect(unknown.time).toBeNull();expect(unknown.credits).toEqual({CHP:30});
    // Unlike a gap or a bare ?, it keeps an end time (?) and minutes to show.
    expect(unknownEndTime(unknown)).toBe(true);
    expect(parseDay('- [ ] ...\n- [ ] ?\n','g.md',codes).entries.map(unknownEndTime)).toEqual([false,false]);
    // It breaks the chain like a gap; the next row keeps its written minutes.
    expect(day.entries[2]!.interval).toBeNull();expect(calculate(day).sum).toBe(60);expect(day.diagnostics).toEqual([]);
    expect(compactEdit(day,unknown,'? 30 chp','12:00',codes).change.patches).toEqual([]);
    expect(applyPatches(text,compactEdit(day,unknown,'? 45 chp','12:00',codes).change.patches)).toContain('- [x] ? (45) : chp');
    expect(applyPatches(text,compactEdit(day,unknown,'10:30 30 chp','12:00',codes).change.patches)).toContain('- [x] 10:30 (30) : chp');
  });
  it('renames and removes projects on rows with an unknown end time',()=>{
    const text='- [x] 09:00 (n/a) : awake\n- [x] ? (20-10/30) : chp & mdr\n\n---\nCHP = 20\nMDR = 10\nSUM = 30\n';
    const renamed=transferProject([{path:'2020-01-01.md',kind:'day',text}],'mdr','frm','rename',{projectCodes:['CHP','MDR'],projectGroups:[],projectEmojis:{}});
    expect(renamed.blockers).toEqual([]);
    expect(applyPatches(text,renamed.changes[0]!.patches)).toContain('- [x] ? (20-10/30) : chp & frm');
    const removed=removeProject([{path:'2020-01-01.md',text}],'MDR','delete',['CHP','MDR']);
    expect(removed.blockers).toEqual([]);
    expect(applyPatches(text,removed.changes[0]!.patches)).toContain('- [x] ? (20/30) : chp');
  });
  it('never allocates more than elapsed over many periods and fractions',()=>{
    for(let elapsed=0;elapsed<=180;elapsed++)for(const fractions of [[.9,.1],[.5,.5],[.333,.333,.334],[.2,.9],[.25,.25]])for(const rounded of [false,true]){
      const values=allocateCredits(fractions.map(n=>n*elapsed),elapsed,rounded);
      expect(values.reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(elapsed);
      expect(values.every(n=>Number.isInteger(n)&&n>=0&&(!rounded||n%5===0))).toBe(true);
    }
  });
  it('keeps the saved project sum within the recorded elapsed block',()=>{
    for(const elapsed of [1,2,5,8,13,18,47,59]){
      const result=quick(`.9-.1/${elapsed} chp & mdr`,{roundCredits:true});expect(result.diagnostics).toEqual([]);
      const saved=parseDay(result.rows[0]!,'d.md',codes);expect(calculate(saved).sum).toBeLessThanOrEqual(elapsed);
    }
  });
});
