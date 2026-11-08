import {describe,it,expect} from 'vitest';
import {applyPatches,compactEdit,toggleEntry} from '../src/core/changes';
import {parseDay,calculate} from '../src/core/reader';
import {interpretEntry} from '../src/core/interpret';
import {replaceActivityComponent} from '../src/core/activity-target';
const replaceActivityLabel=(text:string,name:string)=>{const context=text.indexOf('('),caret=context<0?text.length:context;return replaceActivityComponent(text,caret,caret,name).text;};
const codes=['CHP','MDR'];
describe('activity review regressions',()=>{
 it('reports only project minutes in a mixed allocation total',()=>{
  const day=parseDay('- [x] 10:00 (n/a) : awake\n- [x] 11:00 (10-20-30/60) : chp & mdr & lunch\n','d.md',codes);
  expect(interpretEntry(day.entries[1]!,day.entries[0])).toContain('Project credit: CHP 10m + MDR 20m = 30m.');
  expect(calculate(day).sum).toBe(30);
 });
 it.each(['10:30 30 bu','? 30 bu','10:30; 30; bu'])('a helper repairs an invalid label while preserving schedule: %s',input=>{
  const draft=replaceActivityLabel(input,'buffer');
  const day=parseDay('- [ ] 10:00 (n/a) : awake\n- [ ] 10:30 (30) : free\n','d.md',codes);
  const entry=compactEdit(day,day.entries[1]!,draft,'12:00',codes).entry;
  expect(entry.duration).toBe('30');expect(entry.label).toBe('buffer');
  expect(entry.time).toBe(input.startsWith('?')?null:'10:30');
 });
 it('preserves unknown endpoints, zero, formatting and explicit fields in helpers',()=>{
  expect(replaceActivityLabel('? 0 chp','buffer')).toBe('? 0 buffer');
  expect(replaceActivityLabel(' 10:30; 20 - 10 / 30; chp & (bad  ','buffer')).toBe(' 10:30; 20 - 10 / 30; chp & buffer(bad  ');
  expect(replaceActivityLabel('10:30','buffer')).toBe('10:30 buffer');
  expect(replaceActivityLabel('10:30; 30;','buffer')).toBe('10:30; 30; buffer');
  expect(replaceActivityLabel('','buffer')).toBe('buffer');
  expect(()=>replaceActivityLabel('10:30; 30; bad; extra','buffer')).toThrow('Check the end time and minutes');
 });
 it('keeps gaps untoggleable without blocking unknown or regular activities',()=>{
  const text='- [ ] ...\n- [ ] ?\n- [ ] ? (30) : chp\n- [ ] 11:00 (30) : chp\n';
  const day=parseDay(text,'d.md',codes);
  expect(toggleEntry(day,day.entries[0]!).patches).toEqual([]);
  for(const entry of day.entries.slice(1))expect(applyPatches(text,toggleEntry(day,entry).patches)).toContain(entry.raw.replace('[ ]','[x]'));
 });
 it('distinguishes unknown endpoints, unknown activities and gaps',()=>{
  const day=parseDay('- [x] ? (30) : chp\n- [ ] ?\n- [ ] ...\n','d.md',codes);
  expect(interpretEntry(day.entries[0]!,undefined)).toContain('End time unknown; this row breaks the time chain.');
  expect(interpretEntry(day.entries[0]!,undefined)).toContain('Project credit: CHP 30m.');
  expect(interpretEntry(day.entries[1]!,undefined)[0]).toMatch(/^Unknown activity:/);
  expect(interpretEntry(day.entries[2]!,undefined)).toEqual(['Intentional gap: no credit; this row breaks the time chain.']);
 });
 it('keeps a timed gap as a known anchor without claiming it breaks the chain',()=>{
  const day=parseDay('- [ ] 10:00 (n/a) : ...\n- [ ] 10:30 (30) : buffer\n','d.md',codes);
  expect(interpretEntry(day.entries[0]!,undefined)).toEqual(['Ends 10:00. No previous end time, so elapsed time is unknown.','Intentional gap: no credit.']);
  expect(day.entries[1]!.interval).toBe(30);
 });
});
