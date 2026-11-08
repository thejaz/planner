// Synthetic interaction/storage regression for unnamed entries, Tab and bounded rounding.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
import {plannerUI} from './planner-ui.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],date='2004-04-05';
let page;
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 assert(page);await assertTestVault(page);page.on('pageerror',e=>errors.push(e.message));
 const ui=plannerUI(page);
 await page.evaluate(async date=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.whenIdle();
  globalThis.activityEntrySettings={...c.settings,activityHelpers:[...c.settings.activityHelpers]};
  c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=false;
  c.settings.activityHelpers.push('free time');
  const path=date+'.md',text='## plan for 5 apr 04\n### morning\n- [x] 10:00 (n/a) : awake\n- [ ] 10:20 (20) : buffer\n\nCHP = 0\nMDR = 0\nSUM = 0\n';
  const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.modify(f,text);else await app.vault.create(path,text);
  c.ingest(path,text);const v=await p.open();v.switchMode('day');v.entryMode='log';await v.navigate(date);
 },date);
 const raw=()=>page.evaluate(date=>app.plugins.plugins['thejaz-planner'].controller.port.read(date+'.md'),date);
 const initial=await raw();
 const open=async()=>page.evaluate(()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;v.selected=0;v.focusEntry();});
 const input=ui.getByRole('textbox',{name:'Quick entry',exact:true});
 await open();await input.fill('10:13 13 br');await input.press('Tab');assert.equal(await input.inputValue(),'10:13 13 break');assert.equal(await raw(),initial);
 await input.press('Tab');assert.equal(await input.evaluate(el=>el===el.ownerDocument.activeElement),false);
 await input.focus();await input.fill('10:13 13 unknown');await input.press('Tab');assert.equal(await input.inputValue(),'10:13 13 unknown');assert.equal(await input.evaluate(el=>el===el.ownerDocument.activeElement),false);
 await input.focus();await input.fill('10:13 13 bu');await input.press('Shift+Tab');assert.equal(await input.inputValue(),'10:13 13 bu');
 await input.focus();await input.fill('10:13 13 free t');await input.press('Tab');assert.equal(await input.inputValue(),'10:13 13 free time');
 checks.push('Tab completes a configured component without saving; exact/no-match Tab and Shift+Tab retain normal navigation');
 // The faint completion hint: the rest of the name after the caret and a small Tab key.
 const hint=()=>page.evaluate(()=>{
  const ghost=[...document.querySelectorAll('.planner-completion-ghost')].find(g=>g.offsetParent!==null);
  const field=document.activeElement;
  if(!ghost)return {shown:false,description:field?.getAttribute('aria-description')??null};
  const g=ghost.getBoundingClientRect(),f=field.getBoundingClientRect();
  return {shown:true,rest:ghost.querySelector('.planner-completion-rest')?.textContent,key:ghost.querySelector('.planner-completion-key')?.textContent,
   description:field.getAttribute('aria-description'),aligned:Math.abs(g.left-f.left)<1&&Math.abs(g.top-f.top)<1&&Math.abs(g.width-f.width)<1};
 });
 await open();await input.fill('10:13 13 br');
 assert.deepEqual(await hint(),{shown:true,rest:'eak',key:'Tab',description:'Tab completes break',aligned:true});
 await page.screenshot({path:'artifacts/tab-hint-quick.png'});
 await input.fill('chp & bu');assert.equal((await hint()).rest,'ffer');
 await input.fill('10:13 13 unknown');assert.deepEqual(await hint(),{shown:false,description:null});
 await input.fill('10:13 13 br');await input.press('Tab');assert.equal(await input.inputValue(),'10:13 13 break');
 await input.focus();assert.equal((await hint()).shown,false);
 await input.fill('10:13 13 br');await input.press('Home');assert.equal((await hint()).shown,false);
 assert.equal(await raw(),initial);
 checks.push('A faint remainder and a small Tab key show only while Tab would complete at the end of the line; the field describes it; nothing is saved');
 assert(await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.helpersFor().includes('procrastination')));
 checks.push('Default activity helpers include procrastination');
 for(const text of ['10:13','13','10:13; 13;']){
  await input.focus();await input.fill(text);assert((await page.locator('.planner-preview').first().innerText()).includes('(13) : activity'));
  await input.press('Enter');await page.waitForFunction(date=>app.plugins.plugins['thejaz-planner'].controller.days.get(date+'.md')?.entries.length===3,date);
  const saved=await raw();assert(saved.includes('- [x] 10:13 (13) : activity'));
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);await open();
 }
 checks.push('Time-only, duration-only and semicolon entries save activity exactly once; Undo restores exact original bytes');
 for(const text of ['?','?; ?; ?']){await input.focus();await input.fill(text);assert((await page.locator('.planner-preview').first().innerText()).includes('- [ ] ...'));}
 await input.fill('? 13 chp');assert((await page.locator('.planner-preview').first().innerText()).includes('- [x] ? (13) : chp'));
 await input.press('Enter');await page.waitForFunction(date=>app.plugins.plugins['thejaz-planner'].controller.days.get(date+'.md')?.entries.length===3,date);
 assert((await raw()).includes('- [x] ? (13) : chp'));
 const unknownRow=page.locator('.planner-row').nth(1);
 // The ? end time and the minutes are visible, not hidden like a gap's.
 for(const [cell,text] of [['.planner-time','?'],['.planner-duration','13'],['.planner-label','chp']]){const c=unknownRow.locator(cell);assert(await c.isVisible(),cell+' hidden');assert.equal((await c.innerText()).trim(),text);}
 assert.equal(await page.locator('.planner-row').filter({hasText:'...'}).count(),0);
 await unknownRow.focus();await unknownRow.press('Enter');
 const unknownEdit=ui.getByRole('textbox',{name:'Edit activity input',exact:true});assert.equal(await unknownEdit.inputValue(),'? 13 chp');
 await unknownEdit.press('Escape');await page.locator('.planner-activity-editor').waitFor({state:'detached'});
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);await open();
 checks.push('? and ?; ?; ? preview the gap ...; ? 13 chp saves ? (13) : chp, shows its ? and 13 minutes, opens in Edit as ? 13 chp, and Undo is exact');
 await input.fill('');await input.press('Escape');
 const edit=async()=>{const row=page.locator('.planner-row').nth(1);await row.focus();await row.press('Enter');return ui.getByRole('textbox',{name:'Edit activity input',exact:true});};
 let editing=await edit();await editing.fill('10:20 20 br');await editing.press('Tab');assert.equal(await editing.inputValue(),'10:20 20 break');assert.equal(await page.locator('.planner-activity-editor').count(),1);await editing.press('Escape');assert.equal(await raw(),initial);
 editing=await edit();await editing.fill('10:20 20 br');assert.equal((await hint()).rest,'eak');await page.screenshot({path:'artifacts/tab-hint-edit.png'});await editing.press('Tab');await editing.press('Enter');await page.locator('.planner-activity-editor').waitFor({state:'detached'});
 const edited=await raw();assert.equal(edited,initial.replace('(20) : buffer','(20) : break'));
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),edited);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 checks.push('Edit shares Tab completion; Cancel is read-only; Save preserves status and row count with exact Undo/Redo');
 await page.evaluate(()=>{const c=app.plugins.plugins['thejaz-planner'].controller;c.settings.roundTimes=true;c.settings.roundCredits=true;});await open();
 await input.fill('10:13 .9-.1/ chp & mdr');assert((await page.locator('.planner-preview').first().innerText()).includes('(10-0/15)'));
 await input.press('Enter');await page.waitForFunction(date=>app.plugins.plugins['thejaz-planner'].controller.days.get(date+'.md')?.entries.some(e=>e.duration==='10-0/15'),date);
 const bounded=await page.evaluate(date=>{const e=app.plugins.plugins['thejaz-planner'].controller.days.get(date+'.md').entries.find(e=>e.duration==='10-0/15');return {credit:Object.values(e.credits).reduce((a,b)=>a+b,0),elapsed:e.elapsed,time:e.time};},date);
 assert.deepEqual(bounded,{credit:10,elapsed:15,time:'10:15'});
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 checks.push('Rounded end time 10:15 and .9-.1/ save 10 credited minutes, within the 13 minutes entered, recorded against the written 15-minute block; Undo is exact');
 const viewport=page.viewportSize();await page.setViewportSize({width:700,height:800});await open();await input.fill('10:13 13 bu');await input.press('Tab');
 const layout=await page.locator('.planner').evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));assert(layout.content<=layout.width+1);
 await input.press('Escape');await page.setViewportSize(viewport??{width:1024,height:800});checks.push('Completion and help fit a narrow layout');
 assert.deepEqual(errors,[]);
 const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors,bounded};
 await writeFile('artifacts/activity-entry-native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
 if(page)await page.evaluate(()=>{const c=app.plugins.plugins['thejaz-planner'].controller;if(globalThis.activityEntrySettings){Object.assign(c.settings,globalThis.activityEntrySettings);delete globalThis.activityEntrySettings;}}).catch(()=>{});
 await browser.close();
}
