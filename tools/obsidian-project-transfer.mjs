import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9237');
try {
 const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
 await assertTestVault(page);
 const checks = await page.evaluate(async () => {
  app.setting.close(); const p=app.plugins.plugins['thejaz-planner'],c=p.controller,checks=[];
  const ok=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  c.settings.autoUpdate=false;c.settings.summaryPath='thejaz-summary-now.md';c.settings.projectGroups=[{name:'Work',projects:['XOLD']}];
  c.settings.projectCodes=[...new Set([...c.settings.projectCodes.filter(code=>code!=='XREN'),'XOLD','XNEW'])];
  c.settings.projectEmojis={...c.settings.projectEmojis,XOLD:'🌱',XNEW:'🦉'};delete c.settings.projectEmojis.XREN;await c.saveSettings();
  const docs={
   '2001-02-01.md':'## plan for 1 feb 01\n- [x] 09:00 (n/a) : awake\n- [x] 10:00 (20-30/60) : xold & xnew (xold)\n- [x] 10:15 (15) : xold\n- [x] 10:25 (10) : xoldont\nXOLD = 35\nXNEW = 30\nSUM = 65\n',
   '2001-02-02.md':'## recorded totals\r\nXOLD = 10\r\nXNEW = 20\r\nSUM = 30\r\n',
   'thejaz-summary-now.md':'### Days (2001-02-01 - 2001-02-02)\n2001-02-01 = 65 🦥\n2001-02-02 = 30 🦥\n### Projects\n🌱 XOLD = 45\n🦉 XNEW = 50\n### Bookmarks\nXOLD = keep this prose\n',
   '2000-01-01--2000-01-01-thejaz-summary.md':'### Projects\n🌱 XOLD = 7\n🦉 XNEW = 8\n### Bookmarks\nKeep xoldont and descriptive (xold).\n',
   '_Codes/archive/transfer.md':'```md\n- [ ] 09:00 (20-30/60) : xold & xnew (xold)\nXOLD = 0\nXNEW = 0\nSUM = 0\n```\n',
   'transfer-unrelated.md':'XOLD in prose and xoldont must remain unchanged.\n'
  };
  await app.vault.createFolder('_Codes/archive').catch(()=>{});
  for(const [path,text]of Object.entries(docs)){const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.modify(file,text);else await app.vault.create(path,text);}
  await new Promise(r=>setTimeout(r,650));await c.mutation;await c.index();c.journal.data.operations=[];await c.journal.save();
  const read=path=>c.port.read(path),snapshot=async()=>Object.fromEntries(await Promise.all(Object.keys(docs).map(async path=>[path,await read(path)])));
  const settings=()=>JSON.stringify({projectCodes:c.settings.projectCodes,projectGroups:c.settings.projectGroups,projectEmojis:Object.fromEntries(Object.entries(c.settings.projectEmojis).sort(([a],[b])=>a.localeCompare(b)))});
  const before=await snapshot(),settingsBefore=settings(),plan=await c.previewProjectTransfer('XOLD','XREN','rename');
  ok(!plan.blockers.length&&plan.changes.length===5,'Rename preview discovers daily, recorded-only, summary and archived fenced template references');
  ok(JSON.stringify(await snapshot())===JSON.stringify(before)&&settings()===settingsBefore,'Preview writes neither source files nor Settings');
  const v=await p.open();v.project='XOLD';v.preset='custom';v.rangeStart='2001-02-01';v.rangeEnd='2001-02-02';v.switchMode('review');
  await c.applyProjectTransfer(plan);
  ok((await read('2001-02-01.md')).includes(': xren & xnew (xold)')&&(await read('2001-02-01.md')).includes(': xoldont')&&(await read('transfer-unrelated.md'))===before['transfer-unrelated.md'],'Rename patches complete tokens and preserves descriptions, similar words and unrelated prose');
  ok(c.settings.projectEmojis.XREN==='🌱'&&c.settings.projectGroups[0].projects.includes('XREN')&&!c.projectCodes().includes('XOLD'),'Rename transfers registration, emoji and group membership');
  ok(v.project==='XREN','A selected Review project filter follows the renamed project');
  ok((await read('_Codes/archive/transfer.md')).startsWith('```md\n')&&(await read('_Codes/archive/transfer.md')).includes('XREN = 0'),'Archived template references change without removing its fence');
  const renamed=await snapshot(),renamedSettings=settings();await c.index();ok(!c.projectCodes().includes('XOLD'),'Rebuild does not resurrect the old registration');
  await c.undo();ok(JSON.stringify(await snapshot())===JSON.stringify(before)&&settings()===settingsBefore,'One Undo restores every source and Settings exactly');
  await c.redo();ok(JSON.stringify(await snapshot())===JSON.stringify(renamed)&&settings()===renamedSettings,'Redo reapplies exact rename bytes and Settings');await c.undo();
  const merge=await c.previewProjectTransfer('XOLD','XNEW','merge');ok(!merge.blockers.length,'Merge preview verifies combined allocations and period-specific figures');
  await c.applyProjectTransfer(merge);
  ok((await read('2001-02-01.md')).includes('(50/60) : xnew (xold)')&&(await read('2001-02-01.md')).includes('XNEW = 65\nSUM = 65'),'Merge combines same-row allocations and footer credit without changing SUM or elapsed');
  ok((await read('2001-02-01.md')).includes('(15) : xnew')&&(await read('2001-02-02.md')).includes('XNEW = 30\r\nSUM = 30'),'Separate sessions remain separate and recorded-only CRLF totals merge correctly');
  ok((await read('thejaz-summary-now.md')).includes('🦉 XNEW = 95')&&(await read('2000-01-01--2000-01-01-thejaz-summary.md')).includes('🦉 XNEW = 15'),'Each summary combines its own values, including aggregate-only history');
  ok(c.settings.projectEmojis.XNEW==='🦉'&&!c.settings.projectEmojis.XOLD&&!c.settings.projectGroups.some(g=>g.projects.includes('XNEW')),'Merge retains the destination emoji and Unassigned group while removing source identity');
  const merged=await snapshot();await c.undo();ok(JSON.stringify(await snapshot())===JSON.stringify(before)&&settings()===settingsBefore,'Merge Undo restores notes, templates, emojis and groups together');await c.redo();ok(JSON.stringify(await snapshot())===JSON.stringify(merged),'Merge Redo restores exact combined records');await c.undo();
  const stale=await c.previewProjectTransfer('XOLD','XREN','rename'),unchanged=await snapshot();
  await app.vault.modify(app.vault.getAbstractFileByPath('2001-02-02.md'),before['2001-02-02.md']+'Concurrent prose.\r\n');
  let rejected=false;try{await c.applyProjectTransfer(stale);}catch(e){rejected=e.message.includes('changed');}ok(rejected&&c.projectCodes().includes('XOLD')&&(await read('2001-02-01.md'))===unchanged['2001-02-01.md'],'A stale source blocks the whole transfer before other writes');
  await app.vault.modify(app.vault.getAbstractFileByPath('2001-02-02.md'),before['2001-02-02.md']);await new Promise(r=>setTimeout(r,650));await c.mutation;
  const staleSettings=await c.previewProjectTransfer('XOLD','XREN','rename');await c.setReviewPreferences({projectGroups:[]});rejected=false;try{await c.applyProjectTransfer(staleSettings);}catch(e){rejected=e.message.includes('settings changed');}ok(rejected,'Changed Settings invalidate a transfer preview');await c.setReviewPreferences({projectGroups:[{name:'Work',projects:['XOLD']}]});
  const staleList=await c.previewProjectTransfer('XOLD','XREN','rename');const extra=await app.vault.create('_Codes/archive/new-transfer.md','- [ ] 09:00 (10) : xold\n');rejected=false;try{await c.applyProjectTransfer(staleList);}catch(e){rejected=e.message.includes('list changed');}ok(rejected,'A newly discovered template invalidates the preview');await app.fileManager.trashFile(extra);await new Promise(r=>setTimeout(r,650));await c.mutation;
  app.setting.open();app.setting.openTabById('thejaz-planner');return checks;
 });
 let settingsPage=page;for(const p of browser.contexts().flatMap(c=>c.pages()))if(await p.locator('.planner-project-settings').count())settingsPage=p;
 await settingsPage.getByRole('searchbox',{name:'Search projects',exact:true}).fill('XOLD');await settingsPage.getByRole('button',{name:'Rename or merge XOLD',exact:true}).click();
 const modalPage=(await page.locator('.planner-project-transfer').count())?page:settingsPage;const modal=modalPage.locator('.planner-project-transfer');
 await modal.getByRole('textbox',{name:'New project code',exact:true}).fill('XNEW');await modal.getByRole('button',{name:'preview',exact:true}).click();
 await modal.getByRole('button',{name:'merge instead',exact:true}).waitFor();assert(await modal.getByRole('button',{name:'apply rename',exact:true}).isDisabled());
 await modal.getByRole('button',{name:'merge instead',exact:true}).click();assert.equal(await modal.getByRole('combobox',{name:'Project transfer action',exact:true}).inputValue(),'merge');assert.equal(await modal.getByRole('combobox',{name:'Destination project',exact:true}).inputValue(),'XNEW');assert(await modal.getByRole('button',{name:'apply merge',exact:true}).isDisabled());
 checks.push('Native rename collision offers merge instead, retaining an explicit preview/application step');
 await modal.getByRole('button',{name:'preview',exact:true}).click();await modal.getByRole('button',{name:'apply merge',exact:true}).waitFor();await modalPage.waitForFunction(()=>!document.querySelector('.planner-project-transfer button.mod-cta').disabled);
 await modal.screenshot({path:'artifacts/project-transfer-preview.png'});await modal.getByRole('button',{name:'cancel',exact:true}).click();assert(await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.projectCodes().includes('XOLD')));checks.push('Native merge preview is reviewable and cancel preserves the source project');
 await page.evaluate(()=>{app.setting.close();app.workspace.getLeavesOfType('thejaz-planner')[0].view.manageProject('XOLD');});
 await page.getByRole('button',{name:'rename or merge',exact:true}).click();await page.getByRole('textbox',{name:'New project code',exact:true}).fill('XREN');await page.getByRole('textbox',{name:'New project code',exact:true}).press('Enter');
 await page.waitForFunction(()=>!document.querySelector('.planner-project-transfer button.mod-cta').disabled);await page.getByRole('button',{name:'apply rename',exact:true}).click();await page.locator('.planner-project-transfer').waitFor({state:'hidden'});
 assert(await page.evaluate(()=>app.plugins.plugins['thejaz-planner'].controller.projectCodes().includes('XREN')));checks.push('Project-chip management opens the shared dialog; Enter previews and apply rename commits');await page.evaluate(async()=>await app.plugins.plugins['thejaz-planner'].controller.undo());
 const recovery=await page.evaluate(async()=>{
  const p=app.plugins.plugins['thejaz-planner'],c=p.controller;await c.mutation;c.journal.data.operations=[];await c.journal.save();
  const plan=await c.previewProjectTransfer('XOLD','XREN','rename'),save=p.saveData.bind(p);let fail=true;
  p.saveData=async data=>{if(fail&&data.projectCodes.includes('XREN'))throw Error('Synthetic rename registry failure');return save(data);};
  let interrupted=false;try{await c.applyProjectTransfer(plan);}catch{interrupted=c.journal.data.operations.some(o=>o.state==='interrupted');}
  fail=false;p.saveData=save;let blocked=false;try{await c.previewProjectTransfer('XOLD','XREN','rename');}catch(e){blocked=e.message.includes('interrupted');}
  for(const leaf of app.workspace.getLeavesOfType('thejaz-planner'))leaf.detach();await app.plugins.disablePlugin('thejaz-planner');await app.plugins.enablePlugin('thejaz-planner');return {interrupted,blocked};
 });assert(recovery.interrupted&&recovery.blocked);checks.push('Interrupted Settings write preserves recovery evidence and blocks further transfers');
 await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 const recovered=await page.evaluate(async()=>{
  const c=app.plugins.plugins['thejaz-planner'].controller;const f=app.vault.getAbstractFileByPath('2001-02-02.md'),text=await c.port.read(f.path);
  const extra=await app.vault.create('_Codes/archive/recovery-list-change.md','- [ ] 09:00 (10) : xold\n');let listBlocked=false;try{await c.recover();}catch(e){listBlocked=e.message.includes('added, removed or renamed');}await app.fileManager.trashFile(extra);
  await app.vault.modify(f,text+'Concurrent recovery edit.\r\n');let blocked=false;try{await c.recover();}catch{blocked=true;}await app.vault.modify(f,text);
  await c.recover();const success=c.projectCodes().includes('XREN')&&!c.projectCodes().includes('XOLD')&&c.settings.projectEmojis.XREN==='🌱';await c.undo();return {blocked,listBlocked,success,undone:c.projectCodes().includes('XOLD')&&(await c.port.read('2001-02-01.md')).includes('XOLD = 35')};
 });assert(recovered.blocked&&recovered.listBlocked&&recovered.success&&recovered.undone);checks.push('After restart, changed source text or file membership blocks recovery; restoring them permits recovery and exact grouped Undo');
 await page.evaluate(async()=>{const v=await app.plugins.plugins['thejaz-planner'].open();v.manageProject('XOLD');});
 await page.getByRole('button',{name:'rename or merge',exact:true}).click();await page.getByRole('combobox',{name:'Project transfer action',exact:true}).selectOption('merge');await page.getByRole('combobox',{name:'Destination project',exact:true}).selectOption('XNEW');await page.getByRole('button',{name:'preview',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.planner-project-transfer button.mod-cta').disabled);await page.getByRole('button',{name:'apply merge',exact:true}).click();await page.locator('.planner-project-transfer').waitFor({state:'hidden'});
 assert(await page.evaluate(()=>!app.plugins.plugins['thejaz-planner'].controller.projectCodes().includes('XOLD')));checks.push('Native apply merge commits the explicitly previewed merge');
 await page.evaluate(async()=>{for(const leaf of app.workspace.getLeavesOfType('thejaz-planner'))leaf.detach();await app.plugins.disablePlugin('thejaz-planner');await app.plugins.enablePlugin('thejaz-planner');});await page.waitForFunction(()=>app.plugins.plugins['thejaz-planner']?.controller.indexed);
 assert(await page.evaluate(async()=>{const c=app.plugins.plugins['thejaz-planner'].controller;if(c.projectCodes().includes('XOLD')||c.settings.projectEmojis.XNEW!=='🦉')return false;await c.undo();return c.projectCodes().includes('XOLD')&&(await c.port.read('2001-02-01.md')).includes('XOLD = 35');}));checks.push('Merge persists without old-code resurrection after restart and remains undoable');
 assert(await page.evaluate(async()=>{
  const c=app.plugins.plugins['thejaz-planner'].controller;await c.mutation;
  if(!c.projectCodes().includes('IRP'))await c.updateProjectCodes([...c.settings.projectCodes,'IRP']);await c.index();
  const plan=await c.previewProjectTransfer('IRP','XDEF','rename');if(plan.blockers.length)throw Error(JSON.stringify(plan.blockers));await c.applyProjectTransfer(plan);
  const blank=await c.create('2001-02-03','');const correct=!blank.text.includes(': IRP');await c.index();const stable=!c.projectCodes().includes('IRP');await c.undo();await c.undo();return correct&&stable&&c.projectCodes().includes('IRP');
 }));checks.push('Renaming a built-in project prevents blank-day defaults from reintroducing it; creation and rename remain separately undoable');
 await writeFile('artifacts/project-transfer-native.json',JSON.stringify({version:JSON.parse(await readFile('manifest.json','utf8')).version,checks},null,2));console.log(JSON.stringify({checks:checks.length,results:checks},null,2));
}finally{await browser.close();}
