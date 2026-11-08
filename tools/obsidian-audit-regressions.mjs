import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');let page,settings;
const checks=[],errors=[],file='2012-03-04.md';
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));await assertTestVault(page);
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));page.on('pageerror',e=>errors.push(e.message));
 const initial='## plan for 4 mar 12\n### morning\n- [x] 10:00 (n/a) : awake\n- [x] 10:30 (0) : chp\n\nCHP = 0\nSUM = 0\n';
 await page.evaluate(async({file,initial})=>{
  const plugin=app.plugins.plugins['thejaz-planner'],c=plugin.controller;await c.whenIdle();c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=false;c.settings.activityHelpers=['3d modeling','read chapter 2','2-chapters','buffer'];
  await app.vault.create(file,initial);c.ingest(file,initial);const v=await plugin.open();v.switchMode('day');await v.navigate('2012-03-04');
 },{file,initial});
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner'].controller.timers.size===0);
 const focusAdd=()=>page.evaluate(()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;v.selected=0;v.paintSelection();v.updatePreview();v.focusEntry();});await focusAdd();
 const add=page.locator('textarea[data-planner-key="quick-entry"]'),chips=page.locator('.planner-capture:not(.planner-activity-editor) .planner-suggestions');
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 for(const name of ['3d modeling','read chapter 2','2-chapters']){
  await add.fill('10:30');await chips.locator('button').filter({hasText:new RegExp('^'+name+'$')}).click();
  assert.equal(await add.inputValue(),'10:30; ; '+name);assert.equal(await page.locator('.planner-preview-area .planner-error').count(),0);
  assert((await page.locator('.planner-preview').innerText()).includes('(30) : '+name));
 }
 checks.push('Names with leading attached digits, trailing numbers and hyphenated numbers use valid explicit fields and preserve elapsed minutes');
 await add.fill('');await add.press('Escape');
 const row=page.locator('.planner-row').nth(1);await row.focus();await row.press('Enter');const edit=page.locator('.planner-activity-editor textarea');await edit.waitFor();
 const original=await edit.inputValue();await edit.evaluate(el=>el.setSelectionRange(6,7));await edit.pressSequentially('1');await edit.press('Control+z');assert.equal(await edit.inputValue(),original);
 assert.equal(await page.evaluate(()=>app.workspace.getLeavesOfType('thejaz-planner')[0].view.activityEditor.dirty()),false);
 assert((await page.locator('.planner-edit-preview').innerText()).includes('CHP 0m'));
 await edit.press('Enter');await page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));assert.equal(await raw(),initial);
 checks.push('Undo back to the original literal zero clears edit intent; Save is byte-exact and credits no invented minutes');
 await row.focus();await row.press('Enter');await edit.waitFor();await edit.evaluate(el=>el.setSelectionRange(6,7));await edit.pressSequentially('0');
 assert((await page.locator('.planner-edit-preview').innerText()).includes('CHP 30m'));
 await page.locator('.planner-activity-editor .planner-suggestions button').filter({hasText:/^buffer$/}).click();await edit.press('Control+z');
 assert.equal(await edit.inputValue(),original);assert((await page.locator('.planner-edit-preview').innerText()).includes('CHP 30m'));
 await edit.press('Escape');await page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));assert.equal(await raw(),initial);
 checks.push('A deliberate same-text zero calculation request survives Undo of a subsequent suggestion, while Cancel preserves recorded zero');

 await row.focus();await row.press('Enter');await edit.waitFor();await edit.press('End');await edit.pressSequentially(' (home)');
 await edit.evaluate(el=>el.setSelectionRange(6,7));await edit.pressSequentially('1');await edit.press('Control+z');
 assert.equal(await edit.inputValue(),'10:30 0 chp (home)');assert((await page.locator('.planner-edit-preview').innerText()).includes('CHP 0m'));
 await edit.press('Enter');await page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));
 const annotated=initial.replace('10:30 (0) : chp','10:30 (0) : chp (home)');assert.equal(await raw(),annotated);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),annotated);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 checks.push('Undo of duration retains independent context edits and zero credit; saved context and persistent Undo/Redo are byte-exact');

 await focusAdd();await add.fill('');await add.pressSequentially('10:30 30 bu');await chips.locator('button').filter({hasText:/^buffer$/}).click();
 const identity=await add.evaluate(el=>{globalThis.auditDraftField=el;return el.value;});
 await page.evaluate(async()=>{await app.vault.create('2012-03-05.md','## plan for 5 mar 12\n### morning\n\nSUM = 0\n');});
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner'].controller.days.has('2012-03-05.md')&&app.workspace.getLeavesOfType('thejaz-planner')[0].view.refreshDeferred);
 assert(await add.evaluate(el=>el===globalThis.auditDraftField));assert.equal(await add.inputValue(),identity);
 await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 bu');await add.press('Control+y');assert.equal(await add.inputValue(),identity);
 await add.press('Escape');await page.waitForFunction(()=>!app.workspace.getLeavesOfType('thejaz-planner')[0].view.refreshDeferred);
 checks.push('Real background indexing preserves the active textarea and native Undo/Redo; collapsing flushes deferred refresh');
 // Start the read before focus enters the composer, then finish it after native typing.
 await page.locator('.planner-row').nth(0).focus();
 await page.evaluate(()=>{const c=app.plugins.plugins['thejaz-planner'].controller,v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;globalThis.auditOriginalGetDay=c.getDay;let release;const gate=new Promise(r=>release=r);globalThis.auditReleaseRead=release;c.getDay=async function(...args){await gate;return globalThis.auditOriginalGetDay.apply(c,args);};globalThis.auditRefresh=v.refresh();});
 await focusAdd();await add.fill('');await add.pressSequentially('10:30 30 bu');await chips.locator('button').filter({hasText:/^buffer$/}).click();
 await add.evaluate(el=>globalThis.auditDraftField=el);
 await page.evaluate(async()=>{globalThis.auditReleaseRead();await globalThis.auditRefresh;app.plugins.plugins['thejaz-planner'].controller.getDay=globalThis.auditOriginalGetDay;});
 assert(await add.evaluate(el=>el===globalThis.auditDraftField));await add.press('Control+z');assert.equal(await add.inputValue(),'10:30 30 bu');await add.press('Control+y');assert.equal(await add.inputValue(),'10:30 30 buffer');
 await add.press('Escape');await page.waitForFunction(()=>!app.workspace.getLeavesOfType('thejaz-planner')[0].view.refreshDeferred);
 checks.push('An already-running refresh rechecks composer focus after its read and preserves the same textarea and native history');
 // A changed anchor must still refuse a stale calculated insert while rendering is deferred.
 await focusAdd();await add.fill('30 buffer');
 await page.evaluate(async file=>{const f=app.vault.getAbstractFileByPath(file);await app.vault.modify(f,(await app.vault.read(f)).replace('10:00 (n/a)','10:01 (n/a)'));},file);
 await page.waitForFunction(file=>app.plugins.plugins['thejaz-planner'].controller.days.get(file).text.includes('10:01'),file);
 await add.press('Enter');await page.waitForFunction(()=>!app.workspace.getLeavesOfType('thejaz-planner')[0].view.submitting);
 assert.equal(await add.inputValue(),'30 buffer');assert.equal((await raw()).split('\n').filter(l=>l.startsWith('- [')).length,2);
 checks.push('Deferred rendering retains stale-anchor write protection and leaves a failed insertion draft available');
 assert.deepEqual(errors,[]);const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};
 await writeFile('artifacts/audit-regressions-native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {if(page)await page.evaluate(settings=>{if(globalThis.auditOriginalGetDay)app.plugins.plugins['thejaz-planner'].controller.getDay=globalThis.auditOriginalGetDay;delete globalThis.auditOriginalGetDay;delete globalThis.auditReleaseRead;delete globalThis.auditRefresh;delete globalThis.auditDraftField;if(settings)Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings);},settings).catch(()=>{});await browser.close();}
