// Real typing verifies native draft history independently of persisted Planner history.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],file='2010-11-12.md';let page,settings;
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 assert(page);await assertTestVault(page);await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));
 page.on('pageerror',e=>errors.push(e.message));
 const initial='## plan for 12 nov 10\n### morning\n- [x] 10:00 (n/a) : awake\n- [x] 10:00 (0) : chp\n- [ ] 10:33 (33) : chp\n- [x] 11:33 (70/60) : chp\n\nCHP = 70\nSUM = 70\n';
 await page.evaluate(async({file,initial})=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.whenIdle();
  c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=false;
  c.settings.activityHelpers=['2 chapters','30','n/a','buffer','free'];
  const f=app.vault.getAbstractFileByPath(file);if(f)await app.vault.modify(f,initial);else await app.vault.create(file,initial);
  c.ingest(file,initial);const v=await p.open();v.switchMode('day');await v.navigate('2010-11-12');v.selected=0;v.paintSelection();v.updatePreview();v.focusEntry();
 },{file,initial});
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner'].controller.timers.size===0);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.whenIdle());
 await page.evaluate(async()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;await v.refresh();v.selected=0;v.paintSelection();v.updatePreview();v.focusEntry();});
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 const add=page.locator('textarea[data-planner-key="quick-entry"]');
 const addChips=page.locator('.planner-capture:not(.planner-activity-editor) .planner-suggestions');
 const chip=(host,name)=>host.locator('button').filter({hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')});
 const type=async(input,text)=>{await input.fill('');for(const [i,line] of text.split('\n').entries()){if(i)await input.press('Shift+Enter');await input.pressSequentially(line);}assert.equal(await input.inputValue(),text);};
 const range=async(input,start,end=start)=>{await input.focus();await input.evaluate((el,{start,end})=>{el.setSelectionRange(start,end);el.dispatchEvent(new Event('select'));},{start,end});};
 const undo=()=>page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());
 const redo=()=>page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());
 const journalCount=await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.length);
 for(const [before,name,expected,tab] of [
  ['10:30 30 bu','buffer','10:30 30 buffer',false],['10:30 30 bu','buffer','10:30 30 buffer',true],
  ['10:30','buffer','10:30 buffer',false],['10:30','2 chapters','10:30; ; 2 chapters',false],
  ['10:30 n','n/a','10:30; ; n/a',true]
 ]){
  await type(add,before);if(tab)await add.press('Tab');else await chip(addChips,name).click();assert.equal(await add.inputValue(),expected);
  await add.press('Control+z');assert.equal(await add.inputValue(),before);
  await add.press('Control+Shift+z');assert.equal(await add.inputValue(),expected);
  await add.press('Control+z');assert.equal(await add.inputValue(),before);
  await add.press('Control+z');assert.notEqual(await add.inputValue(),before);
  await add.press('Control+Shift+z');assert.equal(await add.inputValue(),before);
  await add.press('Control+y');assert.equal(await add.inputValue(),expected);assert.equal(await raw(),initial);
 }
 checks.push('Real typing, chip/Tab replacements, omitted names and semicolon conversion retain separate native Undo steps, earlier typing and both Redo keys');
 await type(add,'10:30 30 bu\n11:00 30 free');await range(add,11);await add.press('Tab');
 assert.equal(await add.inputValue(),'10:30 30 buffer\n11:00 30 free');await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 bu\n11:00 30 free');
 checks.push('Tab Undo preserves multiline content and restores the changed component only');
 await type(add,'10:30 30 bu');await chip(addChips,'buffer').click();await range(add,9,15);await chip(addChips,'free').click();
 await add.pressSequentially('!');assert.equal(await add.inputValue(),'10:30 30 free!');
 await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 free');
 await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 buffer');
 await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 bu');
 assert.equal(await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.length),journalCount);
 checks.push('Repeated chips and typing afterward undo independently without touching persistent Planner history');
 for(const [before,name,minutes] of [['','2 chapters',40],['10:30','2 chapters',30],['10:30','30',30],['10:30','n/a',30]]){
  await page.evaluate(async()=>{const c=app.plugins.plugins['thejaz-planner'].controller;await c.whenIdle();const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;await v.refresh();v.selected=0;v.paintSelection();v.updatePreview();v.focusEntry();});
  await type(add,before);await chip(addChips,name).click();
  assert((await page.locator('.planner-preview').innerText()).includes(`(${minutes}) : ${name}`));
  await add.press('Enter');await page.waitForFunction(file=>app.plugins.plugins['thejaz-planner'].controller.days.get(file)?.entries.length===5,file);
  await page.waitForFunction(()=>!app.workspace.getLeavesOfType('thejaz-planner')[0].view.submitting);
  const saved=await raw();assert(saved.includes(`(${minutes}) : ${name}`));await undo();assert.equal(await raw(),initial);await redo();assert.equal(await raw(),saved);await undo();assert.equal(await raw(),initial);
 }
 checks.push('Numeric-leading, numeric-only and duration-like names save with correct default/elapsed minutes; row count and exact persistent Undo/Redo pass');
 await page.evaluate(()=>app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
 await add.fill('');await add.press('Escape');
 await page.evaluate(()=>{const c=app.plugins.plugins['thejaz-planner'].controller;c.settings.roundTimes=true;c.settings.roundCredits=true;});
 const edit=page.locator('.planner-activity-editor textarea'),editChips=page.locator('.planner-activity-editor .planner-suggestions');
 const open=async i=>{
  await page.evaluate(async()=>{await app.plugins.plugins['thejaz-planner'].controller.whenIdle();await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh();});
  const row=page.locator('.planner-row').nth(i);await row.focus();await row.press('Enter');await edit.waitFor();
  const text=await edit.inputValue();await range(edit,text.lastIndexOf('chp'),text.length);
 };
 const finished=()=>page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));
 for(const [index,time,amount,name,tab] of [[1,'10:00','0','2 chapters',false],[2,'10:33','33','n/a',true],[3,'11:33','70/60','buffer',false]]){
  await open(index);const before=await edit.inputValue();
  if(tab){await range(edit,before.lastIndexOf('chp'),before.length);await edit.pressSequentially('n');await edit.press('Tab');}
  else await chip(editChips,name).click();
  const expected=`${time} ${amount} ${name}`;assert.equal(await edit.inputValue(),expected);
  await edit.press('Control+z');assert.equal(await edit.inputValue(),tab?`${time} ${amount} n`:before);
  await edit.press('Control+y');assert.equal(await edit.inputValue(),expected);
  await edit.press('Enter');await finished();const saved=await raw();assert(saved.includes(`${time} (${amount}) : ${name}`));await undo();assert.equal(await raw(),initial);await redo();assert.equal(await raw(),saved);await undo();assert.equal(await raw(),initial);
 }
 checks.push('Edit chip/Tab native history preserves literal zero, 33m and explicit 70/60 with both rounding settings on; Save replaces one row and persistent Undo/Redo is exact');
 await open(2);await type(edit,'10:33 33 bu');await edit.press('Tab');await edit.press('Control+z');assert.equal(await edit.inputValue(),'10:33 33 bu');
 await edit.press('Escape');await finished();assert.equal(await raw(),initial);
 checks.push('Real typing and Tab history in Edit remain local to the draft; Cancel writes nothing');
 await page.evaluate(()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;v.selected=0;v.paintSelection();v.updatePreview();v.focusEntry();});await type(add,'10:30 30 bu');
 await page.evaluate(()=>{globalThis.originalDraftCommand=document.execCommand;document.execCommand=()=>false;});
 await chip(addChips,'buffer').click();assert.equal(await add.inputValue(),'10:30 30 bu');
 assert((await page.locator('.planner-capture:not(.planner-activity-editor) .planner-error').first().innerText()).includes('Undo support'));
 await page.evaluate(()=>{document.execCommand=globalThis.originalDraftCommand;delete globalThis.originalDraftCommand;});
 checks.push('A refused browser transaction leaves text intact and shows a visible error');
 await type(add,'10:30 n');await add.press('Tab');
 for(const theme of ['theme-light','theme-dark']){await page.evaluate(theme=>{document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(theme);},theme);await page.locator('.planner-shell').evaluate(el=>{el.style.width='300px';el.style.maxWidth='100%';});assert(await page.locator('.planner-capture').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
 await page.locator('.planner-shell').evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('max-width');});
 checks.push('Serialized names, suggestions and feedback fit 300px in both themes');
 assert.equal(await raw(),initial);assert.deepEqual(errors,[]);
 const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};await writeFile('artifacts/suggestion-history-native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
 if(page)await page.evaluate(settings=>{if(globalThis.originalDraftCommand){document.execCommand=globalThis.originalDraftCommand;delete globalThis.originalDraftCommand;}if(settings)Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings);},settings).catch(()=>{});
 await browser.close();
}
