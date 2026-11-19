import { BACKUPS, WORKSPACE, ownerVault } from './paths.mjs';
import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=ownerVault(), workspace=WORKSPACE, stage=path.join(workspace,'.test-vault/.legend-migration');
assert.equal(path.resolve('.'),workspace,'Run from the planner workspace');
const hash=b=>createHash('sha256').update(b).digest('hex');
const built=await build({stdin:{contents:"export {migrateLegend} from './src/core/legend-migration';export {applyPatches} from './src/core/changes';export {parseSummary} from './src/core/history';",resolveDir:workspace},bundle:true,write:false,format:'esm',platform:'node'});
const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const manifestPath=path.join(stage,'plan.json');
function safe(relative){const target=path.resolve(root,relative);assert(target.startsWith(path.resolve(root)+path.sep));return target;}
async function allFiles(dir='') {
 const files=[];for(const item of await readdir(path.join(root,dir),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink())continue;
  const name=path.join(dir,item.name);if(item.isDirectory())files.push(...await allFiles(name));else if(/thejaz-summary.*\.md$/i.test(item.name))files.push(name);
 }return files.sort();
}
function verify(before,after,name){
 const a=core.parseSummary(before,name),b=core.parseSummary(after,name);assert.equal(a.rows.length,b.rows.length);
 for(let i=0;i<a.rows.length;i++){
  assert.equal(a.rows[i].date,b.rows[i].date);assert.equal(a.rows[i].value,b.rows[i].value);
  const old=a.lines[a.rows[i].line].raw,next=b.lines[b.rows[i].line].raw;
  const amount=s=>/\d{2}-\d{2}\s*:\s*(\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m?|\?)/i.exec(s)?.[1];
  assert.equal(amount(old),amount(next),'Recorded amount text changed');
  assert.equal((old.match(/\*\*/g)||[]).length,(next.match(/\*\*/g)||[]).length,'Bold changed');
 }
}
if(process.argv.includes('--prepare')){
 await mkdir(stage,{recursive:true});assert.equal((await lstat(path.join(workspace,'.test-vault'))).isSymbolicLink(),false);
 const files=await allFiles();assert.equal(files.length,11,'Review changed source scope first');
 const settings=JSON.parse(await readFile(`${root}/.obsidian/plugins/thejaz-planner/data.json`,'utf8'));
 const plan={version:'0.2.55',weekends:settings.weekendDays,files:[]};
 for(const name of files){const buffer=await readFile(safe(name)),text=buffer.toString('utf8');const result=core.migrateLegend(text,name,plan.weekends);const after=core.applyPatches(text,result.change.patches);verify(text,after,name);
  for(const [side,bytes] of [['before',buffer],['after',Buffer.from(after)]]){const target=path.join(stage,side,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  plan.files.push({name,before:hash(buffer),after:hash(Buffer.from(after)),patches:result.change.patches.length,issues:result.issues});
 }
 await writeFile(manifestPath,JSON.stringify(plan,null,2));console.log(JSON.stringify({files:plan.files.length,patches:plan.files.reduce((a,f)=>a+f.patches,0),issues:plan.files.flatMap(f=>f.issues)},null,2));
}else if(process.argv.includes('--verify-native')){
 const {chromium}=await import('playwright'),browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  const plan=JSON.parse(await readFile(manifestPath,'utf8'));
  for(const file of plan.files){const before=await readFile(path.join(stage,'before',file.name),'utf8'),after=await readFile(path.join(stage,'after',file.name),'utf8');assert.equal(hash(Buffer.from(before)),file.before);verify(before,after,file.name);
   const relative='.legend-migration/after/'+file.name.replaceAll('\\','/');
   const actual=await page.evaluate(async({relative,before,after})=>{await app.vault.adapter.write(relative,before);await app.vault.adapter.write(relative,after);return app.vault.adapter.read(relative);},{relative,before,after});assert.equal(actual,after);
  }
  plan.nativeVerified=true;await writeFile(manifestPath,JSON.stringify(plan,null,2));
  await writeFile('artifacts/legend-copy-verification.json',JSON.stringify({files:plan.files.length,checks:['All copied summaries round-trip through isolated Obsidian storage','All recorded amounts and bold tokens unchanged','Exact migration patches verified; unrelated text preserved'],issues:plan.files.flatMap(f=>f.issues)},null,2));
  console.log('All 11 summary copies verified in isolated Obsidian; amounts/bold preserved.');
 }finally{await browser.close();}
}else if(process.argv.includes('--apply')){
 const plan=JSON.parse(await readFile(manifestPath,'utf8'));assert(plan.nativeVerified);assert.deepEqual(await allFiles(),plan.files.map(f=>f.name));
 const backup=path.join(BACKUPS,`planner-legend-migration-0.2.55-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(backup,{recursive:true});
 for(const file of plan.files){const current=await readFile(safe(file.name));assert.equal(hash(current),file.before,`${file.name} changed; prepare again`);const after=await readFile(path.join(stage,'after',file.name));assert.equal(hash(after),file.after);verify(current.toString('utf8'),after.toString('utf8'),file.name);const result=core.migrateLegend(current.toString('utf8'),file.name,plan.weekends);assert.equal(core.applyPatches(current.toString('utf8'),result.change.patches),after.toString('utf8'));const target=path.join(backup,file.name);await mkdir(path.dirname(target),{recursive:true});await copyFile(safe(file.name),target);assert.equal(hash(await readFile(target)),file.before);}
 await copyFile(manifestPath,path.join(backup,'migration-plan.json'));
 const written=[];
 try{
  for(const file of plan.files){const target=safe(file.name),temp=target+'.planner-legend.tmp';assert.equal(hash(await readFile(target)),file.before);const after=await readFile(path.join(stage,'after',file.name));await writeFile(temp,after,{flag:'wx'});try{assert.equal(hash(await readFile(target)),file.before);await rename(temp,target);}catch(e){await unlink(temp).catch(()=>{});throw e;}written.push(file);assert.equal(hash(await readFile(target)),file.after);}
 }catch(error){for(const file of written.reverse())if(hash(await readFile(safe(file.name)))===file.after)await copyFile(path.join(backup,file.name),safe(file.name));throw error;}
 const report={version:plan.version,backup,files:plan.files.length,patches:plan.files.reduce((a,f)=>a+f.patches,0),issues:plan.files.flatMap(f=>f.issues),minutesAndBoldPreserved:true};await writeFile(path.join(backup,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/local-legend-migration.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}else throw Error('Choose --prepare, --verify-native, or --apply. Apply writes only the verified backed-up summary files.');
