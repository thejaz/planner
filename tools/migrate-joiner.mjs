// Offline, explicitly requested vault migration. Never imported by the plugin.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, readdir, rename, unlink, lstat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {WORKSPACE, TEST_VAULT, BACKUPS, ownerVault} from './paths.mjs';

const arg = name => {const i=process.argv.indexOf(name); return i<0?undefined:process.argv[i+1];};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function checksum(value) {let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return h>>>0;}
const root = path.resolve(arg('--vault') ?? ownerVault());
const isolated = process.argv.includes('--isolated');
if (isolated) assert(root.startsWith(TEST_VAULT+path.sep), 'Isolated mode requires a child of the test vault');
const apply = process.argv.includes('--apply'), rollback = arg('--rollback');
const report = path.resolve(arg('--report') ?? path.join(WORKSPACE,'artifacts/joiner-migration.json'));
assert(!report.startsWith(root+path.sep), 'Reports must stay outside the vault');
const plugin = '.obsidian/plugins/thejaz-planner/';
const enabledPath = '.obsidian/community-plugins.json';
async function read(name) {return readFile(path.join(root,name));}
async function optional(name) {try{return await read(name);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function files(dir='') {
 const result=[];
 for(const e of await readdir(path.join(root,dir),{withFileTypes:true})) {
  if(e.name.startsWith('.')||e.isSymbolicLink())continue;
  const name=path.join(dir,e.name);
  if(e.isDirectory()) result.push(...await files(name));
  else if(e.name.toLowerCase().endsWith('.md'))result.push(name.replaceAll('\\','/'));
 }
 return result.sort();
}
function closed() {
 if(isolated)return;
 const running=execFileSync('tasklist',['/FI','IMAGENAME eq Obsidian.exe','/NH'],{encoding:'utf8'});
 assert(!/Obsidian\.exe/i.test(running),'Close Obsidian before applying or rolling back');
}
async function atomic(name, bytes, expected) {
 const target=path.resolve(root,name);
 assert(target.startsWith(root+path.sep),'Unsafe note path');
 assert(!(await lstat(target)).isSymbolicLink(),'Refusing a symbolic-link target');
 assert.equal(hash(await read(name)),expected,`${name}: concurrent change`);
 const temp=target+'.joiner-'+randomUUID()+'.tmp';
 await writeFile(temp,bytes,{flag:'wx'});
 try {assert.equal(hash(await read(name)),expected,`${name}: concurrent change`);await rename(temp,target);}
 finally {await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
if(rollback) {
 closed();
 const backup=path.resolve(rollback), record=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));
 assert.equal(record.root,root,'Backup belongs to another vault');
 // Preflight EVERY target and backup before restoring anything.
 for(const f of record.changes) {
  assert.equal(hash(await readFile(path.join(backup,'originals',f.name))),f.before);
  assert([f.before,f.after].includes(hash(await read(f.name))),`${f.name}: changed since migration; refusing rollback`);
 }
 for(const f of [...record.changes].reverse()) {
  const current=hash(await read(f.name));
  if(current===f.after)await atomic(f.name,await readFile(path.join(backup,'originals',f.name)),current);
  assert.equal(hash(await read(f.name)),f.before);
 }
 await writeFile(path.join(backup,'rollback.json'),JSON.stringify({time:new Date().toISOString(),verified:true},null,2));
 console.log(JSON.stringify({rollback:backup,restored:record.changes.length}));
} else {
 const built=await build({stdin:{contents:"export {migrateJoiner,targetCredits} from './tools/joiner-core'; export {discoverProjectCodes} from './src/core/project-registry';",resolveDir:WORKSPACE},bundle:true,write:false,format:'esm',platform:'node'});
 const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const settingsBytes=await read(plugin+'data.json'), settings=JSON.parse(settingsBytes);
 const documents=[], inventory={};
 for(const name of await files()) {
  const bytes=await read(name), text=bytes.toString('utf8');
  assert(bytes.equals(Buffer.from(text)),`${name}: non-UTF-8 Markdown requires manual review`);
  inventory[name]=hash(bytes);documents.push({path:name,text});
 }
 const seeded=arg('--codes-file')?JSON.parse(await readFile(arg('--codes-file'),'utf8')).codes:[];
 const codes=core.discoverProjectCodes(documents,[...settings.projectCodes,...settings.projectGroups.flatMap(g=>g.projects),...seeded],settings.routinesFolder??'_Codes',settings.summaryPath??'thejaz-summary-now.md');
 const changes=[], issues=[], literals=new Set();let extras=0;
 for(const doc of documents) {
  const result=core.migrateJoiner(doc.text,codes);
  issues.push(...result.issues.map(issue=>({name:doc.path,issue})));
  result.literals.forEach(x=>literals.add(x));
  if(result.text!==doc.text) {
   assert.equal(core.migrateJoiner(result.text,codes).text,result.text,'Migration is not idempotent');
   changes.push({name:doc.path,before:inventory[doc.path],after:hash(Buffer.from(result.text)),patches:result.patches,text:result.text});
   extras+=result.patches.filter(p=>p.extra).length;
  }
 }
 const controls={[plugin+'data.json']:hash(settingsBytes)};
 // Recovery snapshots remain untouched. Only the newest valid checksum is active.
 const snapshots=[];
 for(const name of ['recovery-0.json','recovery-1.json']) {
  const bytes=await optional(plugin+name);if(!bytes)continue;
  controls[plugin+name]=hash(bytes);
  const envelope=JSON.parse(bytes);
  if(envelope.checksum===checksum(envelope.snapshot))snapshots.push(envelope);
 }
 snapshots.sort((a,b)=>b.sequence-a.sequence);
 if(Object.keys(controls).length>1)assert(snapshots.length,'No valid recovery snapshot');
 const pending=snapshots[0]?JSON.parse(snapshots[0].snapshot).operations.filter(o=>o.summaryPending||['pending','interrupted'].includes(o.state)):[];
 assert.equal(pending.length,0,'Resolve unfinished planner operations before migration');
 const enabled=await optional(enabledPath);
 if(enabled) {
  controls[enabledPath]=hash(enabled);
  const list=JSON.parse(enabled),next=list.filter(id=>id!=='thejaz-planner');
  if(next.length!==list.length) {
   const text=JSON.stringify(next,null,2)+(enabled.toString().endsWith('\n')?'\n':'');
   changes.unshift({name:enabledPath,before:hash(enabled),after:hash(text),text,patches:[]});
  }
 }
 const record={root,codes,inventory,controls,scanned:documents.length,extraRows:extras,lines:changes.reduce((sum,c)=>sum+c.patches.length,0),literals:[...literals].sort(),issues,changes:changes.map(({text,...f})=>f)};
 if(arg('--expected-plan')) {
  const expected=JSON.parse(await readFile(arg('--expected-plan'),'utf8'));
  for(const key of ['root','codes','inventory','controls','changes','issues'])assert.deepEqual(record[key],expected[key],`${key}: changed since reviewed plan`);
 }
 await mkdir(path.dirname(report),{recursive:true});
 await writeFile(report,JSON.stringify(record,null,2));
 if(apply) {
  assert.equal(issues.length,0,'Resolve all migration issues before applying');
  assert(isolated||arg('--expected-plan'),'Owner apply requires --expected-plan with a reviewed dry-run report');
  closed();
  const backup=path.join(BACKUPS,'planner-joiner-'+(isolated?'isolated-':'owner-')+new Date().toISOString().replace(/[:.]/g,'-'));
  assert(!backup.startsWith(root+path.sep),'Backup must be outside the vault');
  await mkdir(backup,{recursive:true});
  for(const name of Object.keys(controls)) {
   const target=path.join(backup,'controls',name);await mkdir(path.dirname(target),{recursive:true});
   const bytes=await read(name);assert.equal(hash(bytes),controls[name]);await writeFile(target,bytes,{flag:'wx'});
   assert.equal(hash(await readFile(target)),controls[name]);
  }
  for(const f of changes) {
   const target=path.join(backup,'originals',f.name);await mkdir(path.dirname(target),{recursive:true});
   const bytes=await read(f.name);assert.equal(hash(bytes),f.before);await writeFile(target,bytes,{flag:'wx'});
   assert.equal(hash(await readFile(target)),f.before,'Backup verification failed');
  }
  await writeFile(path.join(backup,'manifest.json'),JSON.stringify(record,null,2));
  for(const [name,expected] of Object.entries({...inventory,...controls}))assert.equal(hash(await read(name)),expected,`${name}: changed before migration`);
  assert.deepEqual(await files(),Object.keys(inventory),'Markdown inventory changed');
  try {
   // Disable the old parser before the first Markdown write, leaving it disabled.
   for(const f of changes)await atomic(f.name,Buffer.from(f.text),f.before);
   assert.deepEqual(await files(),Object.keys(inventory),'Markdown inventory changed during migration');
   const expected=new Map(changes.map(f=>[f.name,f.after]));
   for(const [name,before] of Object.entries({...inventory,...controls}))assert.equal(hash(await read(name)),expected.get(name)??before,`${name}: post-write verification failed`);
   record.verified=true;record.backup=backup;
  } catch(error) {
   // Do not blindly overwrite a concurrent edit. Keep old parser disabled on failure.
   const rollbackFailures=[];
   for(const f of [...changes].reverse().filter(f=>f.name!==enabledPath)) {
    const current=hash(await read(f.name));
    if(current===f.after)await atomic(f.name,await readFile(path.join(backup,'originals',f.name)),current);
    else if(current!==f.before)rollbackFailures.push(f.name);
   }
   await writeFile(path.join(backup,'failure.json'),JSON.stringify({error:String(error),rollbackFailures},null,2));throw error;
  }
  await writeFile(path.join(backup,'result.json'),JSON.stringify(record,null,2));
  await writeFile(report,JSON.stringify(record,null,2));
 }
 console.log(JSON.stringify({scanned:record.scanned,files:changes.filter(c=>c.patches.length).length,lines:record.lines,extraRows:extras,issues:issues.length,literalNames:record.literals,report,backup:record.backup,verified:record.verified},null,2));
 if(issues.length)process.exitCode=1;
}
