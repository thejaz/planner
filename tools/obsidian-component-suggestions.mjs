// Synthetic interaction checks for component-aware chips and protected draft fields.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {assertTestVault} from './paths.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],file='2008-09-10.md';let page,settings;
try {
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
 assert(page);await assertTestVault(page);
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 settings=await page.evaluate(()=>({...app.plugins.plugins['thejaz-planner'].controller.settings}));
 page.on('pageerror',e=>errors.push(e.message));
 const initial='## plan for 10 sep 08\n### morning\n- [x] 10:00 (n/a) : awake\n- [ ] 10:30 (30) : break\n- [ ] ...\n\nSUM = 0\n';
 await page.evaluate(async({file,initial})=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.whenIdle();c.settings.autoUpdate=false;c.settings.roundTimes=false;c.settings.roundCredits=false;
  const existing=app.vault.getAbstractFileByPath(file);if(existing)await app.vault.modify(existing,initial);else await app.vault.create(file,initial);
  c.ingest(file,initial);const v=await p.open();v.switchMode('day');await v.navigate('2008-09-10');v.selected=0;v.focusEntry();
 },{file,initial});
 const input=page.locator('textarea[data-planner-key="quick-entry"]');
 const raw=()=>page.evaluate(file=>app.plugins.plugins['thejaz-planner'].controller.port.read(file),file);
 const setRange=async(field,start,end=start)=>{await field.focus();await field.evaluate((el,{start,end})=>{el.setSelectionRange(start,end);el.dispatchEvent(new Event('select'));},{start,end});};
 const chips=page.locator('.planner-capture:not(.planner-activity-editor) .planner-suggestions');
 const buffer=host=>host.locator('button').filter({hasText:/^buffer$/i});
 for(const [text,expected] of [['10:30','10:30 buffer'],['30','30 buffer'],['10:30; 30;','10:30; 30; buffer']]){
  await input.fill(text);assert(await buffer(chips).isEnabled());await buffer(chips).click();assert.equal(await input.inputValue(),expected);
  assert(await input.evaluate(el=>el===el.ownerDocument.activeElement&&el.selectionStart===el.value.length));assert.equal(await raw(),initial);
 }
 checks.push('Time-only, duration-only and empty semicolon activity fields offer chips; choosing one preserves schedule, focus and source');
 const multi='10:30 30 bu\n11:00 30 free';await input.fill(multi);await setRange(input,10);await buffer(chips).click();
 assert.equal(await input.inputValue(),'10:30 30 buffer\n11:00 30 free');
 assert.equal(await input.evaluate(el=>el.selectionStart),15);
 checks.push('Multiline chips target the caret line and restore its caret, leaving other lines untouched');
 const group='10:30 20-10 chp & bu (home & work) & free',caret=group.indexOf('bu')+2;
 await input.fill(group);await setRange(input,caret);assert(await buffer(chips).isEnabled());await buffer(chips).focus();await buffer(chips).press('Enter');
 assert.equal(await input.inputValue(),group.replace('bu (','buffer ('));assert.equal(await input.evaluate(el=>el.selectionStart),caret+4);
 await input.fill(group);await setRange(input,caret);await input.press('Tab');assert.equal(await input.inputValue(),group.replace('bu (','buffer ('));
 await input.fill(group);await setRange(input,group.indexOf(' & free'));await buffer(chips).click();assert.equal(await input.inputValue(),group.replace('bu (','buffer ('));
 checks.push('Mouse/keyboard chips and Tab share component boundaries, preserving split amounts, context and later components');
 await input.fill('10:30; 30; bad; extra');assert(await buffer(chips).isDisabled());assert.equal(await input.inputValue(),'10:30; 30; bad; extra');
 assert((await chips.getAttribute('aria-description')).includes('Check the end time and minutes'));
 assert((await chips.locator('.planner-suggestion-reason').innerText()).includes('Check the end time and minutes'));
 await input.fill(group);await setRange(input,0,19);assert(await buffer(chips).isDisabled());
 await setRange(input,group.indexOf('home')+2);assert(await buffer(chips).isDisabled());
 checks.push('Malformed schedules, cross-field selections and parentheses disable chips without discarding draft text');
 await input.fill('');await input.press('Escape');
 const edit=page.locator('.planner-activity-editor textarea'),editChips=page.locator('.planner-activity-editor .planner-suggestions');
 const open=async()=>{const row=page.locator('.planner-row').nth(1);await row.focus();await row.press('Enter');await edit.waitFor();};
 const finished=()=>page.waitForFunction(()=>!document.querySelector('.planner-activity-editor')&&document.activeElement?.classList.contains('planner-row'));
 // Edit opens with the end time and minutes selected; chips replace the single activity name.
 await open();assert.deepEqual(await edit.evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,8]);
 assert(await buffer(editChips).isEnabled());assert.equal(await editChips.locator('.planner-suggestion-reason').count(),0);
 await buffer(editChips).click();assert.equal(await edit.inputValue(),'10:30 30 buffer');
 await edit.press('Escape');await finished();assert.equal(await raw(),initial);
 checks.push('Chips work as soon as Edit opens with the time and minutes selected, replacing only the name; Cancel keeps the note');
 await open();assert((await page.locator('.planner-edit-preview').innerText()).includes('Planned: no project credit.'));
 await edit.fill('10:30 20-10 chp & bu (home)');await setRange(edit,19);await buffer(editChips).click();
 assert.equal(await edit.inputValue(),'10:30 20-10 chp & buffer (home)');
 await edit.press('Enter');await finished();const saved=initial.replace('10:30 (30) : break','10:30 (20-10) : chp & buffer (home)');assert.equal(await raw(),saved);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(),saved);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(),initial);
 checks.push('Edit chips preserve component order, context, status and row count; Save and exact Undo/Redo pass');
 await open();await edit.fill('10:30 30 chp (bad');await setRange(edit,9,12);await buffer(editChips).click();assert.equal(await edit.inputValue(),'10:30 30 buffer (bad');
 assert(await page.locator('.planner-edit-actions button.mod-cta').isDisabled());
 assert((await page.locator('.planner-activity-editor .planner-error').innerText()).includes('parentheses'));
 await edit.press('Escape');await finished();assert.equal(await raw(),initial);
 checks.push('Malformed context survives component replacement, requires explicit repair and Cancel writes nothing');
 await page.evaluate(()=>{const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;v.selected=2;v.focusEntry();});await input.fill('30 buffer');
 assert((await page.locator('.planner-entry-anchor').innerText()).includes('14:00 >'));
 assert((await page.locator('.planner-entry-anchor').innerText()).includes('? 30 buffer'));
 assert((await page.locator('.planner-preview-area .planner-error').innerText()).includes('known time'));
 checks.push('Guidance after a gap recommends valid endpoints rather than duration-only input');
 await input.fill('30 bu');
 for(const theme of ['theme-light','theme-dark']){
  await page.evaluate(theme=>{document.body.classList.remove('theme-light','theme-dark');document.body.classList.add(theme);},theme);
  await page.locator('.planner-shell').evaluate(el=>{el.style.width='300px';el.style.maxWidth='100%';});
  assert(await page.locator('.planner-capture').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 }
 await page.locator('.planner-shell').evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('max-width');});
 checks.push('Suggestions and guidance fit a 300px layout in light and dark themes');
 await input.fill('');await input.press('Escape');
 await page.evaluate(async()=>{
  const c=app.plugins.plugins['thejaz-planner'].controller,path='2008-09-11.md',text='## plan for 11 sep 08\n### morning\n\nSUM = 0\n';
  const existing=app.vault.getAbstractFileByPath(path);if(existing)await app.vault.modify(existing,text);else await app.vault.create(path,text);
  c.ingest(path,text);const v=app.workspace.getLeavesOfType('thejaz-planner')[0].view;await v.navigate('2008-09-11');v.focusEntry();
 });
 await input.fill('buffer');assert((await page.locator('.planner-entry-anchor').innerText()).includes('count from the configured start:'));
 assert((await page.locator('.planner-preview-area').innerText()).includes('Uses the configured start:'));
 checks.push('An empty day retains the configured-start explanation and baseline preview');
 assert.equal(await raw(),initial);assert.deepEqual(errors,[]);
 const result={version:await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version),checks,errors};
 await writeFile('artifacts/component-suggestions-native.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
 if(page&&settings)await page.evaluate(settings=>Object.assign(app.plugins.plugins['thejaz-planner'].controller.settings,settings),settings).catch(()=>{});
 await browser.close();
}
