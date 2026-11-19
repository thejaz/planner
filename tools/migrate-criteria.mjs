import { BACKUPS, WORKSPACE, ownerVault } from './paths.mjs';
// One-time move of summary legends into thejaz-criteria.md (see src/core/criteria-migration.ts).
//   node tools/migrate-criteria.mjs [--vault <dir>]            dry run: report only
//   node tools/migrate-criteria.mjs [--vault <dir>] --apply    write, with Obsidian closed
// Every summary must hold the same legend; the note is created at the vault root,
// each touched summary is backed up first, and nothing is written if any check fails.
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
const hash=b=>createHash('sha256').update(b).digest('hex');
const built=await build({stdin:{contents:"export {extractCriteria} from './src/core/criteria-migration';export {isSummaryPath} from './src/core/history';export {isCriteriaPath} from './src/core/criteria';",resolveDir:workspace},bundle:true,write:false,format:'esm',platform:'node'});
const core=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
async function notes(dir=''){
 const files=[];for(const item of await readdir(path.join(root,dir),{withFileTypes:true})){
  if(item.name.startsWith('.')||item.isSymbolicLink())continue;
  const name=path.join(dir,item.name);if(item.isDirectory())files.push(...await notes(name));else if(item.name.endsWith('.md'))files.push(name);
 }return files.sort();
}
const all=await notes();
assert(!all.some(name=>core.isCriteriaPath(name.replaceAll('\\','/'))),'A thejaz-criteria.md already exists; merge by hand instead');
const plan=[];
for(const name of all.filter(name=>core.isSummaryPath(name.replaceAll('\\','/')))){
 const buffer=await readFile(path.join(root,name)),result=core.extractCriteria(buffer.toString('utf8'),name.replaceAll('\\','/'));
 if(!result)continue;
 assert.deepEqual(result.issues,[],result.issues.join('\n'));
 plan.push({name,before:hash(buffer),after:hash(Buffer.from(result.summary)),summary:result.summary,section:result.section});
}
assert(plan.length,'No summary holds a Criteria & Markers section');
const sections=new Set(plan.map(p=>p.section.replace(/\r\n/g,'\n')));
assert.equal(sections.size,1,'Summaries hold different legends; settle them before moving');
const note=[...sections][0],target='thejaz-criteria.md';
const report={vault:root,mode:apply?'apply':'dry-run',criteriaNote:target,summaries:plan.map(p=>p.name),removedLinesEach:note.split('\n').length};
if(apply){
 assert(!/Obsidian\.exe/i.test(execFileSync('tasklist',['/FI','IMAGENAME eq Obsidian.exe','/NH'],{encoding:'utf8'})),'Close Obsidian before applying');
 const backup=path.join(BACKUPS,`planner-criteria-0.2.62-${label}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 for(const file of plan){const copy=path.join(backup,file.name);await mkdir(path.dirname(copy),{recursive:true});await copyFile(path.join(root,file.name),copy);assert.equal(hash(await readFile(copy)),file.before);}
 await writeFile(path.join(root,target),note,{flag:'wx'});
 const written=[];
 try{
  for(const file of plan){
   const full=path.join(root,file.name),temp=full+'.planner-criteria.tmp';
   assert.equal(hash(await readFile(full)),file.before,`${file.name} changed; run again`);
   await writeFile(temp,file.summary,{flag:'wx'});
   try{await rename(temp,full);}catch(e){await unlink(temp).catch(()=>{});throw e;}
   written.push(file);assert.equal(hash(await readFile(full)),file.after);
  }
 }catch(error){for(const file of written.reverse())await copyFile(path.join(backup,file.name),path.join(root,file.name));await unlink(path.join(root,target)).catch(()=>{});throw error;}
 report.backup=backup;await writeFile(path.join(backup,'result.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--show'))console.log('\n--- thejaz-criteria.md ---\n'+note+'\n--- first summary head ---\n'+plan[0].summary.split(/\r?\n/).slice(0,6).join('\n'));
