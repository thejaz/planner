import { assertTestVault } from './paths.mjs';
import {CRITERIA_NOTE,setCriteria} from './criteria-note.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {plannerUI} from './planner-ui.mjs';
const legend=/export const CANONICAL_LEGEND = `([\s\S]*?)`;/.exec(await readFile('src/core/marker-rules.ts','utf8'))[1];
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[],errors=[],archive='Archive/thejaz-summary-context-picker.md',main='Context picker current.md';
try {
 const page=plannerUI(browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/')));
 await assertTestVault(page);
 page.on('pageerror',e=>errors.push(e.message));
 // One criteria note serves every summary; summaries hold only their days.
 await setCriteria(page,legend);
 await page.evaluate(async({archive,main})=>{
  const c=app.plugins.plugins['thejaz-planner'].controller;
  c.settings.autoUpdate=false;c.settings.summaryPath=main;c.settings.weekendDays=[5];
  window.contextFixture={archive,main};
  const store=async(p,text)=>{const f=app.vault.getAbstractFileByPath(p);if(f)await app.vault.modify(f,text);else await app.vault.create(p,text);};
  if(!app.vault.getAbstractFileByPath('Archive'))await app.vault.createFolder('Archive');
  await store(archive,'### Days\n2010-02-02 = 20 😣 ==keep annotation==\n2010-02-03 = 130 🦥\nDays (2010-02-02 - 2010-02-03): 2d\n');
  await store(main,'### Days\n2012-02-02 = 20 😣\nDays (2012-02-02 - 2012-02-02): 1d\n');
  await store('2010-02-02.md','## plan for 2 feb 10\n### morning\n- [x] 09:00 (20) : chp\nCHP = 20\nSUM = 20\n');
  await store('2010-02-03.md','## plan for 3 feb 10\n### morning\n- [x] 09:00 (130) : chp\nCHP = 130\nSUM = 130\n');
  await c.index();const v=await app.plugins.plugins['thejaz-planner'].open();v.switchMode('day');await v.navigate('2010-02-02');
  window.contextFixture.originals=await Promise.all([archive,main,'2010-02-02.md','2010-02-03.md'].map(p=>c.port.read(p)));
 },{archive,main});
 const raw=path=>page.evaluate(path=>app.plugins.plugins['thejaz-planner'].controller.port.read(path),path);
 const before=await raw(archive),mainBefore=await raw(main);
 const open=async()=>{await page.locator('.planner').focus();await page.keyboard.press('c');await page.locator('.modal .planner-context-choices').waitFor();};
 const radio=id=>page.locator(`.modal input[data-context="${id}"]`);
 const save=async()=>{await page.getByRole('button',{name:'Save context',exact:true}).click();await page.locator('.modal').waitFor({state:'detached'});};
 await open();
 assert.equal(await page.locator('.modal input[type=radio]').count(),4);
 // The dialog names both the owning summary and the criteria note.
 assert.deepEqual(await page.locator('.planner-context-source').allInnerTexts(),[`Summary: ${archive}`,`Criteria: ${CRITERIA_NOTE}`]);
 assert((await page.locator('.planner-context-choices').innerText()).includes('excused - no-pro'));
 assert((await radio('ordinary').getAttribute('aria-label')).includes('ordinary day'));
 assert(!/[—–·]/.test(await page.locator('.modal').innerText()));
 assert((await radio('ordinary').getAttribute('aria-label')).includes('🌞'));
 const operationCount=()=>page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.journal.data.operations.length);
 const count=await operationCount();await save();assert.equal(await raw(archive),before);assert.equal(await operationCount(),count);
 checks.push('C opens archived-day context from its unique owning summary; sun clearing choice and parsed readable contexts; unchanged save is byte-exact with no operation');
 await open();await radio('ordinary').focus();await page.keyboard.press('ArrowDown');assert(await radio('excused').isChecked());
 await page.keyboard.press('Space');assert(await radio('excused').isChecked());await page.keyboard.press('Enter');await page.locator('.modal').waitFor({state:'detached'});
 const excused=await raw(archive);assert(excused.includes('2010-02-02 = 20 ✌ ==keep annotation=='));assert.equal(await raw(main),mainBefore);
 assert(await page.locator('.planner').evaluate(el=>el.contains(document.activeElement)));
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.undo());assert.equal(await raw(archive),before);
 await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.redo());assert.equal(await raw(archive),excused);
 checks.push('Native radio arrow/Space/Enter interaction saves only the archive; focus returns; Undo/Redo restore exact summary bytes');
 await open();await radio('buffer').check();await page.keyboard.press('Escape');await page.locator('.modal').waitFor({state:'detached'});assert.equal(await raw(archive),excused);
 await page.evaluate(async()=>{await app.workspace.getLeavesOfType('thejaz-planner')[0].view.navigate('2010-02-03');});
 await open();await radio('excused').check();assert((await page.locator('.planner-context-result').innerText()).includes('130m'));
 assert((await page.locator('.planner-context-result').innerText()).includes('No special context will remain'));await save();
 await open();assert(await radio('ordinary').isChecked());await radio('buffer').check();await save();assert((await raw(archive)).includes('2010-02-03 = 130 ☁️🦥'));
 checks.push('Cancel never writes; out-of-range excused preview explains its loss; planned context retains earned marker at 130m');
 await open();await radio('at-ease').check();
 await page.evaluate(async archive=>{const f=app.vault.getAbstractFileByPath(archive);await app.vault.modify(f,(await app.vault.read(f)).replace('130 ☁️🦥','131 ☁️🦥'));},archive);
 await page.getByRole('button',{name:'Save context',exact:true}).click();
 await page.locator('.modal .planner-error',{hasText:'changed'}).waitFor();assert(await radio('at-ease').isChecked());
 assert((await raw(archive)).includes('131 ☁️🦥'));await page.keyboard.press('Escape');
 await open();await radio('at-ease').check();
 await page.evaluate(async note=>{const f=app.vault.getAbstractFileByPath(note);await app.vault.modify(f,(await app.vault.read(f)).replace('150-299m | cool','150-299m | renamed'));},CRITERIA_NOTE);
 await page.getByRole('button',{name:'Save context',exact:true}).click();
 await page.locator('.modal .planner-error',{hasText:'changed'}).waitFor();assert(await radio('at-ease').isChecked());await page.keyboard.press('Escape');
 checks.push('Concurrent target-row and legend edits block saving while retaining the selected context and dialog');
 const blockers=await page.evaluate(async({legend,archive})=>{
  const c=app.plugins.plugins['thejaz-planner'].controller,results=[];
  const probe=async(date)=>{try{await c.contextForDate(date);return 'UNEXPECTED SUCCESS';}catch(e){return e.message;}};
  results.push(await probe('2000-01-01'));
  const overlap='Archive/thejaz-summary-context-overlap.md';
  await app.vault.create(overlap,'### Days\n2010-02-03 = 130 🦥\nDays (2010-02-03 - 2010-02-03)\n');
  results.push(await probe('2010-02-03'));await app.vault.delete(app.vault.getAbstractFileByPath(overlap));
  const f=app.vault.getAbstractFileByPath(archive),original=await app.vault.read(f);
  for(const replacement of ['2010-02-03 = ?','2010-02-03 = 130 🦥\n2010-02-03 = 130 🦥','']){
   await app.vault.modify(f,original.replace('2010-02-03 = 131 ☁️🦥',replacement));results.push(await probe('2010-02-03'));
  }
  await app.vault.modify(f,original);
  return results;
 },{legend,archive});
 assert(blockers[0].includes('no summary covers'));assert(blockers[1].includes('more than one summary covers'));assert(blockers.slice(2).every(s=>s.includes('one row with recorded minutes')));
 checks.push('Missing/overlapping summary periods and missing/duplicate/unknown-minute rows fail without writes');
 await setCriteria(page,legend.replace('no-pro (context: excused)','rested (context: excused)'));
 const overrideChecks=await page.evaluate(async({legend,archive,source})=>{
  const c=app.plugins.plugins['thejaz-planner'].controller;
  const snap=await c.contextForDate('2010-02-03');
  const label=snap.criteria.definitions.find(d=>d.context==='excused').label;
  await app.vault.modify(app.vault.getAbstractFileByPath(source),legend);c.ingest(source,legend);
  let conflict='';try{await c.setContext('2010-02-03','at-ease',snap);}catch(e){conflict=e.message;}
  const fresh=await c.contextForDate('2010-02-03'),file=app.vault.getAbstractFileByPath(archive),text=await app.vault.read(file);
  await app.vault.modify(file,text.replace('Days (2010-02-02 - 2010-02-03)','Days (2010-02-02 - 2010-02-02)'));
  let ownership='';try{await c.setContext('2010-02-03','at-ease',fresh);}catch(e){ownership=e.message;}
  await app.vault.modify(file,text);
  return {source:snap.source,label,conflict,ownership};
 },{legend,archive,source:CRITERIA_NOTE});
 assert.equal(overrideChecks.source,CRITERIA_NOTE);assert.equal(overrideChecks.label,'rested');assert(overrideChecks.conflict.includes('changed'));assert(overrideChecks.ownership.includes('no summary covers'));
 checks.push('thejaz-criteria.md supplies parsed labels; changed criteria and changed period ownership invalidate a save');
 await setCriteria(page,legend.replace('no-pro (context: excused)','MiXeD Label (context: excused)').replace('any | buffer','any | BuFfEr'));
 await open();
 assert.equal(await radio('excused').getAttribute('aria-label'),'✌ excused - MiXeD Label');
 assert.equal(await radio('buffer').getAttribute('aria-label'),'☁️ BuFfEr');
 await page.keyboard.press('Escape');
 await setCriteria(page,legend);
 checks.push('Picker preserves authored mixed-case labels, uses lowercase ordinary/context IDs and ASCII separators with emojis');
 await open();await page.setViewportSize({width:430,height:760});
 assert(await page.locator('.modal .planner-context-choices').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.getByRole('button',{name:'Save context',exact:true}).scrollIntoViewIfNeeded();
 assert(await page.getByRole('button',{name:'Save context',exact:true}).isVisible());
 await page.screenshot({path:'artifacts/context-picker-narrow.png'});await page.keyboard.press('Escape');await page.setViewportSize({width:1100,height:850});
 await page.evaluate(()=>app.workspace.getLeavesOfType('thejaz-planner')[0].view.focusEntry());
 await page.locator('textarea[data-planner-key="quick-entry"]').fill('c');await page.keyboard.press('c');assert.equal(await page.locator('.modal').count(),0);
 await page.keyboard.press('Escape');
 checks.push('Narrow layout has no choice overflow; C does not open context while typing');
 const preserved=await page.evaluate(async()=>{
  const c=app.plugins.plugins['thejaz-planner'].controller,f=window.contextFixture;
  const now=await Promise.all([f.main,'2010-02-02.md','2010-02-03.md'].map(p=>c.port.read(p)));
  return now.every((text,i)=>text===f.originals[i+1]);
 });assert(preserved);assert.deepEqual(errors,[]);
 checks.push('Both daily notes and the configured current summary remain exactly unchanged throughout archive context changes');
 const version=await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].manifest.version);
 await writeFile('artifacts/context-picker.json',JSON.stringify({version,checks,blockers,errors},null,2));console.log(JSON.stringify({version,checks,errors},null,2));
}finally{await browser.close();}
