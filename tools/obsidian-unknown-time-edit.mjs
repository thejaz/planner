// Synthetic regression for label-only edits on recorded unknown-time activities.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],file='2005-06-07.md';
let page,settings;
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 assert(page);await assertTestVault(page);
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 page.on('pageerror',e=>errors.push(e.message));
 settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));
 const input=page.locator('.planner-activity-editor textarea');
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 for(const checked of ['x',' '])for(const [duration,label,chip] of [['30','?',false],['33','chp',false],['30','chp',true],['0','chp',false]]) {
  const initial=`## plan for 7 jun 05\n### morning\n- [x] 10:00 (n/a) : awake\n- [${checked}] ? (${duration}) : ${label}\n- [ ] 11:00 (20) : free\n\nSUM = 0\n`;
  await page.evaluate(async({file,initial})=>{
   const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.whenIdle();
   c.settings.autoUpdate=false;c.settings.roundTimes=true;c.settings.roundCredits=true;
   const f=app.vault.getAbstractFileByPath(file);if(f)await app.vault.modify(f,initial);else await app.vault.create(file,initial);
   c.ingest(file,initial);const v=await p.open();v.switchMode('day');await v.navigate('2005-06-07');
  },{file,initial});
  const open=async()=>{await page.locator('.planner-row').nth(1).locator('.planner-label').dblclick();await input.waitFor();};
  await open();assert.equal(await input.inputValue(),`? ${duration} ${label}`);
  assert.equal(await page.locator('.planner-activity-editor').count(),1);
  // Untouched saves and Cancel must leave every byte as written.
  await page.locator('.planner-edit-actions button.mod-cta').click();
  await page.locator('.planner-activity-editor').waitFor({state:'detached'});assert.equal(await raw(),initial);
  await open();await input.press('Escape');assert.equal(await raw(),initial);
  await open();
  if(chip)await page.locator('.planner-activity-editor .planner-suggestions button').filter({hasText:/^buffer$/i}).click();
  else await page.keyboard.insertText('buffer');
  assert.equal(await input.inputValue(),`? ${duration} buffer`);
  await input.press('Enter');await page.locator('.planner-activity-editor').waitFor({state:'detached'});
  const expected=initial.replace(`(${duration}) : ${label}\n`,`(${duration}) : buffer\n`);
  assert.equal(await raw(),expected);
  const state=await page.evaluate(file=>{
   const entries=app.plugins.plugins['thejaz-planner'].controller.days.get(file).entries;
   return {count:entries.length,time:entries[1].time,nextInterval:entries[2].interval,focus:document.activeElement?.classList.contains('planner-row')};
  },file);
  assert.deepEqual(state,{count:3,time:null,nextInterval:null,focus:true});
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),expected);
  checks.push(`[${checked}] ? (${duration}) : ${label}: ${chip?'helper':'typing'} preserves endpoint, minutes, position and completion; unchanged Save, Cancel, focus and exact Undo/Redo pass`);
 }
 assert.deepEqual(errors,[]);
 const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};
 await writeFile('artifacts/unknown-time-edit-native.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
} finally {
 if(page&&settings)await page.evaluate(settings=>Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings),settings).catch(()=>{});
 await browser.close();
}
