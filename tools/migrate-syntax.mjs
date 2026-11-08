import { BACKUPS, WORKSPACE, ownerVault } from './paths.mjs';
// One-time 0.2.61 syntax migration (see src/core/syntax-migration.ts).
//   node tools/migrate-syntax.mjs [--vault <dir>]            dry run: report only
//   node tools/migrate-syntax.mjs [--vault <dir>] --apply    write, with Obsidian closed
// Every touched note is backed up first; a note whose counted minutes would change,
// or that would keep a retired form, is refused and left as it is.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,copyFile,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const workspace=WORKSPACE;
assert.equal(path.resolve('.'),workspace,'Run from the planner workspace');
const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const root=path.resolve(arg('--vault')??ownerVault()),apply=process.argv.includes('--apply');
const label=arg('--vault')?path.basename(root):'owner';
const report=path.join(workspace,'artifacts',`syntax-migration-${label}.json`);
assert(!report.startsWith(root+path.sep),'The report must stay outside the vault');
const hash=b=>createHash('sha256').update(b).digest('hex');
const built=await build({stdin:{contents:"export {migrateSyntax} from './src/core/syntax-migration';",resolveDir:workspace},bundle:true,write:false,format:'esm',platform:'node'});
const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const settings=JSON.parse(await readFile(path.join(root,'.obsidian/plugins/thejaz-planner/data.json'),'utf8'));
const codes=[...new Set([...settings.projectCodes,...settings.projectGroups.flatMap(g=>g.projects)].map(c=>c.toUpperCase()))];
async function notes(dir=''){
 const files=[];for(const item of await readdir(path.join(root,dir),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink())continue;
  const name=path.join(dir,item.name);if(item.isDirectory())files.push(...await notes(name));else if(item.name.endsWith('.md'))files.push(name);
 }return files.sort();
}
function obsidianRunning(){
 try{return /Obsidian\.exe/i.test(execFileSync('tasklist',['/FI','IMAGENAME eq Obsidian.exe','/NH'],{encoding:'utf8'}));}catch{return true;}
}

const plan=[],refused=[],kinds={daily:0,summary:0,none:0};let scanned=0,lines=0;
for(const name of await notes()){
 const buffer=await readFile(path.join(root,name)),text=buffer.toString('utf8');scanned++;
 // Migrate structured planner syntax only; arbitrary prose is never rewritten.
 const result=core.migrateSyntax(text,name.replaceAll('\\','/'),codes);kinds[result.kind]++;
 if(result.issues.length){refused.push({name,issues:result.issues});continue;}
 if(result.text===text)continue;
 const before=text.split(/\r?\n/),after=result.text.split(/\r?\n/);
 const samples=before.flatMap((line,i)=>line===after[i]?[]:[{line:i+1,before:line,after:after[i]}]).slice(0,4);
 plan.push({name,before:hash(buffer),after:hash(Buffer.from(result.text)),changed:result.changed,samples,text:result.text});lines+=result.changed;
}
const summary={vault:root,mode:apply?'apply':'dry-run',scanned,kinds,files:plan.length,lines,refused:refused.length};
const record={...summary,refused,files:plan.map(({text,...file})=>file)};
await mkdir(path.dirname(report),{recursive:true});

if(apply){
 assert(!obsidianRunning(),'Close Obsidian before applying the migration');
 const backup=path.join(BACKUPS,`planner-syntax-${label}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 for(const file of plan){const target=path.join(backup,file.name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(root,file.name),target);assert.equal(hash(await readFile(target)),file.before,`${file.name}: backup differs`);}
 const written=[];
 try{
  for(const file of plan){
   const target=path.join(root,file.name),temp=target+'.planner-syntax.tmp';
   assert.equal(hash(await readFile(target)),file.before,`${file.name} changed during migration; run again`);
   await writeFile(temp,file.text,{flag:'wx'});
   try{await rename(temp,target);}catch(e){await unlink(temp).catch(()=>{});throw e;}
   written.push(file);assert.equal(hash(await readFile(target)),file.after);
  }
 }catch(error){for(const file of written.reverse())await copyFile(path.join(backup,file.name),path.join(root,file.name));throw error;}
 record.backup=backup;await writeFile(path.join(backup,'result.json'),JSON.stringify(record,null,2));
}
await writeFile(report,JSON.stringify(record,null,2));
console.log(JSON.stringify({...summary,report,backup:record.backup},null,2));
for(const r of refused.slice(0,20))console.log('refused',r.name,'\n  '+r.issues.slice(0,3).join('\n  '));
// --show <text>: every changed line of the notes whose path contains <text>, for review.
const show=arg('--show');
if(show)for(const file of plan.filter(f=>f.name.includes(show))){
 const before=(await readFile(path.join(root,file.name),'utf8')).split(/\r?\n/),after=file.text.split(/\r?\n/);
 console.log('\n##',file.name);before.forEach((line,i)=>{if(line!==after[i])console.log(`- ${line}\n+ ${after[i]}`);});
}
