import {describe,it,expect} from 'vitest';
import {activityTarget,replaceActivityComponent,scheduleNameRange} from '../src/core/activity-target';
import {activityCompletion} from '../src/core/activity-completion';
import {parseDay,calculate} from '../src/core/reader';
import {interpretEntry} from '../src/core/interpret';
const helpers=['break','buffer','activity','free'];
const replace=(text:string,caret=text.length,name='buffer')=>replaceActivityComponent(text,caret,caret,name);
describe('shared activity targets',()=>{
 it.each(['','10:30','30','10:30; 30;','10:30; 30;  ','1h'])('offers unfiltered helpers for an omitted name: %s',text=>{
  expect(activityTarget(text,text.length,text.length).query).toBe('');
  expect(replace(text).text).toBe(text+(!text||/\s$/.test(text)?'':' ')+'buffer');
 });
 it('recognizes a literal activity name and preserves zero, spacing and explicit fields',()=>{
  expect(activityTarget('10:30 30 activity',16,16).query).toBe('activity');
  expect(replace('? 0 bu').text).toBe('? 0 buffer');
  expect(replace(' 10:30; 20 - 10 / 30; bu  ',22).text).toBe(' 10:30; 20 - 10 / 30; buffer  ');
 });
 it('uses only the current top-level component and keeps contexts and later components',()=>{
  const text='10:30 20-10 chp & bu (home & work) & free';
  const caret=text.indexOf('bu')+2;
  expect(activityTarget(text,caret,caret).query).toBe('bu');
  expect(replace(text,caret).text).toBe('10:30 20-10 chp & buffer (home & work) & free');
  expect(activityCompletion(text,caret,caret,helpers)?.text).toBe(replace(text,caret).text);
  expect(replace(text,text.indexOf(' & free')).text).toBe('10:30 20-10 chp & buffer (home & work) & free');
  expect(replace('10:30 20-10 chp & ').text).toBe('10:30 20-10 chp & buffer');
 });
 it('preserves malformed context while allowing its name to be replaced',()=>{
  expect(replace('chp (bad',3).text).toBe('buffer (bad');
  expect(()=>replace('chp (bad')).toThrow('outside its parentheses');
 });
 it('targets the caret line instead of the last line and preserves CRLF',()=>{
  const text='10:30 30 bu\r\n11:00 30 free\r\n';
  expect(replace(text,10).text).toBe('10:30 30 buffer\r\n11:00 30 free\r\n');
 });
 it.each(['10:30; 30; bad; extra','25:00 30 bu'])('refuses malformed schedule fields without guessing: %s',text=>{
  expect(()=>replace(text)).toThrow();
  expect(activityCompletion(text,text.length,text.length,helpers)).toBeNull();
 });
 it('rejects protected selections and context, but allows selecting one whole name',()=>{
  const text='10:30 20-10 chp & bu (home)';
  expect(()=>replaceActivityComponent(text,0,14,'buffer')).toThrow('time and minutes');
  expect(()=>replaceActivityComponent(text,12,19,'buffer')).toThrow('one activity component');
  expect(()=>replace(text,text.indexOf('home')+2)).toThrow('outside its parentheses');
  expect(()=>replaceActivityComponent('bu\nfree',0,4,'buffer')).toThrow('one line');
  expect(activityTarget('bu',0,2).query).toBe('');
  expect(replaceActivityComponent('bu',0,2,'buffer')).toMatchObject({text:'buffer',caret:6});
 });
 it('leaves exact names, missing names, no matches and unfinished prefixes to native Tab',()=>{
  for(const text of ['break','unknown','10:30','30','bu ','chp (bu'])
   expect(activityCompletion(text,text.length,text.length,helpers)).toBeNull();
  expect(activityCompletion('buffer',2,2,helpers)).toBeNull();
  expect(activityCompletion('bu',0,2,helpers)).toBeNull();
 });
});
describe('project-credit explanations',()=>{
 it.each(['x',' '])('ordinary [%s] activity never claims to earn project credit',checked=>{
  const day=parseDay(`- [${checked}] 10:30 (30) : break\n`,'d.md',['CHP']);
  expect(calculate(day).sum).toBe(0);
  expect(interpretEntry(day.entries[0]!,undefined)).toContain('Allocated time: 30m; no project credit.');
  expect(interpretEntry(day.entries[0]!,undefined).at(-1)).toBe(`${checked==='x'?'Completed':'Planned'}: no project credit.`);
 });
 it.each(['x',' '])('distinguishes known, zero, mixed and unknown credit [%s]',checked=>{
  for(const [duration,label,total] of [['10-20-30/60','chp & mdr & lunch',30],['0','chp',0],['?','chp',null]] as const){
   const day=parseDay(`- [${checked}] ? (${duration}) : ${label}\n`,'d.md',['CHP','MDR']);
   const lines=interpretEntry(day.entries[0]!,undefined);
   if(total===null)expect(lines).toContain('Project credit unknown. Enter minutes, or one amount per project such as 20-10.');
   else if(total===0)expect(lines.at(-1)).toContain('no project credit');
   else { expect(lines.join(' ')).toContain(`${checked==='x'?'Project credit':'Potential project credit'}: CHP 10m + MDR 20m = 30m.`);expect(checked==='x'?calculate(day).sum:calculate(day).plannedSum).toBe(total); }
  }
 });
});
describe('chips with the end time and minutes selected',()=>{
 it('target the single activity name, as when Edit opens',()=>{
  const cases:[string,number,number,string][]=[['10:20 20 buffer',0,8,'10:20 20 break'],['? 30 chp',0,4,'? 30 break'],['10:20 20 buffer (home)',0,8,'10:20 20 break (home)'],['10:20 20',0,8,'10:20 20 break']];
  for(const [text,start,end,expected] of cases){
   const range=scheduleNameRange(text,start,end);expect(range).not.toBeNull();
   expect(replaceActivityComponent(text,...range!,'break').text).toBe(expected);
  }
 });
 it('leave a selection inside the name, several parts and unreadable lines to the normal rules',()=>{
  expect(scheduleNameRange('10:20 20 chp & mdr',0,8)).toBeNull();
  expect(scheduleNameRange('10:20 20 buffer',9,15)).toBeNull();
  expect(scheduleNameRange('buffer',0,0)).toBeNull();
 });
});
describe('Tab completion that needs semicolon fields',()=>{
 it('marks the rewrite so the hint can say so',()=>{
  const plain=activityCompletion('10:20 20 bu',11,11,['buffer']);expect(plain?.fields).toBeFalsy();
  // In compact form `10:20 n/a` would read n/a as the minutes.
  const rewritten=activityCompletion('10:20 n',7,7,['n/a']);
  expect(rewritten).toMatchObject({text:'10:20; ; n/a',fields:true});
 });
});
