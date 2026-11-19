// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {replaceDraft,isDraftReplacement} from '../src/ui/draft-replacement';
import {replaceActivityComponent} from '../src/core/activity-target';
const fixture=()=>{
 const doc=document;Reflect.deleteProperty(doc,'execCommand');Reflect.deleteProperty(doc,'queryCommandSupported');
 const input=doc.createElement('textarea');input.value='10:30 30 bu';doc.body.replaceChildren(input);
 input.setSelectionRange(11,11);
 return {doc,input,next:replaceActivityComponent(input.value,11,11,'buffer')};
};
describe('undoable replacement failure boundaries',()=>{
 it('refuses unsupported editing without changing text or selection',()=>{
  const {input,next}=fixture();expect(()=>replaceDraft(input,next)).toThrow('Undoable insertion is unavailable');
  expect(input.value).toBe('10:30 30 bu');expect(input.selectionStart).toBe(11);
 });
 it('refuses stale drafts before calling a browser edit',()=>{
  const {doc,input,next}=fixture();let calls=0;
  Object.assign(doc,{queryCommandSupported:()=>true,execCommand:()=>{calls++;return false;}});
  input.value='10:30 30 changed';expect(()=>replaceDraft(input,next)).toThrow('draft changed');expect(calls).toBe(0);
 });
 it('restores selection and clears its guard when the browser refuses a transaction',()=>{
  const {doc,input,next}=fixture();
  Object.assign(doc,{queryCommandSupported:()=>true,execCommand:()=>{expect(isDraftReplacement(input)).toBe(true);return false;}});
  expect(()=>replaceDraft(input,next)).toThrow('could not be inserted');expect(input.value).toBe('10:30 30 bu');
  expect(input.selectionStart).toBe(11);expect(input.selectionEnd).toBe(11);expect(isDraftReplacement(input)).toBe(false);
 });
 it('does not create an editing transaction for an unchanged suggestion',()=>{
  const {doc,input}=fixture();let calls=0;
  Object.assign(doc,{queryCommandSupported:()=>true,execCommand:()=>{calls++;return false;}});
  replaceDraft(input,replaceActivityComponent(input.value,11,11,'bu'));expect(calls).toBe(0);
 });
});
