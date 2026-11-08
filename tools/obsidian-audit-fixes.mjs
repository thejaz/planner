import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {plannerUI} from './planner-ui.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
const checks=[], errors=[];
try {
 const page=plannerUI(browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/')));
 await page.waitForFunction(()=>typeof app!=='undefined'&&app.vault);
 await assertTestVault(page);
 const trust=page.getByRole('button',{name:'Trust author and enable plugins',exact:true}); if(await trust.count()) await trust.click();
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 await page.evaluate(()=>app.setting.close()); page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(async()=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;c.settings.autoUpdate=false;
  const text='## plan for 1 jan 06\n### morning\n- [ ] 09:00 (30) : alpha\n- [ ] 09:30 (30) : beta\n### afternoon\n---\nSUM = 0\n';
  const path='2006-01-01.md',f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.modify(f,text);else await app.vault.create(path,text);
  await c.index();const v=await p.open();v.switchMode('day');await v.navigate('2006-01-01');
 });
 const row=i=>page.locator(`.planner-row[data-index="${i}"]`),capture=page.locator('.planner-capture:not(.planner-activity-editor)'),quick=page.getByRole('textbox',{name:'Quick entry',exact:true});
 await row(0).locator('.planner-label').click(); await row(0).getByRole('button',{name:'Add below',exact:true}).click();await quick.fill('20 chp');
 await row(1).locator('.planner-label').click();assert(await capture.evaluate(el=>el.classList.contains('is-collapsed')));
 await row(1).getByRole('button',{name:'Add below',exact:true}).click();assert.equal(await quick.inputValue(),'20 chp');
 await row(1).focus();await row(1).press('ArrowUp');assert(await capture.evaluate(el=>el.classList.contains('is-collapsed')));
 await row(1).locator('.planner-label').click();await row(1).getByRole('button',{name:'Add below',exact:true}).click();
 await row(0).locator('input[type=checkbox]').click();await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.whenIdle());
 assert(await capture.evaluate(el=>el.classList.contains('is-collapsed')));
 checks.push('Click/keyboard/checkbox selection collapses Add activity and preserves its draft for explicit reopening');
 const result=await page.evaluate(async()=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller,v=await p.open(),path='2006-01-01.md';
  const idle=c.whenIdle;let release;const gate=new Promise(r=>release=r);c.whenIdle=()=>gate;
  try {
   const opening=v.startActivityEdit(1);
   const f=app.vault.getAbstractFileByPath(path),text='## plan for 1 jan 06\n### morning\n- [ ] 08:30 (30) : inserted\n- [ ] 09:00 (30) : alpha\n- [ ] 09:30 (30) : beta\n### afternoon\n---\nSUM = 0\n';
   await app.vault.modify(f,text);c.ingest(path,text);release();await opening;
   return {input:v.activityEditor.input.value,index:v.selected};
  } finally {release();c.whenIdle=idle;}
 });
 assert.equal(result.input,'09:30 30 beta');assert.equal(result.index,2);
 const edit=page.locator('.planner-activity-editor');await edit.getByRole('textbox',{name:'Edit activity input',exact:true}).fill('09:35 35 beta');
 await edit.getByRole('button',{name:'Save changes',exact:true}).click();await edit.waitFor({state:'detached'});
 const raw=await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.port.read('2006-01-01.md'));
 assert(raw.includes('09:00 (30) : alpha'));assert(raw.includes('09:35 (35) : beta'));assert.equal((raw.match(/^- \[/gm)||[]).length,3);
 checks.push('Insertion during edit opening preserves clicked beta identity; Save changes updates beta only');
 const failed=await page.evaluate(async()=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller,v=await p.open(),path='2006-01-01.md';
  const idle=c.whenIdle;let release;const gate=new Promise(r=>release=r);c.whenIdle=()=>gate;
  try {
   const opening=v.startActivityEdit(2).then(()=>'',e=>e.message);
   const f=app.vault.getAbstractFileByPath(path),text=(await c.port.read(path)).replace('09:35 (35) : beta','09:40 (40) : renamed');
   await app.vault.modify(f,text);c.ingest(path,text);release();return await opening;
  } finally {release();c.whenIdle=idle;}
 });
 assert(failed.includes('changed'));assert.equal(await edit.count(),0);
 checks.push('Changed/deleted target during refresh refuses editing rather than selecting a neighbor');
 const summary=await page.evaluate(async()=>{
  const c=app.plugins.plugins['thejaz-planner'].controller;
  const store=async(path,text)=>{const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.modify(f,text);else await app.vault.create(path,text);};
  await store('2006-01-01.md','## plan for 1 jan 06\n### morning\n- [x] 09:00 (30) : chp\nCHP = 30\nSUM = 30\n');
  await store('2006-01-02.md','## plan for 2 jan 06\n### morning\n- [x] 09:00 (60) : chp\nCHP = 60\nSUM = 60\n');
  c.settings.summaryPath='thejaz-summary-audit-native.md';
  await store(c.settings.summaryPath,'### Days\n2006-01-01 = 30\n### Projects\nCHP = 90\n### Bookmarks\n2006-01-02 = 999\n### Results\n2006-01-02 = 888\nDays (2006-01-01 - 2006-01-02)\n');
  await c.index();const before=await c.port.read(c.settings.summaryPath);await c.reconcileSummary();const after=await c.port.read(c.settings.summaryPath);return {before,after};
 });
 assert.equal(summary.after.split('### Bookmarks')[1],summary.before.split('### Bookmarks')[1]);assert(summary.after.split('### Projects')[0].includes('2006-01-02 = 60'));
 checks.push('Native summary reconciliation inserts the real daily row in Days and leaves Bookmarks/Results byte-exact');
 assert.deepEqual(errors,[]);await writeFile('artifacts/audit-fixes.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
