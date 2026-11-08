import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
let page,settings;const checks=[],errors=[],file='2016-06-08.md';
const initial='## plan for 8 jun 16\n### morning\n- [x] 10:00 (n/a) : awake\n- [x] 10:30 (0) : chp\n- [x] 11:03 (33) : chp\n- [x] 12:03 (70/60) : chp\n- [x] 12:36 (15-18/33) : chp & mdr\n- [ ] 13:06 (0) : chp\n\nCHP = 118\nMDR = 18\nSUM = 136\n';
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));await assertTestVault(page);
 page.on('pageerror',e=>errors.push(e.message));settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));
 await page.evaluate(async({file,initial})=>{const plugin=app.plugins.plugins['thejaz-planner'],c=plugin.controller;await c.whenIdle();c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=true;c.settings.activityHelpers=['buffer'];await app.vault.create(file,initial);c.ingest(file,initial);const v=await plugin.open();v.switchMode('day');await v.navigate('2016-06-08');},{file,initial});
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner'].controller.timers.size===0);
 const input=page.locator('.planner-activity-editor textarea');
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 const finished=()=>page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));
 const open=async index=>{await page.evaluate(async()=>{await app.plugins.plugins['thejaz-planner'].controller.whenIdle();await app.workspace.getLeavesOfType('thejaz-planner')[0].view.refresh();});const row=page.locator('.planner-row').nth(index);await row.focus();await row.press('Enter');await input.waitFor();};
 for(const index of [1,2,3,4,5]){
  await open(index);const before=await input.inputValue(),preview=await page.locator('.planner-edit-preview').innerText();const end=before.indexOf(' ',6);
  await input.evaluate((el,end)=>el.setSelectionRange(end,end),end);await input.press('Space');
  assert.equal(await page.locator('.planner-edit-preview').innerText(),preview);
  await input.press('Control+z');assert.equal(await input.inputValue(),before);await input.press('Control+y');assert.equal(await input.inputValue(),before.slice(0,end)+' '+before.slice(end));
  assert.equal(await page.locator('.planner-edit-preview').innerText(),preview);assert.equal(await raw(),initial);
  await input.press('Enter');await finished();assert.equal(await raw(),initial);
  await open(index);await input.evaluate(el=>el.setSelectionRange(6,6));await input.press('Space');await input.press('End');await input.pressSequentially(' (home)');
  assert.equal(await raw(),initial);await input.press('Enter');await finished();
  const target=initial.split('\n').filter(l=>l.startsWith('- ['))[index],annotated=initial.replace(target,target+' (home)');assert.equal(await raw(),annotated);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),annotated);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
  checks.push(`Row ${index}: boundary spaces, draft Undo/Redo, unchanged save, context-only save and exact persistent Undo/Redo preserve minutes/status/count`);
 }
 await open(1);await input.evaluate(el=>el.setSelectionRange(6,7));await input.pressSequentially('0');assert((await page.locator('.planner-edit-preview').innerText()).includes('CHP 30m'));await input.press('Escape');await finished();assert.equal(await raw(),initial);
 checks.push('Deliberate same-text zero replacement still requests elapsed calculation; Cancel preserves note');
 await open(1);await input.evaluate(el=>{el.setSelectionRange(6,7);el.addEventListener('beforeinput',e=>e.preventDefault(),{once:true});});await input.pressSequentially('0');assert.equal(await input.inputValue(),'10:30 0 chp');
 await input.press('Enter');await finished();assert.equal(await raw(),initial);
 checks.push('Canceled beforeinput does not mark recorded minutes as deliberately edited');
 await open(1);await input.evaluate(el=>{el.setSelectionRange(6,7);el.addEventListener('beforeinput',e=>e.preventDefault(),{once:true});});await input.pressSequentially('0');await input.evaluate(el=>el.setSelectionRange(8,11));
 await page.locator('.planner-activity-editor .planner-suggestions button').filter({hasText:/^buffer$/}).click();await input.press('Enter');await finished();assert.equal(await raw(),initial.replace('10:30 (0) : chp','10:30 (0) : buffer'));await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 checks.push('Canceled duration typing followed by a helper preserves literal zero');
 assert.deepEqual(errors,[]);const report={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};await writeFile('artifacts/duration-boundaries-native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(page&&settings)await page.evaluate(settings=>Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings),settings).catch(()=>{});await browser.close();}
