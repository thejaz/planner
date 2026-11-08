import { BACKUPS, WORKSPACE, ownerVault } from './paths.mjs';
import { assertTestVault } from './paths.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=ownerVault(),workspace=WORKSPACE,stage=path.join(workspace,'.test-vault/.combination-migration');
assert.equal(path.resolve('.'),workspace);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const built=await build({stdin:{contents:"export {addCombinationRules,simplifyCombinationRules} from './src/core/combination-migration';export {applyPatches} from './src/core/changes';export {parseSummary} from './src/core/history';export {parseMarkerCriteria} from './src/core/marker-rules';",resolveDir:workspace},bundle:true,write:false,format:'esm',platform:'node'});
const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const migrate=process.argv.includes('--simplify') ? core.simplifyCombinationRules : core.addCombinationRules;
const version=JSON.parse(await readFile('package.json','utf8')).version,manifestPath=path.join(stage,'plan.json');
function safe(name){const target=path.resolve(root,name);assert(target.startsWith(path.resolve(root)+path.sep));return target;}
async function discover(dir=''){
 const result=[];for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
  const name=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await discover(name));else if(/thejaz-summary.*\.md$/i.test(entry.name))result.push(name);
 }return result.sort();
}
function verify(before,after,name){
 assert.deepEqual(Buffer.from(before.toString('utf8')),before,'Invalid UTF-8 requires manual review');
 const text=before.toString('utf8'),change=migrate(text,name);
 if(!process.argv.includes('--simplify')){assert(change.patches.length<=1);for(const p of change.patches)assert.equal(p.before,'');}
 assert.deepEqual(Buffer.from(core.applyPatches(text,change.patches)),after);
 const a=core.parseSummary(text,name),b=core.parseSummary(after.toString('utf8'),name);
 assert.equal(a.rows.length,b.rows.length);
 for(let i=0;i<a.rows.length;i++){assert.equal(a.rows[i].date,b.rows[i].date);assert.equal(a.rows[i].value,b.rows[i].value);assert.equal(a.lines[a.rows[i].line].raw,b.lines[b.rows[i].line].raw);}
 const parsed=core.parseMarkerCriteria(after.toString('utf8'),name);assert.deepEqual(parsed.issues,[]);assert.equal(parsed.combinations.length,4);
 return change;
}
if(process.argv.includes('--prepare')){
 assert(!(await lstat('.test-vault')).isSymbolicLink());await mkdir(stage,{recursive:true});
 const names=await discover();assert.equal(names.length,11,'Changed summary scope needs review');
 const plan={version,files:[],nativeVerified:false};
 for(const name of names){
  const before=await readFile(safe(name)),text=before.toString('utf8'),change=migrate(text,name),after=Buffer.from(core.applyPatches(text,change.patches));verify(before,after,name);
  for(const [side,bytes]of[['before',before],['after',after]]){const dest=path.join(stage,side,name);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes);}
  plan.files.push({name,before:hash(before),after:hash(after),patches:change.patches.length,rows:core.parseSummary(text,name).rows.length});
 }
 await writeFile(manifestPath,JSON.stringify(plan,null,2));console.log(JSON.stringify({files:plan.files.length,insertions:plan.files.reduce((sum,f)=>sum+f.patches,0),rowsUnchanged:plan.files.reduce((sum,f)=>sum+f.rows,0)}));
}else if(process.argv.includes('--verify-native')){
 const {chromium}=await import('playwright'),browser=await chromium.connectOverCDP('http://127.0.0.1:9237');
 try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
  await assertTestVault(page);
  const plan=JSON.parse(await readFile(manifestPath,'utf8'));assert.equal(plan.version,version);
  for(const [index,file]of plan.files.entries()){
   const before=await readFile(path.join(stage,'before',file.name)),after=await readFile(path.join(stage,'after',file.name));assert.equal(hash(before),file.before);assert.equal(hash(after),file.after);verify(before,after,file.name);
   const actual=await page.evaluate(async({index,before,after})=>{
    const relative=`.combination-migration/native-${index}.md`;await app.vault.adapter.write(relative,before);await app.vault.adapter.write(relative,after);return app.vault.adapter.read(relative);
   },{index,before:before.toString('utf8'),after:after.toString('utf8')});assert.deepEqual(Buffer.from(actual),after);
  }
  plan.nativeVerified=true;await writeFile(manifestPath,JSON.stringify(plan,null,2));
  await writeFile('artifacts/combination-copy-verification.json',JSON.stringify({version,files:plan.files.length,rowsUnchanged:plan.files.reduce((sum,f)=>sum+f.rows,0),nativeStorageRoundtrip:true,insertionOnly:!process.argv.includes('--simplify')},null,2));
  console.log('All 11 copied summaries verified in isolated Obsidian; all original bytes outside permitted patches unchanged.');
 }finally{await browser.close();}
}else if(process.argv.includes('--apply')){
 const plan=JSON.parse(await readFile(manifestPath,'utf8'));assert.equal(plan.version,version);assert(plan.nativeVerified);assert.deepEqual(await discover(),plan.files.map(f=>f.name));
 const backup=`${BACKUPS}/planner-combination-rules-${version}-${new Date().toISOString().replace(/[:.]/g,'-')}`;await mkdir(backup,{recursive:true});
 for(const file of plan.files){const before=await readFile(safe(file.name)),after=await readFile(path.join(stage,'after',file.name));assert.equal(hash(before),file.before,`${file.name} changed; prepare again`);assert.equal(hash(after),file.after);verify(before,after,file.name);const dest=path.join(backup,file.name);await mkdir(path.dirname(dest),{recursive:true});await copyFile(safe(file.name),dest);assert.equal(hash(await readFile(dest)),file.before);}
 await copyFile(manifestPath,path.join(backup,'plan.json'));
 const written=[];
 try{
  for(const file of plan.files){
   const target=safe(file.name);assert.equal(hash(await readFile(target)),file.before);
   if(!file.patches)continue;
   const after=await readFile(path.join(stage,'after',file.name)),temp=target+'.planner-combinations.tmp';await writeFile(temp,after,{flag:'wx'});assert.equal(hash(await readFile(target)),file.before);await rename(temp,target);written.push(file);assert.equal(hash(await readFile(target)),file.after);
  }
  for(const file of plan.files)assert.equal(hash(await readFile(safe(file.name))),file.after);
 }catch(error){for(const file of written.reverse())if(hash(await readFile(safe(file.name)))===file.after)await copyFile(path.join(backup,file.name),safe(file.name));throw error;}
 const report={version,backup,files:plan.files.length,insertions:plan.files.reduce((sum,f)=>sum+f.patches,0),dayRowsPreserved:plan.files.reduce((sum,f)=>sum+f.rows,0),allOtherBytesPreserved:true};
 await writeFile(path.join(backup,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/local-combination-rules.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}else throw Error('Choose --prepare, --verify-native or --apply. Only --apply updates the verified, backed-up originals.');
