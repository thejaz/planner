import {describe,it,expect} from 'vitest';
import {EditDurationHistory,replacesDuration} from '../src/core/edit-duration-history';
describe('native duration intent history',()=>{
 it.each(['0','33','70/60'])('restores %s independently of retained context',amount=>{
  const initial=`10:30 ${amount} chp`,context=initial+' (home)',changed='10:30 1 chp (home)';
  const h=new EditDurationHistory(initial,amount);h.remember(context,false);h.remember(changed,true);
  expect(h.restore(context,'undo')).toBe(false);h.remember(context,false);
  expect(h.restore(changed,'redo')).toBe(true);
 });
 it('preserves a deliberate same-text zero request when undoing a later helper',()=>{
  const h=new EditDurationHistory('10:30 0 chp','0');h.remember('10:30 0 chp',true);h.remember('10:30 0 buffer',true);
  expect(h.restore('10:30 0 chp','undo')).toBe(true);
  expect(h.restore('10:30 0 chp','undo')).toBe(false);
  expect(h.restore('10:30 0 chp','redo')).toBe(true);
 });
 it('handles coalesced typing and discards abandoned redo states',()=>{
  const h=new EditDurationHistory('10:30 0 chp','0');h.remember('10:30 0 chp (h',false);h.remember('10:30 0 chp (home)',false);h.remember('10:30 1 chp (home)',true);
  expect(h.restore('10:30 0 chp','undo')).toBe(false);h.remember('10:30 0 mdr',false);
  expect(h.restore('10:30 0 chp','undo')).toBe(false);
  expect(h.restore('10:30 0 mdr','redo')).toBe(false);
 });
});

describe('duration replacement intent',()=>{
 it.each(['0','33','70/60','20-10/30'])('does not treat boundary whitespace as editing %s',amount=>{
  const text=`10:30 ${amount} chp`,end=6+amount.length;
  for(const caret of [0,5,6,end,end+1,text.length])
   expect(replacesDuration(text,caret,caret,' ')).toBe(false);
  expect(replacesDuration(text,end,end+1,' ')).toBe(false);
  expect(replacesDuration(text,6,end,'  ')).toBe(false);
  expect(replacesDuration(text,6,end,null)).toBe(false);
 });
 it.each(['10:30 0 chp','10:30; 0; chp','? 0 chp','?; 0; chp','0 chp'])('recognizes deliberate same-value replacement: %s',text=>{
  const at=text.indexOf('0',text.startsWith('10:30')?5:0);
  expect(replacesDuration(text,at,at+1,'0')).toBe(true);
  expect(replacesDuration(text,0,text.length,text)).toBe(false);
 });
 it('uses written unit amounts without matching digits in an activity',()=>{
  expect(replacesDuration('10:30 1h read 60',13,15,'60')).toBe(false);
  expect(replacesDuration('10:30 1h read 60',6,8,'1h')).toBe(true);
  expect(replacesDuration('10:30; 1h; read 60',7,9,'1h')).toBe(true);
 });
 it('does not confuse time or activity digits with the amount',()=>{
  expect(replacesDuration('10:30 30 read 30',0,5,'10:30')).toBe(false);
  expect(replacesDuration('10:30 30 read 30',9,16,'read 30')).toBe(false);
  expect(replacesDuration('bad',0,3,'0')).toBe(false);
 });
});
