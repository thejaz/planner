// Synthetic checks for activity explanations, helper repair and disabled gap actions.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],file='2006-07-08.md';let page,settings;
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 assert(page);await assertTestVault(page);
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));
 page.on('pageerror',e=>errors.push(e.message));
 const initial='## plan for 8 jul 06\n### morning\n- [x] 10:00 (n/a) : awake\n- [x] 11:00 (10-20-30/60) : chp & mdr & lunch\n- [x] ? (30) : chp\n- [ ] ...\n- [ ] 12:00 (30) : free\n\nSUM = 60\n';
 await page.evaluate(async({file,initial})=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.whenIdle();
  c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=false;
  const f=app.vault.getAbstractFileByPath(file);if(f)await app.vault.modify(f,initial);else await app.vault.create(file,initial);
  c.ingest(file,initial);const v=await p.open();v.switchMode('day');await v.navigate('2006-07-08');
 },{file,initial});
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 const input=page.locator('.planner-activity-editor textarea');
 const settled=()=>page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));
 const open=async index=>{const row=page.locator('.planner-row').nth(index);await row.focus();await row.press('Enter');await input.waitFor();};
 const cancel=async()=>{await input.press('Escape');await settled();};
 await open(1);assert((await page.locator('.planner-edit-preview').innerText()).includes('Project credit: CHP 10m + MDR 20m = 30m.'));await cancel();
 checks.push('Mixed project/ordinary allocation explains 30m project credit within the 60m block');
 await open(2);const explanation=await page.locator('.planner-edit-preview').innerText();
 assert(explanation.includes('End time unknown'));assert(explanation.includes('Project credit: CHP 30m.'));assert(!explanation.includes('unresolved'));await cancel();
 checks.push('Known credit with an unknown endpoint is explained without calling it a gap or unresolved activity');
 const gap=page.locator('.planner-row').nth(3);assert(await gap.locator('input[type=checkbox]').isDisabled());
 await gap.focus();await gap.press('Space');assert.equal(await raw(),initial);
 await page.evaluate(async()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;v.selected=3;await v.toggle();});assert.equal(await raw(),initial);
 checks.push('Disabled gap checkbox, Space and direct toggle all leave Markdown unchanged');
 for(const [draft,expectedDraft,expectedRow] of [
  ['12:00 30-0 chp &','12:00 30-0 chp & buffer','12:00 (30-0) : chp & buffer'],
  ['12:00 30 bu','12:00 30 buffer','12:00 (30) : buffer']
 ]) {
  await open(4);await input.fill(draft);
  await page.locator('.planner-activity-editor .planner-suggestions button').filter({hasText:/^buffer$/i}).click();
  assert.equal(await input.inputValue(),expectedDraft);assert(await page.locator('.planner-edit-actions button.mod-cta').isEnabled());
  await input.press('Enter');await settled();
  const expected=initial.replace('12:00 (30) : free',expectedRow);assert.equal(await raw(),expected);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),expected);
  await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 }
 checks.push('Helpers fill the active component, including after dangling &, without losing split allocations; Save and exact Undo/Redo preserve schedule and status');
 await open(4);await input.fill('12:00; 30; bad; extra');
 assert(await page.locator('.planner-activity-editor .planner-suggestions button').filter({hasText:/^buffer$/i}).isDisabled());
 assert.equal(await input.inputValue(),'12:00; 30; bad; extra');
 assert((await page.locator('.planner-activity-editor .planner-suggestions').getAttribute('aria-description')).includes('Check the end time and minutes'));
 await cancel();assert.equal(await raw(),initial);checks.push('Unparseable fields retain draft, disable suggestions with an accessible explanation, and Cancel writes nothing');
 assert.deepEqual(errors,[]);
 const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};
 await writeFile('artifacts/activity-review-native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
 if(page&&settings)await page.evaluate(settings=>Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings),settings).catch(()=>{});
 await browser.close();
}
