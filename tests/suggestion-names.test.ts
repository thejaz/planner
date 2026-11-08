import {describe,it,expect} from 'vitest';
import {entryFields,quickEntry} from '../src/core/changes';
import {parseDay} from '../src/core/reader';
import {replaceActivityComponent} from '../src/core/activity-target';
import {activityCompletion} from '../src/core/activity-completion';
const previous=parseDay('- [x] 10:00 (n/a) : awake\n','d.md').entries[0];
describe('unambiguous configured names',()=>{
 it.each(['2 chapters','30','n/a','3d modeling','read chapter 2','2-chapters'])('preserves %s as a name in every schedule form',name=>{
  for(const [draft,time,duration] of [['',undefined,undefined],['10:30','10:30',undefined],['30',undefined,'30'],['10:30 30 bu','10:30','30'],['10:30; 30;','10:30','30'],['? 30 bu','?','30']] as const){
   const result=replaceActivityComponent(draft,draft.length,draft.length,name);
   expect(entryFields(result.text)).toMatchObject({label:name});
   expect(entryFields(result.text)?.time).toBe(time);expect(entryFields(result.text)?.duration).toBe(duration);
   const parsed=quickEntry(result.text,'plan',previous,'12:00',[]);expect(parsed.diagnostics).toEqual([]);
   const row=parseDay(parsed.rows[0]!,'d.md').entries[0]!;
   expect(row.label).toBe(name);expect(row.duration).toBe(draft===''?'40':'30');
   expect(draft.slice(0,result.from)+result.insert+draft.slice(result.to)).toBe(result.text);
   expect(result.caret).toBe(result.text.length);
  }
 });
 it('uses explicit fields only when compact input changes meaning',()=>{
  expect(replaceActivityComponent('10:30',5,5,'2 chapters').text).toBe('10:30; ; 2 chapters');
  expect(replaceActivityComponent('',0,0,'30').text).toBe('; ; 30');
  expect(replaceActivityComponent('10:30 30 bu',11,11,'2 chapters').text).toBe('10:30 30 2 chapters');
 });
 it('retains raw units, CRLF, other lines, components, context and explicit credits',()=>{
  const text='1h\r\n11:00 30 free\r\n';const result=replaceActivityComponent(text,2,2,'2 chapters');
  expect(result.text).toBe('; 1h; 2 chapters\r\n11:00 30 free\r\n');
  for(const amount of ['0','33','70/60','20-10/30']){
   const text=`? ${amount} chp & bu (home)`;const end=text.indexOf('bu')+2;
   const result=replaceActivityComponent(text,end,end,'2 chapters');
   expect(result.text).toBe(`? ${amount} chp & 2 chapters (home)`);
   expect(entryFields(result.text)?.duration).toBe(amount);
  }
 });
 it('Tab returns an atomic safe replacement and the correct visible suffix',()=>{
  const input='10:30 n',result=activityCompletion(input,input.length,input.length,['n/a'])!;
  expect(result.text).toBe('10:30; ; n/a');expect(result.suffix).toBe('/a');
  expect(input.slice(0,result.from)+result.insert+input.slice(result.to)).toBe(result.text);
  expect(entryFields(result.text)).toMatchObject({time:'10:30',label:'n/a'});
 });
});
